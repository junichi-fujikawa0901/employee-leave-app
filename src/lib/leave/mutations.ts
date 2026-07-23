import type { LeaveRequest } from "@/generated/prisma/client";
import { AuditAction, GrantType, LeaveRequestStatus, LeaveUnit, Prisma, UserStatus } from "@/generated/prisma/client";
import { startOfTodayUTC, toUtcMidnight } from "@/lib/date/calendar";
import { decimalToNumber } from "@/lib/decimal";
import { InsufficientBalanceError, planFefoConsumption } from "@/lib/leave/balance";
import { getObligationPeriods, type ObligationPeriod } from "@/lib/leave/annual-obligation";
import { MAX_BULK_REQUEST_DAYS } from "@/lib/leave/date-range";
import {
  BatchRequestConflictError,
  type BatchRequestConflictReason,
  DomainError,
  DuplicateDatesInBatchError,
  DuplicateRequestError,
  EmptyBatchDatesError,
  ExceedsBatchSizeLimitError,
  ExceedsDailyLimitError,
  ExceedsHourlyAnnualCapError,
  HourlyLeaveOutsideObligationPeriodError,
  InvalidHourlyRequestError,
  NotRequestOwnerError,
  RequestNotApprovedError,
  RequestNotFoundError,
  RequestNotPendingError,
  RequestTargetNotActiveError,
  SelfApprovalError,
  TargetOnHolidayError,
  WithdrawalDeadlinePassedError,
} from "@/lib/leave/errors";
import { recordAuditLog } from "@/lib/audit/log";
import { checkHolidayEligibility } from "@/lib/holidays/eligibility";
import {
  checkHourlyCap,
  checkNewRequest,
  isWithinWithdrawalWindow,
  STANDARD_DAILY_HOURS,
  unitToDays,
} from "@/lib/leave/request-rules";
import { prisma } from "@/lib/prisma";

/** targetDateひとつが休日マスタに登録されているか判定する(単日申請・承認用) */
async function isTargetDateHoliday(tx: Prisma.TransactionClient, targetDate: Date): Promise<boolean> {
  const holiday = await tx.holiday.findUnique({ where: { date: targetDate } });
  return holiday !== null;
}

/** start〜end(両端含む)の範囲にある休日の日付集合を取得する(期間一括申請用) */
async function loadHolidayDateSet(
  tx: Prisma.TransactionClient,
  start: Date,
  end: Date,
): Promise<Set<number>> {
  const holidays = await tx.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    select: { date: true },
  });
  return new Set(holidays.map((holiday) => holiday.date.getTime()));
}

/** 単日申請(createLeaveRequest)・期間一括申請(createLeaveRequestBatch)の両方で使う対象日ロックキー */
async function lockTargetDate(tx: Prisma.TransactionClient, userId: string, targetDate: Date): Promise<void> {
  const targetDateLockKey = Math.trunc(targetDate.getTime() / (1000 * 60 * 60 * 24));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), ${targetDateLockKey})`;
}

/**
 * targetDateが属する義務期間(Phase 2のObligationPeriod)を返す。複数件返ることがある
 * (月末入社等で義務期間が1日重複するケース、annual-obligation.tsのgetObligationPeriods参照)。
 * asOfにはtargetDateそのものを渡す(today基準だと、未来日の申請がまだ始まっていない期間に
 * 属する場合にgetObligationPeriodsがperiod.start<=asOfで弾いてしまい期間が見つからなくなるため)。
 */
async function findObligationPeriodsForDate(
  tx: Prisma.TransactionClient,
  userId: string,
  targetDate: Date,
): Promise<ObligationPeriod[]> {
  const grants = await tx.leaveGrant.findMany({
    where: { userId, grantType: GrantType.annual_auto, grantedDays: { gte: 10 } },
    select: { grantedDate: true, grantedDays: true },
  });
  const periods = getObligationPeriods(
    grants.map((grant) => ({
      grantedDate: grant.grantedDate,
      grantedDays: decimalToNumber(grant.grantedDays),
    })),
    targetDate,
  );
  return periods.filter(
    (period) => targetDate.getTime() >= period.start.getTime() && targetDate.getTime() <= period.end.getTime(),
  );
}

/**
 * 時間単位年休の上限チェックを義務期間単位で直列化するためのadvisory lock。
 * 既存の対象日ロック(hashtext(userId))とは別のキー空間を使う。
 * 重複義務期間で複数期間がヒットする場合も常にperiod.start昇順で取得することで、
 * 同時に走る別トランザクションとのデッドロックを避ける。
 */
async function lockObligationPeriodsForHourlyCap(
  tx: Prisma.TransactionClient,
  userId: string,
  periods: ObligationPeriod[],
): Promise<void> {
  const sorted = [...periods].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const period of sorted) {
    const periodLockKey = Math.trunc(period.start.getTime() / (1000 * 60 * 60 * 24));
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:hourly-cap`}), ${periodLockKey})`;
  }
}

/** 該当する全期間について、時間単位年休の上限(40時間)を超えないか判定する */
async function assertWithinHourlyCap(
  tx: Prisma.TransactionClient,
  userId: string,
  periods: ObligationPeriod[],
  newHours: number,
  statuses: LeaveRequestStatus[],
  excludeRequestId?: string,
): Promise<void> {
  for (const period of periods) {
    const existingRequests = await tx.leaveRequest.findMany({
      where: {
        userId,
        unit: LeaveUnit.hourly,
        status: { in: statuses },
        targetDate: { gte: period.start, lte: period.end },
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
      select: { hours: true },
    });
    const existingHours = existingRequests.reduce((sum, request) => sum + (request.hours ?? 0), 0);
    const check = checkHourlyCap(existingHours, newHours);
    if (!check.ok) {
      throw new ExceedsHourlyAnnualCapError();
    }
  }
}

/**
 * hoursが時間単位年休として有効(1〜8の整数)であることを検証する。DBにCHECK制約を
 * 置かない設計方針のため、作成時だけでなく承認時にも必ずこの検証を通す必要がある
 * (直接DB操作等でcreateLeaveRequestの検証を経ずに作られたレコードを承認時に弾くため)。
 */
function assertValidHourlyHours(hours: number | null): number {
  if (hours === null || !Number.isInteger(hours) || hours < 1 || hours > STANDARD_DAILY_HOURS) {
    throw new InvalidHourlyRequestError();
  }
  return hours;
}

/**
 * spec.md 6章-2: 重複申請・1日合計1.0日超過チェックを行った上で申請を作成する。
 * unit = hourly の場合はhours(1〜8の整数)が必須で、義務期間内の時間単位上限(40時間)も
 * 満たす必要がある(Phase 4)。
 */
export async function createLeaveRequest(input: {
  userId: string;
  targetDate: Date;
  unit: LeaveUnit;
  hours?: number | null;
}): Promise<LeaveRequest> {
  const hours = input.unit === LeaveUnit.hourly ? (input.hours ?? null) : null;
  if (input.unit === LeaveUnit.hourly) {
    assertValidHourlyHours(hours);
  }

  return prisma.$transaction(async (tx) => {
    if (input.unit === LeaveUnit.hourly) {
      const periods = await findObligationPeriodsForDate(tx, input.userId, input.targetDate);
      if (periods.length === 0) {
        throw new HourlyLeaveOutsideObligationPeriodError();
      }
      await lockObligationPeriodsForHourlyCap(tx, input.userId, periods);
      await assertWithinHourlyCap(tx, input.userId, periods, hours as number, [
        LeaveRequestStatus.pending,
        LeaveRequestStatus.approved,
      ]);
    }

    await lockTargetDate(tx, input.userId, input.targetDate);

    if (await isTargetDateHoliday(tx, input.targetDate)) {
      throw new TargetOnHolidayError();
    }

    const existing = await tx.leaveRequest.findMany({
      where: {
        userId: input.userId,
        targetDate: input.targetDate,
        status: { in: [LeaveRequestStatus.pending, LeaveRequestStatus.approved] },
      },
      select: { unit: true, hours: true },
    });

    const check = checkNewRequest(existing, input.unit, hours);
    if (!check.ok) {
      throw check.reason === "duplicate_unit"
        ? new DuplicateRequestError()
        : new ExceedsDailyLimitError();
    }

    return tx.leaveRequest.create({
      data: {
        userId: input.userId,
        targetDate: input.targetDate,
        unit: input.unit,
        hours,
      },
    });
  });
}

/**
 * spec.md 6章: 複数日をまとめて1回の操作で申請する(期間一括申請、Phase 5)。
 * 全休(full_day)のみ対象。1件でも既存申請と衝突する日があれば1件も作成しない
 * (all-or-nothing)。既存の単日createLeaveRequestと同じadvisory lockキー空間
 * (hashtext(userId), 対象日のunix日数)を対象日昇順で取得することで、同時に飛んでくる
 * 単日申請とも正しく直列化される。
 */
export async function createLeaveRequestBatch(input: {
  userId: string;
  dates: Date[];
}): Promise<LeaveRequest[]> {
  if (input.dates.length === 0) {
    throw new EmptyBatchDatesError();
  }
  if (input.dates.length > MAX_BULK_REQUEST_DAYS) {
    throw new ExceedsBatchSizeLimitError();
  }

  const normalizedDates = input.dates.map((date) => toUtcMidnight(date));
  const uniqueKeys = new Set(normalizedDates.map((date) => date.getTime()));
  if (uniqueKeys.size !== normalizedDates.length) {
    throw new DuplicateDatesInBatchError();
  }

  const sortedDates = [...normalizedDates].sort((a, b) => a.getTime() - b.getTime());

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { status: true } });
    if (!user || user.status !== UserStatus.active) {
      throw new RequestTargetNotActiveError();
    }

    for (const date of sortedDates) {
      await lockTargetDate(tx, input.userId, date);
    }

    const minDate = sortedDates[0];
    const maxDate = sortedDates[sortedDates.length - 1];
    const existing = await tx.leaveRequest.findMany({
      where: {
        userId: input.userId,
        targetDate: { gte: minDate, lte: maxDate },
        status: { in: [LeaveRequestStatus.pending, LeaveRequestStatus.approved] },
      },
      select: { targetDate: true, unit: true, hours: true },
    });
    const existingByDate = new Map<number, { unit: LeaveUnit; hours: number | null }[]>();
    for (const request of existing) {
      const key = request.targetDate.getTime();
      const list = existingByDate.get(key) ?? [];
      list.push({ unit: request.unit, hours: request.hours });
      existingByDate.set(key, list);
    }

    const holidayDates = await loadHolidayDateSet(tx, minDate, maxDate);

    const conflicts: { targetDate: Date; reason: BatchRequestConflictReason }[] = [];
    for (const date of sortedDates) {
      const holidayCheck = checkHolidayEligibility(date, holidayDates);
      if (!holidayCheck.ok) {
        conflicts.push({ targetDate: date, reason: holidayCheck.reason });
        continue;
      }
      const existingForDate = existingByDate.get(date.getTime()) ?? [];
      const check = checkNewRequest(existingForDate, LeaveUnit.full_day, null);
      if (!check.ok) {
        conflicts.push({ targetDate: date, reason: check.reason });
      }
    }
    if (conflicts.length > 0) {
      throw new BatchRequestConflictError(conflicts);
    }

    const batchId = crypto.randomUUID();
    return tx.leaveRequest.createManyAndReturn({
      data: sortedDates.map((targetDate) => ({
        userId: input.userId,
        targetDate,
        unit: LeaveUnit.full_day,
        batchId,
      })),
    });
  });
}

/** spec.md 4.3/6章-4: 申請者本人が「申請中」の申請のみ取消できる */
export async function cancelLeaveRequest(input: {
  requestId: string;
  actingUserId: string;
  reason?: string;
}): Promise<void> {
  const cancelReason = input.reason?.trim() || null;

  await prisma.$transaction(async (tx) => {
    const result = await tx.leaveRequest.updateMany({
      where: { id: input.requestId, userId: input.actingUserId, status: LeaveRequestStatus.pending },
      data: {
        status: LeaveRequestStatus.cancelled,
        cancelledBy: input.actingUserId,
        cancelledAt: new Date(),
        cancelReason,
      },
    });

    if (result.count === 0) {
      throw new NotRequestOwnerError();
    }

    const request = await tx.leaveRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    await recordAuditLog(tx, {
      actorId: input.actingUserId,
      action: AuditAction.leave_request_cancelled,
      targetUserId: request.userId,
      targetId: request.id,
      detail: { targetDate: request.targetDate.toISOString(), unit: request.unit, reason: cancelReason },
    });
  });
}

/**
 * 承認済み申請の取り下げ(本人のみ、対象日の3日前まで)。
 * まだ休暇を取得していないため、消化済み日数は残日数に復元する
 * (退職処理による自動取消とは異なり、消化内訳のcancelledAtも設定する)。
 */
export async function withdrawApprovedLeaveRequest(input: {
  requestId: string;
  actingUserId: string;
  reason?: string;
}): Promise<void> {
  const request = await prisma.leaveRequest.findUnique({ where: { id: input.requestId } });
  if (!request) {
    throw new RequestNotFoundError();
  }
  if (request.userId !== input.actingUserId) {
    throw new NotRequestOwnerError();
  }
  if (request.status !== LeaveRequestStatus.approved) {
    throw new RequestNotApprovedError();
  }
  if (!isWithinWithdrawalWindow(request.targetDate, startOfTodayUTC())) {
    throw new WithdrawalDeadlinePassedError();
  }

  const withdrawReason = input.reason?.trim() || null;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.leaveRequest.updateMany({
      where: { id: input.requestId, status: LeaveRequestStatus.approved },
      data: {
        status: LeaveRequestStatus.cancelled,
        cancelledBy: input.actingUserId,
        cancelledAt: new Date(),
        cancelReason: withdrawReason,
      },
    });
    if (claimed.count === 0) {
      throw new RequestNotApprovedError();
    }

    await tx.leaveConsumption.updateMany({
      where: { leaveRequestId: input.requestId, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });

    await recordAuditLog(tx, {
      actorId: input.actingUserId,
      action: AuditAction.leave_request_withdrawn,
      targetUserId: request.userId,
      targetId: request.id,
      detail: { targetDate: request.targetDate.toISOString(), unit: request.unit, reason: withdrawReason },
    });
  });
}

/**
 * spec.md 4.3/6章-5: 承認。自己承認禁止、残高不足はエラー。承認可能な場合は
 * FEFO順(5.2)に消化元付与枠を選び、有給消化内訳(LeaveConsumption)へ即時記録する。
 */
export async function approveLeaveRequest(input: { requestId: string; reviewerId: string }): Promise<void> {
  const request = await prisma.leaveRequest.findUnique({ where: { id: input.requestId } });
  if (!request) {
    throw new RequestNotFoundError();
  }
  if (request.status !== LeaveRequestStatus.pending) {
    throw new RequestNotPendingError();
  }
  if (request.userId === input.reviewerId) {
    throw new SelfApprovalError();
  }

  const asOf = startOfTodayUTC();

  // hourlyの場合、承認時にもhoursの妥当性を再検証する(DBにCHECK制約を置かない設計のため、
  // 直接DB操作等でcreateLeaveRequestの検証を経ずに作られたレコード(hours=null/範囲外)を
  // 承認できてしまわないようにする。Codexレビューのmust-fix)。以降このvalidatedHoursを使う。
  const validatedHours = request.unit === LeaveUnit.hourly ? assertValidHourlyHours(request.hours) : null;

  await prisma.$transaction(async (tx) => {
    // 同一ユーザーへの同時承認を直列化する一般ロック(Phase 5)。承認は残高を読んで
    // LeaveConsumptionを書き込むにもかかわらず、これまでcreateLeaveRequestと違い
    // ユーザー単位のロックを取得しておらず、2人の管理者が同時に同じ社員の別々の申請を
    // 承認すると残高を超えて二重消費しうる既存バグがあった。固定キー(0)は対象日ロックの
    // 数値空間・時間単位ロックの文字列saltとは別のsalt(':approve')を使うため衝突しない。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${request.userId}:approve`}), 0)`;

    // 休日マスタ導入前に作成された申請や、作成後に休日として追加登録された日の申請が
    // 承認をすり抜けないよう、承認時にも作成時と同じ休日チェックを行う(Codexレビューのmust-fix対応)。
    if (await isTargetDateHoliday(tx, request.targetDate)) {
      throw new TargetOnHolidayError();
    }

    if (request.unit === LeaveUnit.hourly) {
      // 作成時から承認時までの間に同じ義務期間内の他の時間単位申請が承認・取消される
      // 可能性があるため、承認時にも上限を再チェックする(Phase 4のmust-fix対応)。
      // このチェックは申請ステータスをapprovedに更新する前に行う。承認対象自身は
      // まだpendingのため通常はapprovedのみを対象にした集計に紛れ込まないが、
      // 同一申請への二重承認レース時にもエラー種別が安定するよう明示的に除外する
      // (should-fix対応)。
      // 上のユーザー単位ロックにより同一ユーザーへの同時承認はすでに直列化されているため、
      // Phase 4で導入した期間スコープlock(lockObligationPeriodsForHourlyCap)の
      // ここでの呼び出しは冗長であり削除した(createLeaveRequest側は一般ロックを
      // 持たないため、そちらの呼び出しは維持する)。
      const periods = await findObligationPeriodsForDate(tx, request.userId, request.targetDate);
      if (periods.length === 0) {
        throw new HourlyLeaveOutsideObligationPeriodError();
      }
      await assertWithinHourlyCap(
        tx,
        request.userId,
        periods,
        validatedHours as number,
        [LeaveRequestStatus.approved],
        request.id,
      );
    }

    const claimed = await tx.leaveRequest.updateMany({
      where: { id: input.requestId, status: LeaveRequestStatus.pending },
      data: {
        status: LeaveRequestStatus.approved,
        reviewedById: input.reviewerId,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new RequestNotPendingError();
    }

    const activeGrants = await tx.leaveGrant.findMany({
      where: { userId: request.userId, grantedDate: { lte: asOf }, expireDate: { gte: asOf } },
      include: {
        consumptions: { where: { cancelledAt: null }, select: { consumedDays: true } },
      },
    });

    const grantBalances = activeGrants.map((grant) => {
      const consumedTotal = grant.consumptions.reduce(
        (sum, consumption) => sum + decimalToNumber(consumption.consumedDays),
        0,
      );
      return {
        id: grant.id,
        grantedDate: grant.grantedDate,
        expireDate: grant.expireDate,
        remainingDays: decimalToNumber(grant.grantedDays) - consumedTotal,
      };
    });

    // 残高不足の場合は InsufficientBalanceError を投げ、トランザクション全体をロールバックする
    const plan = planFefoConsumption(grantBalances, unitToDays(request.unit, validatedHours));

    await tx.leaveConsumption.createMany({
      data: plan.map((item) => ({
        leaveRequestId: request.id,
        leaveGrantId: item.grantId,
        consumedDays: item.consumedDays,
      })),
    });

    await recordAuditLog(tx, {
      actorId: input.reviewerId,
      action: AuditAction.leave_request_approved,
      targetUserId: request.userId,
      targetId: request.id,
      detail: { targetDate: request.targetDate.toISOString(), unit: request.unit, hours: request.hours },
    });
  });
}

/** spec.md 4.3/6章-5: 却下。自己却下禁止、残高には影響しない */
export async function rejectLeaveRequest(input: {
  requestId: string;
  reviewerId: string;
  reason?: string;
}): Promise<void> {
  const request = await prisma.leaveRequest.findUnique({ where: { id: input.requestId } });
  if (!request) {
    throw new RequestNotFoundError();
  }
  if (request.status !== LeaveRequestStatus.pending) {
    throw new RequestNotPendingError();
  }
  if (request.userId === input.reviewerId) {
    throw new SelfApprovalError();
  }

  const rejectReason = input.reason?.trim() || null;

  await prisma.$transaction(async (tx) => {
    const result = await tx.leaveRequest.updateMany({
      where: { id: input.requestId, status: LeaveRequestStatus.pending },
      data: {
        status: LeaveRequestStatus.rejected,
        reviewedById: input.reviewerId,
        reviewedAt: new Date(),
        rejectReason,
      },
    });

    if (result.count === 0) {
      throw new RequestNotPendingError();
    }

    await recordAuditLog(tx, {
      actorId: input.reviewerId,
      action: AuditAction.leave_request_rejected,
      targetUserId: request.userId,
      targetId: request.id,
      detail: { targetDate: request.targetDate.toISOString(), unit: request.unit, reason: rejectReason },
    });
  });
}

export interface BatchOutcome {
  succeeded: string[];
  failed: { requestId: string; reason: string }[];
}

async function runBatchOperation(
  batchId: string,
  operation: (requestId: string) => Promise<void>,
): Promise<BatchOutcome> {
  const requests = await prisma.leaveRequest.findMany({
    where: { batchId, status: LeaveRequestStatus.pending },
    orderBy: { targetDate: "asc" },
    select: { id: true },
  });

  const succeeded: string[] = [];
  const failed: { requestId: string; reason: string }[] = [];
  for (const request of requests) {
    try {
      await operation(request.id);
      succeeded.push(request.id);
    } catch (error) {
      if (error instanceof DomainError || error instanceof InsufficientBalanceError) {
        failed.push({ requestId: request.id, reason: error.message });
      } else {
        throw error;
      }
    }
  }
  return { succeeded, failed };
}

/**
 * 期間一括申請(Phase 5)のうちpending中のものをまとめて承認する。既存の単発
 * approveLeaveRequest(一般ロック追加済み)を1件ずつループで呼び、部分成功を許容する
 * (作成=全体ロールバックとは非対称な設計。1件ごとの残高消費は独立しているため)。
 */
export async function approveLeaveRequestBatch(input: {
  batchId: string;
  reviewerId: string;
}): Promise<BatchOutcome> {
  return runBatchOperation(input.batchId, (requestId) =>
    approveLeaveRequest({ requestId, reviewerId: input.reviewerId }),
  );
}

/** 期間一括申請のうちpending中のものをまとめて却下する(部分成功を許容) */
export async function rejectLeaveRequestBatch(input: {
  batchId: string;
  reviewerId: string;
  reason?: string;
}): Promise<BatchOutcome> {
  return runBatchOperation(input.batchId, (requestId) =>
    rejectLeaveRequest({ requestId, reviewerId: input.reviewerId, reason: input.reason }),
  );
}

/**
 * 申請者本人がpending中の一括申請をまとめて取消する(単日cancelLeaveRequestの
 * 「本人かつpendingのみ」という制約をそのまま流用。部分成功を許容)。
 */
export async function cancelLeaveRequestBatch(input: {
  batchId: string;
  actingUserId: string;
  reason?: string;
}): Promise<BatchOutcome> {
  return runBatchOperation(input.batchId, (requestId) =>
    cancelLeaveRequest({ requestId, actingUserId: input.actingUserId, reason: input.reason }),
  );
}

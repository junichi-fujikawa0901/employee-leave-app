import {
  GrantType,
  LeaveRequestStatus,
  LeaveUnit,
  Role,
  UserStatus,
} from "@/generated/prisma/client";
import { addDaysUTC, startOfTodayUTC, toUtcMidnight } from "@/lib/date/calendar";
import { decimalToNumber as toNumber } from "@/lib/decimal";
import {
  computeObligationStatus,
  getObligationPeriods,
  isRecentlyOverdue,
  type ObligationPeriod,
  type ObligationPeriodStatus,
  type ObligationStatusLevel,
  selectPriorityObligation,
} from "@/lib/leave/annual-obligation";
import { type GrantBalanceInput, sumRemaining } from "@/lib/leave/balance";
import { unitToDays } from "@/lib/leave/request-rules";
import { getNextGrantYearMonth, planAutoGrants, SYSTEM_LAUNCH_DATE } from "@/lib/leave/schedule";
import { prisma } from "@/lib/prisma";

export interface AnnualObligation {
  current: ObligationPeriodStatus | null;
  /** current以外に未達(met以外)の期間がいくつあるか */
  otherUnmetCount: number;
  /**
   * currentの義務期間内に、算定対象外の時間単位年休(取得済み/取得予定いずれか)が1件でもあるか。
   * 取得済み日数が実態(取得履歴)より少なく見える理由をUI側で説明するために使う。
   */
  hasExcludedHourlyRequests: boolean;
}

/**
 * 義務期間ごとにapproved申請を集計してステータスを計算し、表示対象の1件(current)を選ぶ。
 * getAnnualObligation・getEmployeeSummaries の両方から使う共通ロジック。
 */
function buildAnnualObligation(
  periods: ObligationPeriod[],
  requests: { targetDate: Date; unit: LeaveUnit }[],
  asOf: Date,
): AnnualObligation {
  if (periods.length === 0) {
    return { current: null, otherUnmetCount: 0, hasExcludedHourlyRequests: false };
  }

  const normalizedAsOf = toUtcMidnight(asOf);
  const hourlyExclusionByPeriod = new Map<ObligationPeriod, boolean>();
  const periodStatuses: ObligationPeriodStatus[] = periods.map((period) => {
    let taken = 0;
    let planned = 0;
    let hasExcludedHourlyRequests = false;
    for (const request of requests) {
      const time = request.targetDate.getTime();
      if (time < period.start.getTime() || time > period.end.getTime()) {
        continue;
      }
      // 時間単位年休(Phase 4)は年5日取得義務の算定に含まれない(労基法上、時間単位年休は
      // 取得時間に関わらず、年5日取得義務の取得済み・取得予定いずれにもカウントしない)。
      if (request.unit === LeaveUnit.hourly) {
        hasExcludedHourlyRequests = true;
        continue;
      }
      if (time <= normalizedAsOf.getTime()) {
        taken += unitToDays(request.unit);
      } else {
        planned += unitToDays(request.unit);
      }
    }
    hourlyExclusionByPeriod.set(period, hasExcludedHourlyRequests);
    return { period, status: computeObligationStatus(taken, planned, period, asOf) };
  });

  const current = selectPriorityObligation(periodStatuses);
  const otherUnmetCount = periodStatuses.filter(
    (ps) => ps !== current && ps.status.status !== "met",
  ).length;
  const hasExcludedHourlyRequests = current
    ? (hourlyExclusionByPeriod.get(current.period) ?? false)
    : false;

  return { current, otherUnmetCount, hasExcludedHourlyRequests };
}

/** 社員一覧・詳細画面用。義務期間が無い(義務対象外)社員はnull */
export async function getAnnualObligation(
  userId: string,
  asOf: Date = startOfTodayUTC(),
): Promise<AnnualObligation> {
  const grants = await prisma.leaveGrant.findMany({
    where: { userId, grantType: GrantType.annual_auto, grantedDays: { gte: 10 } },
    select: { grantedDate: true, grantedDays: true },
  });
  const periods = getObligationPeriods(
    grants.map((grant) => ({ grantedDate: grant.grantedDate, grantedDays: toNumber(grant.grantedDays) })),
    asOf,
  );
  if (periods.length === 0) {
    return { current: null, otherUnmetCount: 0, hasExcludedHourlyRequests: false };
  }

  const minStart = periods[0].start;
  const maxEnd = periods.reduce(
    (max, period) => (period.end.getTime() > max.getTime() ? period.end : max),
    periods[0].end,
  );

  const requests = await prisma.leaveRequest.findMany({
    where: { userId, status: LeaveRequestStatus.approved, targetDate: { gte: minStart, lte: maxEnd } },
    select: { targetDate: true, unit: true },
  });

  return buildAnnualObligation(periods, requests, asOf);
}

/** 未取消(cancelledAt: null)の消化明細から消化済み合計日数を求める共通ロジック */
function sumConsumedDays(consumptions: { consumedDays: { toNumber(): number } }[]): number {
  return consumptions.reduce((sum, consumption) => sum + toNumber(consumption.consumedDays), 0);
}

export async function getActiveGrantsWithRemaining(
  userId: string,
  asOf: Date = startOfTodayUTC(),
): Promise<GrantBalanceInput[]> {
  const grants = await prisma.leaveGrant.findMany({
    where: { userId, grantedDate: { lte: asOf }, expireDate: { gte: asOf } },
    include: {
      consumptions: { where: { cancelledAt: null }, select: { consumedDays: true } },
    },
  });

  return grants.map((grant) => ({
    id: grant.id,
    grantedDate: grant.grantedDate,
    expireDate: grant.expireDate,
    remainingDays: toNumber(grant.grantedDays) - sumConsumedDays(grant.consumptions),
  }));
}

export async function getRemainingBalance(
  userId: string,
  asOf: Date = startOfTodayUTC(),
): Promise<number> {
  const grants = await getActiveGrantsWithRemaining(userId, asOf);
  return sumRemaining(grants);
}

export async function hasAnyGrant(userId: string): Promise<boolean> {
  const count = await prisma.leaveGrant.count({ where: { userId } });
  return count > 0;
}

export interface EmployeeObligationSummary {
  start: Date;
  remaining: number;
  deadline: Date;
  status: ObligationStatusLevel;
  otherUnmetCount: number;
  /** status==="overdue"のとき、期限超過からOVERDUE_DISPLAY_WINDOW_DAYS以内かどうか(社員一覧での表示要否判定に使う) */
  isRecentlyOverdue: boolean;
}

export interface EmployeeSummary {
  id: string;
  name: string;
  role: Role;
  status: UserStatus;
  remainingDays: number;
  nextGrantYearMonth: { year: number; month: number } | null;
  hasPendingRequest: boolean;
  obligation: EmployeeObligationSummary | null;
}

/**
 * 社員一覧画面(4.2)用。users/grants/pendingRequests/obligationGrantsを並列取得し、
 * 義務期間をメモリで算出したうえでobligationRequestsを絞り込んで取得することで、
 * N+1回避と不要な全件取得の両方を避ける。
 */
export async function getEmployeeSummaries(): Promise<EmployeeSummary[]> {
  const asOf = startOfTodayUTC();

  const users = await prisma.user.findMany({ orderBy: { hireDate: "asc" } });
  const userIds = users.map((user) => user.id);

  const [grants, pendingRequests, obligationGrants] = await Promise.all([
    prisma.leaveGrant.findMany({
      where: { userId: { in: userIds }, grantedDate: { lte: asOf }, expireDate: { gte: asOf } },
      include: {
        consumptions: { where: { cancelledAt: null }, select: { consumedDays: true } },
      },
    }),
    prisma.leaveRequest.findMany({
      where: { userId: { in: userIds }, status: LeaveRequestStatus.pending },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.leaveGrant.findMany({
      where: { userId: { in: userIds }, grantType: GrantType.annual_auto, grantedDays: { gte: 10 } },
      select: { userId: true, grantedDate: true, grantedDays: true },
    }),
  ]);

  const remainingByUser = new Map<string, number>();
  for (const grant of grants) {
    const remaining = toNumber(grant.grantedDays) - sumConsumedDays(grant.consumptions);
    remainingByUser.set(grant.userId, (remainingByUser.get(grant.userId) ?? 0) + remaining);
  }

  const pendingUserIds = new Set(pendingRequests.map((request) => request.userId));

  // 義務期間をユーザーごとにメモリで先に計算し、全ユーザーのmin(start)〜max(end)の
  // 範囲だけLeaveRequestを取得する(全期間を無条件に取得しない)。
  const obligationGrantsByUser = new Map<string, { grantedDate: Date; grantedDays: number }[]>();
  for (const grant of obligationGrants) {
    const list = obligationGrantsByUser.get(grant.userId) ?? [];
    list.push({ grantedDate: grant.grantedDate, grantedDays: toNumber(grant.grantedDays) });
    obligationGrantsByUser.set(grant.userId, list);
  }

  const periodsByUser = new Map<string, ObligationPeriod[]>();
  let globalMinStart: Date | null = null;
  let globalMaxEnd: Date | null = null;
  for (const [userId, userGrants] of obligationGrantsByUser) {
    const periods = getObligationPeriods(userGrants, asOf);
    if (periods.length === 0) {
      continue;
    }
    periodsByUser.set(userId, periods);
    for (const period of periods) {
      if (!globalMinStart || period.start.getTime() < globalMinStart.getTime()) {
        globalMinStart = period.start;
      }
      if (!globalMaxEnd || period.end.getTime() > globalMaxEnd.getTime()) {
        globalMaxEnd = period.end;
      }
    }
  }

  const obligationRequests =
    globalMinStart && globalMaxEnd
      ? await prisma.leaveRequest.findMany({
          where: {
            userId: { in: Array.from(periodsByUser.keys()) },
            status: LeaveRequestStatus.approved,
            targetDate: { gte: globalMinStart, lte: globalMaxEnd },
          },
          select: { userId: true, targetDate: true, unit: true },
        })
      : [];

  const obligationRequestsByUser = new Map<string, { targetDate: Date; unit: LeaveUnit }[]>();
  for (const request of obligationRequests) {
    const list = obligationRequestsByUser.get(request.userId) ?? [];
    list.push({ targetDate: request.targetDate, unit: request.unit });
    obligationRequestsByUser.set(request.userId, list);
  }

  const obligationByUser = new Map<string, AnnualObligation>();
  for (const [userId, periods] of periodsByUser) {
    obligationByUser.set(
      userId,
      buildAnnualObligation(periods, obligationRequestsByUser.get(userId) ?? [], asOf),
    );
  }

  return users.map((user) => {
    const obligation = obligationByUser.get(user.id);
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      status: user.status,
      remainingDays: remainingByUser.get(user.id) ?? 0,
      nextGrantYearMonth:
        user.status === UserStatus.active ? getNextGrantYearMonth(user.hireDate, asOf) : null,
      hasPendingRequest: pendingUserIds.has(user.id),
      obligation:
        obligation && obligation.current
          ? {
              start: obligation.current.period.start,
              remaining: obligation.current.status.remaining,
              deadline: obligation.current.status.deadline,
              status: obligation.current.status.status,
              otherUnmetCount: obligation.otherUnmetCount,
              isRecentlyOverdue: isRecentlyOverdue(obligation.current.status.deadline, asOf),
            }
          : null,
    };
  });
}

export interface AutoGrantPreviewItem {
  userId: string;
  userName: string;
  grants: { grantedDate: Date; grantedDays: number; expireDate: Date }[];
}

export interface AutoGrantPreview {
  asOf: Date;
  items: AutoGrantPreviewItem[];
  totalCount: number;
}

/**
 * runAutoGrantsForAllActiveUsers を実行した場合に何が生成されるかを、
 * DBへの書き込みなしで事前計算する(社員一覧の「付与を実行」プレビュー用)。
 */
export async function previewAutoGrants(
  asOf: Date = startOfTodayUTC(),
): Promise<AutoGrantPreview> {
  const activeUsers = await prisma.user.findMany({
    where: { status: UserStatus.active },
    select: { id: true, name: true, hireDate: true },
    orderBy: { hireDate: "asc" },
  });
  const userIds = activeUsers.map((user) => user.id);

  const existingGrants = await prisma.leaveGrant.findMany({
    where: { userId: { in: userIds }, grantType: "annual_auto" },
    select: { userId: true, grantedDate: true },
  });
  const existingKeys = new Set(
    existingGrants.map((grant) => `${grant.userId}:${grant.grantedDate.getTime()}`),
  );

  const items: AutoGrantPreviewItem[] = [];
  for (const user of activeUsers) {
    const planned = planAutoGrants(user.hireDate, asOf, SYSTEM_LAUNCH_DATE);
    const newOnes = planned.filter(
      (grant) => !existingKeys.has(`${user.id}:${grant.grantedDate.getTime()}`),
    );
    if (newOnes.length > 0) {
      items.push({ userId: user.id, userName: user.name, grants: newOnes });
    }
  }

  return {
    asOf,
    items,
    totalCount: items.reduce((sum, item) => sum + item.grants.length, 0),
  };
}

export interface GrantHistoryItem {
  id: string;
  grantedDate: Date;
  grantedDays: number;
  expireDate: Date;
  remainingDays: number;
}

export interface RequestHistoryItem {
  id: string;
  targetDate: Date;
  unit: LeaveUnit;
  hours: number | null;
  batchId: string | null;
  status: LeaveRequestStatus;
  requestedAt: Date;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  rejectReason: string | null;
  cancelledBy: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

export interface EmployeeDetail {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  hireDate: Date;
  terminationDate: Date | null;
  remainingDays: number;
  nextGrantYearMonth: { year: number; month: number } | null;
  obligation: AnnualObligation;
  grants: GrantHistoryItem[];
  requests: RequestHistoryItem[];
}

/**
 * asOf時点の残日数を、その時点で「承認済みだった」消化明細だけを差し引いて算出する
 * (Phase 3管理簿専用。既存の残日数概念=承認時点で即時消化、spec.md 6章と一致させるため
 * targetDateではなくreviewedAtで消化明細を絞り込む。getActiveGrantsWithRemainingは
 * 消化明細をcancelledAtでしか絞らないため、過去時点の残高再現には使えない)。
 *
 * asOfは日付(UTC0時)として扱うため、reviewedAtは「asOfの翌日0時より前」で絞り込む
 * (asOf当日中の承認を含めるため。reviewedAt <= asOfのような単純な比較だと、
 * asOfの0時ちょうど以外の時刻に承認された当日分がすべて漏れてしまう)。
 */
async function getRemainingDaysAsOf(userId: string, asOf: Date): Promise<number> {
  const normalizedAsOf = toUtcMidnight(asOf);
  const endOfAsOfDay = addDaysUTC(normalizedAsOf, 1);
  const grants = await prisma.leaveGrant.findMany({
    where: { userId, grantedDate: { lte: normalizedAsOf }, expireDate: { gte: normalizedAsOf } },
    include: {
      consumptions: {
        where: { cancelledAt: null, leaveRequest: { reviewedAt: { lt: endOfAsOfDay } } },
        select: { consumedDays: true },
      },
    },
  });
  return grants.reduce(
    (total, grant) => total + (toNumber(grant.grantedDays) - sumConsumedDays(grant.consumptions)),
    0,
  );
}

export interface LeaveLedgerEntry {
  targetDate: Date;
  unit: LeaveUnit;
  hours: number | null;
  consumedDays: number;
  isFuture: boolean;
  isOverlap: boolean;
}

export interface LeaveLedgerPeriod {
  start: Date;
  end: Date;
  baseGrantDays: number;
  entries: LeaveLedgerEntry[];
  takenDays: number;
  plannedDays: number;
  balanceAsOf: Date;
  remainingDays: number;
}

/**
 * 年次有給休暇管理簿(Phase 3)用。義務期間(Phase 2のObligationPeriod)ごとに、
 * 承認済み取得明細と期末残日数をまとめて返す。義務対象期間が無い社員は[]。
 */
export async function getLeaveLedger(
  userId: string,
  asOf: Date = startOfTodayUTC(),
): Promise<LeaveLedgerPeriod[]> {
  const grants = await prisma.leaveGrant.findMany({
    where: { userId, grantType: GrantType.annual_auto, grantedDays: { gte: 10 } },
    select: { grantedDate: true, grantedDays: true },
  });
  const periods = getObligationPeriods(
    grants.map((grant) => ({ grantedDate: grant.grantedDate, grantedDays: toNumber(grant.grantedDays) })),
    asOf,
  );
  if (periods.length === 0) {
    return [];
  }

  const minStart = periods[0].start;
  const maxEnd = periods.reduce(
    (max, period) => (period.end.getTime() > max.getTime() ? period.end : max),
    periods[0].end,
  );

  const requests = await prisma.leaveRequest.findMany({
    where: { userId, status: LeaveRequestStatus.approved, targetDate: { gte: minStart, lte: maxEnd } },
    select: { targetDate: true, unit: true, hours: true },
    orderBy: { targetDate: "asc" },
  });

  const normalizedAsOf = toUtcMidnight(asOf);

  return Promise.all(
    periods.map(async (period) => {
      const entries: LeaveLedgerEntry[] = [];
      let takenDays = 0;
      let plannedDays = 0;

      for (const request of requests) {
        const time = request.targetDate.getTime();
        if (time < period.start.getTime() || time > period.end.getTime()) {
          continue;
        }
        const days = unitToDays(request.unit, request.hours);
        const isFuture = time > normalizedAsOf.getTime();
        if (isFuture) {
          plannedDays += days;
        } else {
          takenDays += days;
        }
        const isOverlap = periods.some(
          (other) =>
            other !== period &&
            time >= other.start.getTime() &&
            time <= other.end.getTime(),
        );
        entries.push({
          targetDate: request.targetDate,
          unit: request.unit,
          hours: request.hours,
          consumedDays: days,
          isFuture,
          isOverlap,
        });
      }

      const balanceAsOf = period.end.getTime() < normalizedAsOf.getTime() ? period.end : normalizedAsOf;
      const remainingDays = await getRemainingDaysAsOf(userId, balanceAsOf);

      return {
        start: period.start,
        end: period.end,
        baseGrantDays: period.baseGrantDays,
        entries,
        takenDays,
        plannedDays,
        balanceAsOf,
        remainingDays,
      };
    }),
  );
}

/** 社員詳細画面(4.3)用 */
export async function getEmployeeDetail(userId: string): Promise<EmployeeDetail | null> {
  const asOf = startOfTodayUTC();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return null;
  }

  const [activeGrants, grants, requests, obligation] = await Promise.all([
    getActiveGrantsWithRemaining(userId, asOf),
    prisma.leaveGrant.findMany({
      where: { userId },
      orderBy: [{ expireDate: "asc" }, { grantedDate: "asc" }, { id: "asc" }],
      include: {
        consumptions: { where: { cancelledAt: null }, select: { consumedDays: true } },
      },
    }),
    prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { targetDate: "desc" },
      include: { reviewedBy: { select: { name: true } } },
    }),
    getAnnualObligation(userId, asOf),
  ]);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    hireDate: user.hireDate,
    terminationDate: user.terminationDate,
    remainingDays: sumRemaining(activeGrants),
    nextGrantYearMonth:
      user.status === UserStatus.active ? getNextGrantYearMonth(user.hireDate, asOf) : null,
    obligation,
    grants: grants.map((grant) => ({
      id: grant.id,
      grantedDate: grant.grantedDate,
      grantedDays: toNumber(grant.grantedDays),
      expireDate: grant.expireDate,
      remainingDays: toNumber(grant.grantedDays) - sumConsumedDays(grant.consumptions),
    })),
    requests: requests.map((request) => ({
      id: request.id,
      targetDate: request.targetDate,
      unit: request.unit,
      hours: request.hours,
      batchId: request.batchId,
      status: request.status,
      requestedAt: request.requestedAt,
      reviewedById: request.reviewedById,
      reviewedByName: request.reviewedBy?.name ?? null,
      reviewedAt: request.reviewedAt,
      rejectReason: request.rejectReason,
      cancelledBy: request.cancelledBy,
      cancelledAt: request.cancelledAt,
      cancelReason: request.cancelReason,
    })),
  };
}

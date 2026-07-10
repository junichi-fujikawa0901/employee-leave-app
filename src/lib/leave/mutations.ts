import type { LeaveRequest, LeaveUnit } from "@/generated/prisma/client";
import { LeaveRequestStatus } from "@/generated/prisma/client";
import { startOfTodayUTC } from "@/lib/date/calendar";
import { decimalToNumber } from "@/lib/decimal";
import { planFefoConsumption } from "@/lib/leave/balance";
import {
  DuplicateRequestError,
  ExceedsDailyLimitError,
  NotRequestOwnerError,
  RequestNotApprovedError,
  RequestNotFoundError,
  RequestNotPendingError,
  SelfApprovalError,
  WithdrawalDeadlinePassedError,
} from "@/lib/leave/errors";
import { checkNewRequest, isWithinWithdrawalWindow, unitToDays } from "@/lib/leave/request-rules";
import { prisma } from "@/lib/prisma";

/** spec.md 6章-2: 重複申請・1日合計1.0日超過チェックを行った上で申請を作成する */
export async function createLeaveRequest(input: {
  userId: string;
  targetDate: Date;
  unit: LeaveUnit;
}): Promise<LeaveRequest> {
  return prisma.$transaction(async (tx) => {
    const targetDateLockKey = Math.trunc(input.targetDate.getTime() / (1000 * 60 * 60 * 24));
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}), ${targetDateLockKey})`;

    const existing = await tx.leaveRequest.findMany({
      where: {
        userId: input.userId,
        targetDate: input.targetDate,
        status: { in: [LeaveRequestStatus.pending, LeaveRequestStatus.approved] },
      },
      select: { unit: true },
    });

    const check = checkNewRequest(
      existing.map((request) => request.unit),
      input.unit,
    );
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
      },
    });
  });
}

/** spec.md 4.3/6章-4: 申請者本人が「申請中」の申請のみ取消できる */
export async function cancelLeaveRequest(input: {
  requestId: string;
  actingUserId: string;
  reason?: string;
}): Promise<void> {
  const result = await prisma.leaveRequest.updateMany({
    where: { id: input.requestId, userId: input.actingUserId, status: LeaveRequestStatus.pending },
    data: {
      status: LeaveRequestStatus.cancelled,
      cancelledBy: input.actingUserId,
      cancelledAt: new Date(),
      cancelReason: input.reason?.trim() || null,
    },
  });

  if (result.count === 0) {
    throw new NotRequestOwnerError();
  }
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

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.leaveRequest.updateMany({
      where: { id: input.requestId, status: LeaveRequestStatus.approved },
      data: {
        status: LeaveRequestStatus.cancelled,
        cancelledBy: input.actingUserId,
        cancelledAt: new Date(),
        cancelReason: input.reason?.trim() || null,
      },
    });
    if (claimed.count === 0) {
      throw new RequestNotApprovedError();
    }

    await tx.leaveConsumption.updateMany({
      where: { leaveRequestId: input.requestId, cancelledAt: null },
      data: { cancelledAt: new Date() },
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

  await prisma.$transaction(async (tx) => {
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
    const plan = planFefoConsumption(grantBalances, unitToDays(request.unit));

    await tx.leaveConsumption.createMany({
      data: plan.map((item) => ({
        leaveRequestId: request.id,
        leaveGrantId: item.grantId,
        consumedDays: item.consumedDays,
      })),
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

  const result = await prisma.leaveRequest.updateMany({
    where: { id: input.requestId, status: LeaveRequestStatus.pending },
    data: {
      status: LeaveRequestStatus.rejected,
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
      rejectReason: input.reason?.trim() || null,
    },
  });

  if (result.count === 0) {
    throw new RequestNotPendingError();
  }
}

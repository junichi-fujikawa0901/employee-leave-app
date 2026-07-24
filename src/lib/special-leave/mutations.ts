import { AuditAction, Prisma, SpecialLeaveRequestStatus, SpecialLeaveType, UserStatus } from "@/generated/prisma/client";
import { recordAuditLog } from "@/lib/audit/log";
import { toUtcMidnight } from "@/lib/date/calendar";
import { prisma } from "@/lib/prisma";
import {
  InvalidDateRangeError,
  SpecialLeaveNotRequestOwnerError,
  SpecialLeaveRequestNotFoundError,
  SpecialLeaveRequestNotPendingError,
  SpecialLeaveSelfApprovalError,
  SpecialLeaveTargetNotActiveError,
  SummerLeaveCapExceededError,
  SummerLeaveOutsideWindowError,
} from "@/lib/special-leave/errors";
import { checkSummerCap, countDays, getSummerWindowForYear, isWithinWindow } from "@/lib/special-leave/rules";

/**
 * 夏季休暇の年間上限チェックを直列化するadvisory lock。既存の有給申請ロック
 * (userId単独や `${userId}:hourly-cap`)とは別のsalt文字列を使うため通常は衝突しない。
 * ただしhashtextは32bitハッシュのため、異なるuserIdが偶然同じ値になる可能性はゼロではない
 * (その場合も整合性は壊れず、無関係なユーザー同士が不要にロック待ちするだけ)。
 */
async function lockSummerLeaveCap(tx: Prisma.TransactionClient, userId: string, year: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:special-summer-cap`}), ${year})`;
}

/**
 * 同一ユーザー・同一年で指定statusesに該当する夏季休暇の合計日数を返す。
 * excludeRequestIdを渡すと、その申請自身は集計から除外する。
 * 作成時はpending+approvedの合計(二重予約防止)、承認時はapprovedのみ(既存
 * assertWithinHourlyCapの承認時再検証と同じ考え方。他のpending申請はまだ確定して
 * いないため承認時のブロッキング判定には含めず、それらが承認される時点で個別に判定する)。
 */
async function sumSummerLeaveDays(
  tx: Prisma.TransactionClient,
  userId: string,
  year: number,
  statuses: SpecialLeaveRequestStatus[],
  excludeRequestId?: string,
): Promise<number> {
  const window = getSummerWindowForYear(year);
  const requests = await tx.specialLeaveRequest.findMany({
    where: {
      userId,
      type: SpecialLeaveType.summer,
      status: { in: statuses },
      startDate: { gte: window.start },
      endDate: { lte: window.end },
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
    },
    select: { startDate: true, endDate: true },
  });
  return requests.reduce((sum, request) => sum + countDays(request.startDate, request.endDate), 0);
}

export async function createSpecialLeaveRequest(input: {
  userId: string;
  type: SpecialLeaveType;
  startDate: Date;
  endDate: Date;
}): Promise<void> {
  const startDate = toUtcMidnight(input.startDate);
  const endDate = toUtcMidnight(input.endDate);
  if (startDate.getTime() > endDate.getTime()) {
    throw new InvalidDateRangeError();
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.status !== UserStatus.active) {
      throw new SpecialLeaveTargetNotActiveError();
    }

    if (input.type === SpecialLeaveType.summer) {
      const year = startDate.getUTCFullYear();
      const window = getSummerWindowForYear(year);
      if (!isWithinWindow(startDate, endDate, window)) {
        throw new SummerLeaveOutsideWindowError();
      }

      await lockSummerLeaveCap(tx, input.userId, year);

      const existingDays = await sumSummerLeaveDays(tx, input.userId, year, [
        SpecialLeaveRequestStatus.pending,
        SpecialLeaveRequestStatus.approved,
      ]);
      const newDays = countDays(startDate, endDate);
      if (!checkSummerCap(existingDays, newDays).ok) {
        throw new SummerLeaveCapExceededError();
      }
    }

    await tx.specialLeaveRequest.create({
      data: { userId: input.userId, type: input.type, startDate, endDate },
    });
  });
}

export async function approveSpecialLeaveRequest(input: { requestId: string; reviewerId: string }): Promise<void> {
  const request = await prisma.specialLeaveRequest.findUnique({ where: { id: input.requestId } });
  if (!request) {
    throw new SpecialLeaveRequestNotFoundError();
  }
  if (request.status !== SpecialLeaveRequestStatus.pending) {
    throw new SpecialLeaveRequestNotPendingError();
  }
  if (request.userId === input.reviewerId) {
    throw new SpecialLeaveSelfApprovalError();
  }
  // 直接DB操作等でcreateSpecialLeaveRequestの検証を経ずに作られたレコード(startDate>endDate等)
  // を承認できてしまわないよう、作成時に行うバリデーションを承認時にも再チェックする
  if (request.startDate.getTime() > request.endDate.getTime()) {
    throw new InvalidDateRangeError();
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: request.userId } });
    if (!user || user.status !== UserStatus.active) {
      throw new SpecialLeaveTargetNotActiveError();
    }

    if (request.type === SpecialLeaveType.summer) {
      const year = request.startDate.getUTCFullYear();
      const window = getSummerWindowForYear(year);
      if (!isWithinWindow(request.startDate, request.endDate, window)) {
        throw new SummerLeaveOutsideWindowError();
      }

      await lockSummerLeaveCap(tx, request.userId, year);

      // 直接DB操作等でcreateSpecialLeaveRequestの検証を経ずに作られたレコードを承認
      // できてしまわないよう、承認時にも上限を再チェックする(既存hourly capの承認時
      // 再検証と同じ設計思想)。他のpending申請はまだ確定していないためapprovedのみを対象にする。
      const existingDays = await sumSummerLeaveDays(
        tx,
        request.userId,
        year,
        [SpecialLeaveRequestStatus.approved],
        request.id,
      );
      const newDays = countDays(request.startDate, request.endDate);
      if (!checkSummerCap(existingDays, newDays).ok) {
        throw new SummerLeaveCapExceededError();
      }
    }

    const claimed = await tx.specialLeaveRequest.updateMany({
      where: { id: input.requestId, status: SpecialLeaveRequestStatus.pending },
      data: {
        status: SpecialLeaveRequestStatus.approved,
        reviewedById: input.reviewerId,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new SpecialLeaveRequestNotPendingError();
    }

    await recordAuditLog(tx, {
      actorId: input.reviewerId,
      action: AuditAction.special_leave_request_approved,
      targetUserId: request.userId,
      targetId: request.id,
      detail: {
        type: request.type,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
      },
    });
  });
}

export async function rejectSpecialLeaveRequest(input: {
  requestId: string;
  reviewerId: string;
  reason?: string;
}): Promise<void> {
  const request = await prisma.specialLeaveRequest.findUnique({ where: { id: input.requestId } });
  if (!request) {
    throw new SpecialLeaveRequestNotFoundError();
  }
  if (request.status !== SpecialLeaveRequestStatus.pending) {
    throw new SpecialLeaveRequestNotPendingError();
  }
  if (request.userId === input.reviewerId) {
    throw new SpecialLeaveSelfApprovalError();
  }

  const rejectReason = input.reason?.trim() || null;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.specialLeaveRequest.updateMany({
      where: { id: input.requestId, status: SpecialLeaveRequestStatus.pending },
      data: {
        status: SpecialLeaveRequestStatus.rejected,
        reviewedById: input.reviewerId,
        reviewedAt: new Date(),
        rejectReason,
      },
    });
    if (claimed.count === 0) {
      throw new SpecialLeaveRequestNotPendingError();
    }

    await recordAuditLog(tx, {
      actorId: input.reviewerId,
      action: AuditAction.special_leave_request_rejected,
      targetUserId: request.userId,
      targetId: request.id,
      detail: {
        type: request.type,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
        reason: rejectReason,
      },
    });
  });
}

export async function cancelSpecialLeaveRequest(input: {
  requestId: string;
  actingUserId: string;
  reason?: string;
}): Promise<void> {
  const request = await prisma.specialLeaveRequest.findUnique({ where: { id: input.requestId } });
  if (!request) {
    throw new SpecialLeaveRequestNotFoundError();
  }
  if (request.userId !== input.actingUserId) {
    throw new SpecialLeaveNotRequestOwnerError();
  }
  if (request.status !== SpecialLeaveRequestStatus.pending) {
    throw new SpecialLeaveRequestNotPendingError();
  }

  const cancelReason = input.reason?.trim() || null;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.specialLeaveRequest.updateMany({
      where: { id: input.requestId, status: SpecialLeaveRequestStatus.pending },
      data: {
        status: SpecialLeaveRequestStatus.cancelled,
        cancelledBy: input.actingUserId,
        cancelledAt: new Date(),
        cancelReason,
      },
    });
    if (claimed.count === 0) {
      throw new SpecialLeaveRequestNotPendingError();
    }

    await recordAuditLog(tx, {
      actorId: input.actingUserId,
      action: AuditAction.special_leave_request_cancelled,
      targetUserId: request.userId,
      targetId: request.id,
      detail: {
        type: request.type,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
        reason: cancelReason,
      },
    });
  });
}

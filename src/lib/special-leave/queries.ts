import { SpecialLeaveRequestStatus, SpecialLeaveType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { countDays, getSummerWindowForYear, SUMMER_LEAVE_MAX_DAYS } from "@/lib/special-leave/rules";

export interface SpecialLeaveRequestItem {
  id: string;
  type: SpecialLeaveType;
  startDate: Date;
  endDate: Date;
  days: number;
  status: SpecialLeaveRequestStatus;
  requestedAt: Date;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  rejectReason: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

/** 社員詳細画面の「特別休暇取得履歴」セクション用(閲覧専用) */
export async function getSpecialLeaveRequestsForUser(userId: string): Promise<SpecialLeaveRequestItem[]> {
  const requests = await prisma.specialLeaveRequest.findMany({
    where: { userId },
    include: { reviewedBy: { select: { name: true } } },
    orderBy: { startDate: "desc" },
  });

  return requests.map((request) => ({
    id: request.id,
    type: request.type,
    startDate: request.startDate,
    endDate: request.endDate,
    days: countDays(request.startDate, request.endDate),
    status: request.status,
    requestedAt: request.requestedAt,
    reviewedByName: request.reviewedBy?.name ?? null,
    reviewedAt: request.reviewedAt,
    rejectReason: request.rejectReason,
    cancelledAt: request.cancelledAt,
    cancelReason: request.cancelReason,
  }));
}

export interface PendingSpecialLeaveRequestItem extends SpecialLeaveRequestItem {
  userId: string;
  userName: string;
}

/** /special-leaves の承認待ち一覧用(全社横断)。自分自身の申請を除外するかは呼び出し側の責務 */
export async function getPendingSpecialLeaveRequests(): Promise<PendingSpecialLeaveRequestItem[]> {
  const requests = await prisma.specialLeaveRequest.findMany({
    where: { status: SpecialLeaveRequestStatus.pending },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { requestedAt: "asc" },
  });

  return requests.map((request) => ({
    id: request.id,
    userId: request.userId,
    userName: request.user.name,
    type: request.type,
    startDate: request.startDate,
    endDate: request.endDate,
    days: countDays(request.startDate, request.endDate),
    status: request.status,
    requestedAt: request.requestedAt,
    reviewedByName: null,
    reviewedAt: null,
    rejectReason: null,
    cancelledAt: null,
    cancelReason: null,
  }));
}

export interface SummerLeaveUsage {
  usedDays: number;
  remainingDays: number;
}

/** 夏季休暇フォーム付近に「今年あと何日使えるか」を表示するための補助(pending+approved合計) */
export async function getSummerLeaveUsage(userId: string, year: number): Promise<SummerLeaveUsage> {
  const window = getSummerWindowForYear(year);
  const requests = await prisma.specialLeaveRequest.findMany({
    where: {
      userId,
      type: SpecialLeaveType.summer,
      status: { in: [SpecialLeaveRequestStatus.pending, SpecialLeaveRequestStatus.approved] },
      startDate: { gte: window.start },
      endDate: { lte: window.end },
    },
    select: { startDate: true, endDate: true },
  });

  const usedDays = requests.reduce((sum, request) => sum + countDays(request.startDate, request.endDate), 0);
  return { usedDays, remainingDays: Math.max(0, SUMMER_LEAVE_MAX_DAYS - usedDays) };
}

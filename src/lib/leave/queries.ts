import {
  LeaveRequestStatus,
  LeaveUnit,
  Role,
  UserStatus,
} from "@/generated/prisma/client";
import { startOfTodayUTC } from "@/lib/date/calendar";
import { decimalToNumber as toNumber } from "@/lib/decimal";
import { type GrantBalanceInput, sumRemaining } from "@/lib/leave/balance";
import { getNextGrantYearMonth } from "@/lib/leave/schedule";
import { prisma } from "@/lib/prisma";

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

  return grants.map((grant) => {
    const consumedTotal = grant.consumptions.reduce(
      (sum, consumption) => sum + toNumber(consumption.consumedDays),
      0,
    );
    return {
      id: grant.id,
      grantedDate: grant.grantedDate,
      expireDate: grant.expireDate,
      remainingDays: toNumber(grant.grantedDays) - consumedTotal,
    };
  });
}

export async function getRemainingBalance(
  userId: string,
  asOf: Date = startOfTodayUTC(),
): Promise<number> {
  const grants = await getActiveGrantsWithRemaining(userId, asOf);
  return sumRemaining(grants);
}

export async function getActiveUnitsOnDate(userId: string, targetDate: Date): Promise<LeaveUnit[]> {
  const requests = await prisma.leaveRequest.findMany({
    where: {
      userId,
      targetDate,
      status: { in: [LeaveRequestStatus.pending, LeaveRequestStatus.approved] },
    },
    select: { unit: true },
  });
  return requests.map((request) => request.unit);
}

export async function hasAnyGrant(userId: string): Promise<boolean> {
  const count = await prisma.leaveGrant.count({ where: { userId } });
  return count > 0;
}

export interface EmployeeSummary {
  id: string;
  name: string;
  role: Role;
  status: UserStatus;
  remainingDays: number;
  nextGrantYearMonth: { year: number; month: number } | null;
  hasPendingRequest: boolean;
}

/** 社員一覧画面(4.2)用。3クエリでN+1を回避してメモリ上に集計する */
export async function getEmployeeSummaries(): Promise<EmployeeSummary[]> {
  const asOf = startOfTodayUTC();

  const users = await prisma.user.findMany({ orderBy: { hireDate: "asc" } });
  const userIds = users.map((user) => user.id);

  const [grants, pendingRequests] = await Promise.all([
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
  ]);

  const remainingByUser = new Map<string, number>();
  for (const grant of grants) {
    const consumedTotal = grant.consumptions.reduce(
      (sum, consumption) => sum + toNumber(consumption.consumedDays),
      0,
    );
    const remaining = toNumber(grant.grantedDays) - consumedTotal;
    remainingByUser.set(grant.userId, (remainingByUser.get(grant.userId) ?? 0) + remaining);
  }

  const pendingUserIds = new Set(pendingRequests.map((request) => request.userId));

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    status: user.status,
    remainingDays: remainingByUser.get(user.id) ?? 0,
    nextGrantYearMonth:
      user.status === UserStatus.active ? getNextGrantYearMonth(user.hireDate, asOf) : null,
    hasPendingRequest: pendingUserIds.has(user.id),
  }));
}

export interface GrantHistoryItem {
  id: string;
  grantedDate: Date;
  grantedDays: number;
  expireDate: Date;
}

export interface RequestHistoryItem {
  id: string;
  targetDate: Date;
  unit: LeaveUnit;
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
  grants: GrantHistoryItem[];
  requests: RequestHistoryItem[];
}

/** 社員詳細画面(4.3)用 */
export async function getEmployeeDetail(userId: string): Promise<EmployeeDetail | null> {
  const asOf = startOfTodayUTC();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return null;
  }

  const [activeGrants, grants, requests] = await Promise.all([
    getActiveGrantsWithRemaining(userId, asOf),
    prisma.leaveGrant.findMany({
      where: { userId },
      orderBy: [{ expireDate: "asc" }, { grantedDate: "asc" }, { id: "asc" }],
    }),
    prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { targetDate: "desc" },
      include: { reviewedBy: { select: { name: true } } },
    }),
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
    grants: grants.map((grant) => ({
      id: grant.id,
      grantedDate: grant.grantedDate,
      grantedDays: toNumber(grant.grantedDays),
      expireDate: grant.expireDate,
    })),
    requests: requests.map((request) => ({
      id: request.id,
      targetDate: request.targetDate,
      unit: request.unit,
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

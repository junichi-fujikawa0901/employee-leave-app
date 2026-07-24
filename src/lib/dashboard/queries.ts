import { LeaveRequestStatus, type LeaveUnit } from "@/generated/prisma/client";
import {
  addDaysUTC,
  addYearsUTC,
  endOfMonthUTC,
  startOfMonthUTC,
  startOfTodayUTC,
  toUtcMidnight,
} from "@/lib/date/calendar";
import { decimalToNumber as toNumber } from "@/lib/decimal";
import { getEmployeeSummaries } from "@/lib/leave/queries";
import { prisma } from "@/lib/prisma";

/** 管理者ダッシュボード(承認待ち件数)。全社の申請ステータスがpendingのものを数える */
export async function countPendingRequests(): Promise<number> {
  return prisma.leaveRequest.count({ where: { status: LeaveRequestStatus.pending } });
}

function sumConsumedDays(consumptions: { consumedDays: { toNumber(): number } }[]): number {
  return consumptions.reduce((sum, consumption) => sum + toNumber(consumption.consumedDays), 0);
}

/**
 * 管理者ダッシュボード(今月失効する有給日数)。expireDateが当月(暦月、1日〜末日)の範囲内にある
 * 付与の残高(消化されずに残っている日数。全消化済みで残高0の付与は0として扱う)を全社合計する。
 * 月内であればasOfより前に既に失効した付与も対象(暦月全体を「今月失効」として扱う仕様)。
 */
export async function getExpiringDaysThisMonth(asOf: Date = startOfTodayUTC()): Promise<number> {
  const normalizedAsOf = toUtcMidnight(asOf);
  const monthStart = startOfMonthUTC(normalizedAsOf);
  const monthEnd = endOfMonthUTC(normalizedAsOf);

  const grants = await prisma.leaveGrant.findMany({
    where: { expireDate: { gte: monthStart, lte: monthEnd } },
    include: {
      consumptions: { where: { cancelledAt: null }, select: { consumedDays: true } },
    },
  });

  return grants.reduce((sum, grant) => {
    const remaining = toNumber(grant.grantedDays) - sumConsumedDays(grant.consumptions);
    return sum + Math.max(0, remaining);
  }, 0);
}

/**
 * 管理者ダッシュボード(年5日取得義務の未達人数)。社員一覧画面と同じgetEmployeeSummariesの
 * 義務ステータス計算をそのまま再利用し、met以外(on_track/at_risk/overdue)を未達として数える。
 */
export async function countUnmetObligationEmployees(): Promise<number> {
  const employees = await getEmployeeSummaries();
  return employees.filter((employee) => employee.obligation !== null && employee.obligation.status !== "met")
    .length;
}

export interface CompanyWideUtilization {
  from: Date;
  to: Date;
  grantedDays: number;
  consumedDays: number;
  /** grantedDaysが0のときはゼロ除算を避けるためnull */
  rate: number | null;
}

/**
 * 管理者ダッシュボード(全社の有給取得率)。指定期間(from〜to、両端含む)に付与された日数の合計に対する、
 * 同期間に消化(承認済み申請の対象日ベース)された日数の合計の比率。絞り込み条件は
 * getExportSummary の grantsInPeriod/consumptionsInPeriod ブロックと同一定義。
 */
export async function getCompanyWideUtilization(from: Date, to: Date): Promise<CompanyWideUtilization> {
  const normalizedFrom = toUtcMidnight(from);
  const normalizedTo = toUtcMidnight(to);

  const [grantedAgg, consumedAgg] = await Promise.all([
    prisma.leaveGrant.aggregate({
      where: { grantedDate: { gte: normalizedFrom, lte: normalizedTo } },
      _sum: { grantedDays: true },
    }),
    prisma.leaveConsumption.aggregate({
      where: {
        cancelledAt: null,
        leaveRequest: {
          status: LeaveRequestStatus.approved,
          targetDate: { gte: normalizedFrom, lte: normalizedTo },
        },
      },
      _sum: { consumedDays: true },
    }),
  ]);

  const grantedDays = grantedAgg._sum.grantedDays ? toNumber(grantedAgg._sum.grantedDays) : 0;
  const consumedDays = consumedAgg._sum.consumedDays ? toNumber(consumedAgg._sum.consumedDays) : 0;

  return {
    from: normalizedFrom,
    to: normalizedTo,
    grantedDays,
    consumedDays,
    rate: grantedDays > 0 ? consumedDays / grantedDays : null,
  };
}

/** 直近12ヶ月(今日を含む)のローリングウィンドウ。全社取得率のデフォルト対象期間 */
export function getTrailingYearRange(asOf: Date = startOfTodayUTC()): { from: Date; to: Date } {
  const to = toUtcMidnight(asOf);
  const from = addDaysUTC(addYearsUTC(to, -1), 1);
  return { from, to };
}

export interface PendingRequestRow {
  id: string;
  userId: string;
  userName: string;
  targetDate: Date;
  unit: LeaveUnit;
  hours: number | null;
  requestedAt: Date;
}

export interface PendingBatchGroup {
  batchId: string;
  userId: string;
  userName: string;
  dates: Date[];
  requestIds: string[];
}

export interface PendingRequestsOverview {
  batchGroups: PendingBatchGroup[];
  singleRequests: PendingRequestRow[];
}

/**
 * 管理者ダッシュボード(承認待ち一覧)。全社のpending申請を取得し、batchIdごとにグルーピングする。
 * ただしbatchId付きでもpendingが1件しか残っていないものは、employees/[id]/page.tsxの
 * 一括申請表示と同じ方針で「まとめて」感がないため単独申請として扱う。
 */
export async function getPendingRequestsOverview(): Promise<PendingRequestsOverview> {
  const requests = await prisma.leaveRequest.findMany({
    where: { status: LeaveRequestStatus.pending },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { requestedAt: "asc" },
  });

  const singleRequests: PendingRequestRow[] = [];
  const byBatch = new Map<string, typeof requests>();

  for (const request of requests) {
    if (!request.batchId) {
      singleRequests.push({
        id: request.id,
        userId: request.userId,
        userName: request.user.name,
        targetDate: request.targetDate,
        unit: request.unit,
        hours: request.hours,
        requestedAt: request.requestedAt,
      });
      continue;
    }
    const group = byBatch.get(request.batchId) ?? [];
    group.push(request);
    byBatch.set(request.batchId, group);
  }

  const batchGroups: PendingBatchGroup[] = [];
  for (const [batchId, group] of byBatch) {
    if (group.length < 2) {
      const only = group[0];
      singleRequests.push({
        id: only.id,
        userId: only.userId,
        userName: only.user.name,
        targetDate: only.targetDate,
        unit: only.unit,
        hours: only.hours,
        requestedAt: only.requestedAt,
      });
      continue;
    }
    batchGroups.push({
      batchId,
      userId: group[0].userId,
      userName: group[0].user.name,
      dates: group.map((r) => r.targetDate).sort((a, b) => a.getTime() - b.getTime()),
      requestIds: group.map((r) => r.id),
    });
  }

  singleRequests.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  batchGroups.sort((a, b) => a.dates[0].getTime() - b.dates[0].getTime());

  return { batchGroups, singleRequests };
}

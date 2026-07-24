import { afterEach, describe, expect, it } from "vitest";

import { addDaysUTC, addYearsUTC, startOfTodayUTC } from "@/lib/date/calendar";
import {
  countPendingRequests,
  countUnmetObligationEmployees,
  getCompanyWideUtilization,
  getExpiringDaysThisMonth,
  getPendingRequestsOverview,
} from "@/lib/dashboard/queries";
import { computeExpireDate } from "@/lib/leave/schedule";
import { prisma } from "@/lib/prisma";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdUserIds: string[] = [];

async function createTestUser(hireDate: Date): Promise<{ id: string }> {
  const email = `${crypto.randomUUID()}@dashboard-test.local`;
  const user = await prisma.user.create({
    data: {
      name: `ダッシュボードテスト ${email}`,
      email,
      passwordHash: "not-used-in-test",
      role: "employee",
      hireDate,
      status: "active",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id };
}

async function createGrant(
  userId: string,
  grantedDate: Date,
  grantedDays: number,
  options?: { expireDate?: Date },
): Promise<{ id: string }> {
  return prisma.leaveGrant.create({
    data: {
      userId,
      grantType: "annual_auto",
      grantedDate,
      grantedDays,
      expireDate: options?.expireDate ?? computeExpireDate(grantedDate),
    },
    select: { id: true },
  });
}

async function createRequest(
  userId: string,
  targetDate: Date,
  status: "pending" | "approved" | "rejected" | "cancelled",
  options?: { batchId?: string },
): Promise<{ id: string }> {
  return prisma.leaveRequest.create({
    data: { userId, targetDate, unit: "full_day", status, batchId: options?.batchId },
    select: { id: true },
  });
}

async function createConsumption(
  leaveRequestId: string,
  leaveGrantId: string,
  consumedDays: number,
  options?: { cancelledAt?: Date },
): Promise<void> {
  await prisma.leaveConsumption.create({
    data: { leaveRequestId, leaveGrantId, consumedDays, cancelledAt: options?.cancelledAt ?? null },
  });
}

afterEach(async () => {
  if (createdUserIds.length === 0) {
    return;
  }
  await prisma.leaveConsumption.deleteMany({
    where: { leaveGrant: { userId: { in: createdUserIds } } },
  });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: createdUserIds } }, { targetUserId: { in: createdUserIds } }] },
  });
  await prisma.leaveRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.leaveGrant.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("countPendingRequests", () => {
  it("全社のpendingステータスの申請のみを数える", async () => {
    const user = await createTestUser(utc(2024, 1, 1));

    const before = await countPendingRequests();

    await createRequest(user.id, utc(2026, 8, 1), "pending");
    await createRequest(user.id, utc(2026, 8, 2), "approved");
    await createRequest(user.id, utc(2026, 8, 3), "rejected");
    await createRequest(user.id, utc(2026, 8, 4), "cancelled");

    const after = await countPendingRequests();

    expect(after - before).toBe(1);
  });
});

describe("getExpiringDaysThisMonth", () => {
  const asOf = utc(2026, 3, 15);

  it("当月にexpireDateを持つ付与の残高のみを合計する(前月・翌月は含めない)", async () => {
    // 全社集計(既存シードデータの影響を受ける)ため、対象データ作成前後の差分で検証する
    const before = await getExpiringDaysThisMonth(asOf);

    const user = await createTestUser(utc(2020, 1, 1));
    await createGrant(user.id, utc(2024, 3, 20), 10, { expireDate: utc(2026, 3, 1) }); // 当月月初
    await createGrant(user.id, utc(2024, 3, 31), 5, { expireDate: utc(2026, 3, 31) }); // 当月月末
    await createGrant(user.id, utc(2024, 2, 28), 3, { expireDate: utc(2026, 2, 28) }); // 前月(対象外)
    await createGrant(user.id, utc(2024, 4, 1), 7, { expireDate: utc(2026, 4, 1) }); // 翌月(対象外)

    const after = await getExpiringDaysThisMonth(asOf);

    expect(after - before).toBe(15);
  });

  it("一部消化済みの付与は残高分のみを合計し、全消化済みの付与は0として扱う(マイナスにならない)", async () => {
    const before = await getExpiringDaysThisMonth(asOf);

    const user = await createTestUser(utc(2020, 1, 1));
    const partiallyConsumed = await createGrant(user.id, utc(2024, 3, 1), 10, {
      expireDate: utc(2026, 3, 10),
    });
    const fullyConsumed = await createGrant(user.id, utc(2024, 3, 2), 5, {
      expireDate: utc(2026, 3, 20),
    });

    const req1 = await createRequest(user.id, utc(2025, 6, 1), "approved");
    await createConsumption(req1.id, partiallyConsumed.id, 4);

    const req2 = await createRequest(user.id, utc(2025, 6, 2), "approved");
    await createConsumption(req2.id, fullyConsumed.id, 5);

    const after = await getExpiringDaysThisMonth(asOf);

    expect(after - before).toBe(6); // (10-4) + (5-5)
  });

  it("取消済み(cancelledAt付き)の消化は残高計算から除外する", async () => {
    const before = await getExpiringDaysThisMonth(asOf);

    const user = await createTestUser(utc(2020, 1, 1));
    const grant = await createGrant(user.id, utc(2024, 3, 1), 10, { expireDate: utc(2026, 3, 10) });
    const req = await createRequest(user.id, utc(2025, 6, 1), "cancelled");
    await createConsumption(req.id, grant.id, 4, { cancelledAt: utc(2025, 6, 5) });

    const after = await getExpiringDaysThisMonth(asOf);

    expect(after - before).toBe(10);
  });
});

describe("countUnmetObligationEmployees", () => {
  it("年5日取得義務がmet以外(on_track/at_risk/overdue)の社員を数える。義務対象外(付与10日未満)やmet済みの社員は数えない", async () => {
    const today = startOfTodayUTC();

    // 既存シードデータの影響を避けるため、対象社員を作る前後の差分で検証する
    const before = await countUnmetObligationEmployees();

    const overdueUser = await createTestUser(addYearsUTC(today, -3));
    await createGrant(overdueUser.id, addYearsUTC(today, -2), 10); // 義務期間は1年前に終了、未消化のままoverdue

    const atRiskUser = await createTestUser(addDaysUTC(today, -335));
    await createGrant(atRiskUser.id, addDaysUTC(today, -335), 10); // 義務期間の期限まで残り29日、未消化のままat_risk

    const metUser = await createTestUser(addYearsUTC(today, -1));
    const metGrant = await createGrant(metUser.id, addDaysUTC(today, -30), 10); // 義務期間はまだ進行中
    for (let i = 0; i < 5; i += 1) {
      const req = await createRequest(metUser.id, addDaysUTC(today, -20 + i), "approved");
      await createConsumption(req.id, metGrant.id, 1);
    }

    const notEligibleUser = await createTestUser(addDaysUTC(today, -30));
    await createGrant(notEligibleUser.id, addDaysUTC(today, -30), 9); // 10日未満は義務対象外

    const after = await countUnmetObligationEmployees();

    expect(after - before).toBe(2); // overdueUser + atRiskUser
  });
});

describe("getCompanyWideUtilization", () => {
  it("期間内の付与合計・消化合計から消化率を計算する(期間外・取消済みは除外)", async () => {
    const from = utc(2025, 1, 1);
    const to = utc(2025, 12, 31);

    // 全社集計(既存シードデータの影響を受ける)ため、対象データ作成前後の差分で検証する
    const before = await getCompanyWideUtilization(from, to);

    const user = await createTestUser(utc(2020, 1, 1));
    const grant = await createGrant(user.id, utc(2025, 1, 10), 10, { expireDate: utc(2027, 1, 9) });
    await createGrant(user.id, utc(2024, 12, 1), 5, { expireDate: utc(2026, 11, 30) }); // 期間外の付与

    const req1 = await createRequest(user.id, utc(2025, 6, 1), "approved");
    await createConsumption(req1.id, grant.id, 2);

    const req2 = await createRequest(user.id, utc(2024, 12, 15), "approved"); // 期間外の消化
    await createConsumption(req2.id, grant.id, 1);

    const req3 = await createRequest(user.id, utc(2025, 7, 1), "cancelled");
    await createConsumption(req3.id, grant.id, 3, { cancelledAt: utc(2025, 7, 5) }); // 取消済み

    const after = await getCompanyWideUtilization(from, to);

    expect(after.grantedDays - before.grantedDays).toBe(10);
    expect(after.consumedDays - before.consumedDays).toBe(2);
  });

  it("期間内の付与が0のときrateはnullになる(ゼロ除算回避)", async () => {
    const result = await getCompanyWideUtilization(utc(1999, 1, 1), utc(1999, 1, 2));

    expect(result.grantedDays).toBe(0);
    expect(result.rate).toBeNull();
  });
});

describe("getPendingRequestsOverview", () => {
  it("batchIdなしのpending申請は単独申請として返り、他ステータスは含まれない", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const pendingReq = await createRequest(user.id, utc(2026, 9, 1), "pending");
    const approvedReq = await createRequest(user.id, utc(2026, 9, 2), "approved");

    const { singleRequests } = await getPendingRequestsOverview();

    const found = singleRequests.find((r) => r.id === pendingReq.id);
    expect(found).toBeDefined();
    expect(found?.userId).toBe(user.id);
    expect(found?.unit).toBe("full_day");

    expect(singleRequests.find((r) => r.id === approvedReq.id)).toBeUndefined();
  });

  it("batchIdでpendingが2件以上残っている場合はbatchGroupにまとめられ、単独申請には含まれない", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const batchId = crypto.randomUUID();
    const req1 = await createRequest(user.id, utc(2026, 9, 11), "pending", { batchId });
    const req2 = await createRequest(user.id, utc(2026, 9, 10), "pending", { batchId });

    const { batchGroups, singleRequests } = await getPendingRequestsOverview();

    const group = batchGroups.find((g) => g.batchId === batchId);
    expect(group).toBeDefined();
    expect(group?.userId).toBe(user.id);
    expect(group?.requestIds.sort()).toEqual([req1.id, req2.id].sort());
    expect(group?.dates.map((d) => d.getTime())).toEqual([utc(2026, 9, 10).getTime(), utc(2026, 9, 11).getTime()]); // 日付昇順

    expect(singleRequests.find((r) => r.id === req1.id || r.id === req2.id)).toBeUndefined();
  });

  it("同じbatchIdにpending2件とapproved1件が混在する場合、pending2件だけがbatchGroupに入る", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const batchId = crypto.randomUUID();
    const pending1 = await createRequest(user.id, utc(2026, 9, 12), "pending", { batchId });
    const pending2 = await createRequest(user.id, utc(2026, 9, 13), "pending", { batchId });
    await createRequest(user.id, utc(2026, 9, 14), "approved", { batchId });

    const { batchGroups } = await getPendingRequestsOverview();

    const group = batchGroups.find((g) => g.batchId === batchId);
    expect(group).toBeDefined();
    expect(group?.requestIds.sort()).toEqual([pending1.id, pending2.id].sort());
  });

  it("batchIdでpendingが1件しか残っていない場合は単独申請として扱う(まとめて操作する意味がないため)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const batchId = crypto.randomUUID();
    const req = await createRequest(user.id, utc(2026, 9, 20), "pending", { batchId });
    await createRequest(user.id, utc(2026, 9, 21), "approved", { batchId }); // 既に承認済みでpendingは1件のみ

    const { batchGroups, singleRequests } = await getPendingRequestsOverview();

    expect(batchGroups.find((g) => g.batchId === batchId)).toBeUndefined();
    expect(singleRequests.find((r) => r.id === req.id)).toBeDefined();
  });
});

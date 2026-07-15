import { describe, it, expect, afterEach } from "vitest";

import { getAnnualObligation, getLeaveLedger } from "@/lib/leave/queries";
import { computeExpireDate } from "@/lib/leave/schedule";
import { prisma } from "@/lib/prisma";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdUserIds: string[] = [];

async function createTestUser(hireDate: Date): Promise<{ id: string }> {
  const email = `${crypto.randomUUID()}@annual-obligation-test.local`;
  const user = await prisma.user.create({
    data: {
      name: `年5日義務テスト ${email}`,
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

async function createAnnualAutoGrant(
  userId: string,
  grantedDate: Date,
  grantedDays: number,
): Promise<{ id: string }> {
  return prisma.leaveGrant.create({
    data: {
      userId,
      grantType: "annual_auto",
      grantedDate,
      grantedDays,
      expireDate: computeExpireDate(grantedDate),
    },
    select: { id: true },
  });
}

async function createApprovedRequest(userId: string, targetDate: Date): Promise<void> {
  await createRequest(userId, targetDate, "approved");
}

async function createRequest(
  userId: string,
  targetDate: Date,
  status: "approved" | "cancelled",
): Promise<void> {
  await prisma.leaveRequest.create({
    data: {
      userId,
      targetDate,
      unit: "full_day",
      status,
    },
  });
}

/** getLeaveLedger用: 承認済み申請(reviewedAt指定)+消化明細をまとめて作成する */
async function createApprovedRequestWithConsumption(
  userId: string,
  targetDate: Date,
  reviewedAt: Date,
  grantId: string,
  consumedDays: number,
): Promise<void> {
  const request = await prisma.leaveRequest.create({
    data: { userId, targetDate, unit: "full_day", status: "approved", reviewedAt },
    select: { id: true },
  });
  await prisma.leaveConsumption.create({
    data: { leaveRequestId: request.id, leaveGrantId: grantId, consumedDays },
  });
}

/** getLeaveLedger用: 時間単位年休の承認済み申請(reviewedAt指定)+消化明細をまとめて作成する */
async function createApprovedHourlyRequestWithConsumption(
  userId: string,
  targetDate: Date,
  reviewedAt: Date,
  grantId: string,
  hours: number,
  consumedDays: number,
): Promise<void> {
  const request = await prisma.leaveRequest.create({
    data: { userId, targetDate, unit: "hourly", hours, status: "approved", reviewedAt },
    select: { id: true },
  });
  await prisma.leaveConsumption.create({
    data: { leaveRequestId: request.id, leaveGrantId: grantId, consumedDays },
  });
}

afterEach(async () => {
  if (createdUserIds.length === 0) {
    return;
  }
  await prisma.leaveConsumption.deleteMany({
    where: { leaveGrant: { userId: { in: createdUserIds } } },
  });
  await prisma.leaveRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.leaveGrant.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("getAnnualObligation", () => {
  it("過年度の未達期間と当年度のmet期間がある場合、currentは過年度の未達を指し、当年度分はotherUnmetCountに数えない", async () => {
    const user = await createTestUser(utc(2022, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2023, 7, 1), 10); // 2023-07-01〜2024-06-30、未達のまま
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 11); // 2024-07-01〜2025-06-30、5日取得してmetにする

    for (const day of [1, 2, 3, 4, 5]) {
      await createApprovedRequest(user.id, utc(2024, 8, day));
    }

    const result = await getAnnualObligation(user.id, utc(2025, 1, 1));

    expect(result.current).not.toBeNull();
    expect(result.current?.period.start).toEqual(utc(2023, 7, 1));
    expect(result.current?.status.status).not.toBe("met");
    expect(result.otherUnmetCount).toBe(0);
  });

  it("未達期間が2件ある場合、より緊急な方(at_risk)がcurrentに選ばれ、残り1件がotherUnmetCountに数えられる", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2022, 7, 1), 10); // 2022-07-01〜2023-06-30、期限を大幅に過ぎている(at_risk)
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 11); // 2024-07-01〜2025-06-30、まだ期限に余裕がある(behind)

    const result = await getAnnualObligation(user.id, utc(2025, 1, 1));

    expect(result.current).not.toBeNull();
    expect(result.current?.period.start).toEqual(utc(2022, 7, 1));
    expect(result.current?.status.status).toBe("at_risk");
    expect(result.otherUnmetCount).toBe(1);
  });

  it("過去のapproved(taken)・未来のapproved(planned)・cancelled(除外)が混在する場合、taken/plannedが正しく分離される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10); // 2024-07-01〜2025-06-30

    // asOf=2024-12-01を基準に、過去分3日(taken)・未来分2日(planned)・取消済み1日(除外)を作る
    await createApprovedRequest(user.id, utc(2024, 8, 1));
    await createApprovedRequest(user.id, utc(2024, 8, 2));
    await createApprovedRequest(user.id, utc(2024, 8, 3));
    await createApprovedRequest(user.id, utc(2025, 1, 10));
    await createApprovedRequest(user.id, utc(2025, 1, 11));
    await createRequest(user.id, utc(2024, 9, 1), "cancelled");

    const result = await getAnnualObligation(user.id, utc(2024, 12, 1));

    expect(result.current).not.toBeNull();
    expect(result.current?.status.taken).toBe(3);
    expect(result.current?.status.planned).toBe(2);
  });

  it("義務対象の付与記録が無ければcurrent=null、otherUnmetCount=0を返す", async () => {
    const user = await createTestUser(utc(2024, 1, 1));

    const result = await getAnnualObligation(user.id, utc(2025, 1, 1));

    expect(result.current).toBeNull();
    expect(result.otherUnmetCount).toBe(0);
  });

  it("時間単位年休(Phase 4)の承認済み申請はtaken/plannedいずれにもカウントされない(非算入の回帰テスト)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10); // 2024-07-01〜2025-06-30

    // 過去分(taken対象になりうる日)・未来分(planned対象になりうる日)の両方を時間単位で作る
    await prisma.leaveRequest.create({
      data: { userId: user.id, targetDate: utc(2024, 8, 1), unit: "hourly", hours: 8, status: "approved" },
    });
    await prisma.leaveRequest.create({
      data: { userId: user.id, targetDate: utc(2025, 1, 10), unit: "hourly", hours: 8, status: "approved" },
    });

    const result = await getAnnualObligation(user.id, utc(2024, 12, 1));

    expect(result.current).not.toBeNull();
    expect(result.current?.status.taken).toBe(0);
    expect(result.current?.status.planned).toBe(0);
  });
});

describe("getLeaveLedger", () => {
  it("義務対象の付与記録が無ければ空配列を返す", async () => {
    const user = await createTestUser(utc(2024, 1, 1));

    const result = await getLeaveLedger(user.id, utc(2025, 1, 1));

    expect(result).toEqual([]);
  });

  it("単一期間・取得日ゼロの場合、entries=[]・taken/planned=0・remainingDaysは付与日数そのまま", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);

    const result = await getLeaveLedger(user.id, utc(2024, 12, 1));

    expect(result).toHaveLength(1);
    expect(result[0].entries).toEqual([]);
    expect(result[0].takenDays).toBe(0);
    expect(result[0].plannedDays).toBe(0);
    expect(result[0].remainingDays).toBe(10);
  });

  it("過去(実績)・未来(予定)の取得日が混在する場合、isFuture/takenDays/plannedDaysが正しく分離される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const grant = await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);
    await createApprovedRequestWithConsumption(user.id, utc(2024, 8, 1), utc(2024, 8, 1), grant.id, 1);
    await createApprovedRequestWithConsumption(user.id, utc(2025, 1, 10), utc(2025, 1, 10), grant.id, 1);

    const result = await getLeaveLedger(user.id, utc(2024, 12, 1));

    expect(result).toHaveLength(1);
    const [period] = result;
    expect(period.takenDays).toBe(1);
    expect(period.plannedDays).toBe(1);
    const past = period.entries.find((e) => e.targetDate.getTime() === utc(2024, 8, 1).getTime());
    const future = period.entries.find((e) => e.targetDate.getTime() === utc(2025, 1, 10).getTime());
    expect(past?.isFuture).toBe(false);
    expect(future?.isFuture).toBe(true);
  });

  it("複数期間がある場合、期間ごとにremainingDaysが独立して計算される", async () => {
    const user = await createTestUser(utc(2023, 1, 1));
    const grantA = await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10); // 2024-07-01〜2025-06-30
    const grantB = await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 11); // 2025-07-01〜2026-06-30
    await createApprovedRequestWithConsumption(user.id, utc(2024, 8, 1), utc(2024, 8, 1), grantA.id, 2);
    await createApprovedRequestWithConsumption(user.id, utc(2025, 8, 1), utc(2025, 8, 1), grantB.id, 3);

    const result = await getLeaveLedger(user.id, utc(2026, 1, 1));

    expect(result).toHaveLength(2);
    const [periodA, periodB] = result;
    // periodAのbalanceAsOf(2025-06-30)時点ではgrantBはまだ付与されていないためgrantAのみが対象
    expect(periodA.remainingDays).toBe(8); // grantA: 10 - 2
    // periodBのbalanceAsOf(asOf=2026-01-01、進行中の期間)時点ではgrantA・grantBの両方が有効なため合算される
    // (spec.md 5.2: 残日数は失効していない付与枠ごとの未消化日数の合計であり、期間固有の値ではない)
    expect(periodB.remainingDays).toBe(16); // grantA: 10 - 2 = 8 に grantB: 11 - 3 = 8 を加算
  });

  it("期末残はtargetDateではなくreviewedAt(承認日時)基準で計算される", async () => {
    const user = await createTestUser(utc(2023, 1, 1));
    const grant = await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10); // 期間A: 2024-07-01〜2025-06-30

    // targetDateは期間A内(過去)だがreviewedAtが期間A終了より後 → 期末残には反映されない
    await createApprovedRequestWithConsumption(user.id, utc(2024, 8, 1), utc(2025, 7, 5), grant.id, 1);
    // targetDateは期間Aの外(未来)だがreviewedAtが期間A終了以前 → 期末残に反映される
    await createApprovedRequestWithConsumption(user.id, utc(2025, 8, 1), utc(2025, 6, 20), grant.id, 1);

    const result = await getLeaveLedger(user.id, utc(2026, 1, 1));

    expect(result).toHaveLength(1);
    expect(result[0].remainingDays).toBe(9); // 10 - 1(reviewedAtが期末以前の分のみ)
  });

  it("reviewedAtが基準日当日(時刻あり)の承認は期末残に反映される(日付境界のオフバイワン回帰テスト)", async () => {
    const user = await createTestUser(utc(2023, 1, 1));
    const grant = await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10); // 期間A: 2024-07-01〜2025-06-30

    // reviewedAtは期末日(2025-06-30)当日の午後。「asOf(=期末日)の0時ちょうど」より後だが、
    // 同じ日の承認なので期末残には反映されるべき
    const reviewedAtSameDayAfternoon = new Date(Date.UTC(2025, 5, 30, 15, 0, 0));
    await createApprovedRequestWithConsumption(
      user.id,
      utc(2024, 8, 1),
      reviewedAtSameDayAfternoon,
      grant.id,
      1,
    );

    // asOfをちょうど期末日にして、進行中の期間としても・終了済みの期間としても同じ結果になることを確認する
    const result = await getLeaveLedger(user.id, utc(2025, 6, 30));

    expect(result).toHaveLength(1);
    expect(result[0].remainingDays).toBe(9); // 10 - 1(当日承認分も差し引かれる)
  });

  it("義務期間が1日重複する場合、同一取得日が両方のentriesに含まれisOverlap=trueになる", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    // Phase 2のannual-obligation.test.tsと同じ重複パターン(月末入社起因)
    const grantMid = await createAnnualAutoGrant(user.id, utc(2027, 3, 3), 11); // 〜2028-03-02
    await createAnnualAutoGrant(user.id, utc(2028, 3, 2), 12); // 2028-03-02〜(重複を発生させるためだけに必要)
    await createApprovedRequestWithConsumption(
      user.id,
      utc(2028, 3, 2),
      utc(2028, 3, 2),
      grantMid.id,
      1,
    );

    const result = await getLeaveLedger(user.id, utc(2028, 3, 2));

    const periodMid = result.find((p) => p.start.getTime() === utc(2027, 3, 3).getTime());
    const periodLast = result.find((p) => p.start.getTime() === utc(2028, 3, 2).getTime());
    expect(periodMid?.entries).toHaveLength(1);
    expect(periodLast?.entries).toHaveLength(1);
    expect(periodMid?.entries[0].isOverlap).toBe(true);
    expect(periodLast?.entries[0].isOverlap).toBe(true);
  });

  it("時間単位年休のentryはhours/consumedDaysが正しく反映される(4時間→0.5日)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const grant = await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);
    await createApprovedHourlyRequestWithConsumption(
      user.id,
      utc(2024, 8, 1),
      utc(2024, 8, 1),
      grant.id,
      4,
      0.5,
    );

    const result = await getLeaveLedger(user.id, utc(2024, 12, 1));

    expect(result).toHaveLength(1);
    expect(result[0].entries).toHaveLength(1);
    const [entry] = result[0].entries;
    expect(entry.unit).toBe("hourly");
    expect(entry.hours).toBe(4);
    expect(entry.consumedDays).toBe(0.5);
    expect(result[0].takenDays).toBe(0.5);
  });
});

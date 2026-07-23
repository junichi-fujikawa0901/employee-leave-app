import { describe, it, expect, afterEach } from "vitest";

import { approveLeaveRequestBatch, createLeaveRequestBatch } from "@/lib/leave/mutations";
import {
  getAnnualObligation,
  getExportConsumptionDetails,
  getExportGrantDetails,
  getExportSummary,
  getLeaveLedger,
} from "@/lib/leave/queries";
import { computeExpireDate } from "@/lib/leave/schedule";
import { prisma } from "@/lib/prisma";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdUserIds: string[] = [];

async function createTestUser(
  hireDate: Date,
  options?: { name?: string; status?: "active" | "terminated" },
): Promise<{ id: string; name: string; email: string }> {
  const email = `${crypto.randomUUID()}@annual-obligation-test.local`;
  const name = options?.name ?? `年5日義務テスト ${email}`;
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: "not-used-in-test",
      role: "employee",
      hireDate,
      status: options?.status ?? "active",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name, email };
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
  it("過年度の未達期間が既に期限超過(overdue)で当年度がmetの場合、overdueが最優先でcurrentに選ばれる(法令違反は隠さない)", async () => {
    const user = await createTestUser(utc(2022, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2023, 7, 1), 10); // 2023-07-01〜2024-06-30、未達のまま期限超過(overdue)
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 11); // 2024-07-01〜2025-06-30、5日取得してmetにする

    for (const day of [1, 2, 3, 4, 5]) {
      await createApprovedRequest(user.id, utc(2024, 8, day));
    }

    const result = await getAnnualObligation(user.id, utc(2025, 1, 1));

    expect(result.current).not.toBeNull();
    expect(result.current?.period.start).toEqual(utc(2023, 7, 1));
    expect(result.current?.status.status).toBe("overdue");
    expect(result.otherUnmetCount).toBe(0);
  });

  it("未達期間が2件ある場合、より緊急な方(at_risk)がcurrentに選ばれ、残り1件(on_track)がotherUnmetCountに数えられる", async () => {
    const user = await createTestUser(utc(2019, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2021, 1, 1), 10); // 2021-01-01〜2021-12-31、期限まであと46日(at_risk)
    await createAnnualAutoGrant(user.id, utc(2021, 6, 1), 11); // 2021-06-01〜2022-05-31、まだ期限に余裕がある(on_track)

    const result = await getAnnualObligation(user.id, utc(2021, 11, 15));

    expect(result.current).not.toBeNull();
    expect(result.current?.period.start).toEqual(utc(2021, 1, 1));
    expect(result.current?.status.status).toBe("at_risk");
    expect(result.otherUnmetCount).toBe(1);
  });

  it("全期間がoverdue(期限超過)の場合、最も古い(最も長期化している)期間がcurrentに選ばれ、残りはotherUnmetCountに数えられる", async () => {
    const user = await createTestUser(utc(2018, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2020, 1, 1), 10); // 2020-01-01〜2020-12-31、未達のまま期限超過
    await createAnnualAutoGrant(user.id, utc(2021, 1, 1), 11); // 2021-01-01〜2021-12-31、こちらも未達のまま期限超過

    const result = await getAnnualObligation(user.id, utc(2025, 1, 1));

    expect(result.current).not.toBeNull();
    expect(result.current?.period.start).toEqual(utc(2020, 1, 1));
    expect(result.current?.status.status).toBe("overdue");
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
    expect(result.hasExcludedHourlyRequests).toBe(true);
  });

  it("時間単位年休が無ければhasExcludedHourlyRequestsはfalseになる", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10); // 2024-07-01〜2025-06-30
    await createApprovedRequest(user.id, utc(2024, 8, 1));

    const result = await getAnnualObligation(user.id, utc(2024, 12, 1));

    expect(result.hasExcludedHourlyRequests).toBe(false);
  });

  it("期間一括申請(Phase 5)で作成・承認された申請も、単日申請と同じようにtakenへ反映される(batchIdの有無で扱いが変わらない回帰確認)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    // approveLeaveRequestBatch(内部でapproveLeaveRequestを使う)は残高計算の基準日に実際の
    // 現在日時を使うため、付与記録は「現在も失効していない」日付にする必要がある
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10); // 期間: 2025-07-01〜2026-06-30

    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2025, 8, 1), utc(2025, 8, 2), utc(2025, 8, 3)],
    });
    const batchId = created[0].batchId as string;
    const outcome = await approveLeaveRequestBatch({ batchId, reviewerId: reviewer.id });
    expect(outcome.failed).toHaveLength(0);

    const result = await getAnnualObligation(user.id, utc(2025, 12, 1));

    expect(result.current).not.toBeNull();
    expect(result.current?.status.taken).toBe(3);
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

describe("getExportGrantDetails / getExportConsumptionDetails / getExportSummary(給与・勤怠システム連携用エクスポート)", () => {
  it("getExportGrantDetails: grantedDateが期間内(両端含む)の付与のみを返す", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2026, 1, 1), 10); // 期間の開始日ちょうど
    await createAnnualAutoGrant(user.id, utc(2026, 1, 31), 5); // 期間の終了日ちょうど
    await createAnnualAutoGrant(user.id, utc(2026, 2, 1), 3); // 期間外(翌日)

    // getExportGrantDetailsは全社員が対象のため、既存のシードデータと混ざらないよう
    // このテストで作成したユーザーのメールアドレスで絞り込む
    const result = (await getExportGrantDetails(utc(2026, 1, 1), utc(2026, 1, 31))).filter(
      (r) => r.userEmail === user.email,
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.grantedDays).sort((a, b) => a - b)).toEqual([5, 10]);
    expect(result.every((r) => r.userName === user.name)).toBe(true);
  });

  it("getExportConsumptionDetails: targetDateが期間内・承認済み・未取消の消化のみを返し、時間単位年休はhoursを保持する", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const grant = await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);

    // 期間内・承認済み(対象)
    await createApprovedRequestWithConsumption(user.id, utc(2026, 1, 15), utc(2026, 1, 15), grant.id, 1);
    // 期間内・時間単位年休(対象、hours保持)
    await createApprovedHourlyRequestWithConsumption(user.id, utc(2026, 1, 20), utc(2026, 1, 20), grant.id, 4, 0.5);
    // 期間外(対象外)
    await createApprovedRequestWithConsumption(user.id, utc(2026, 2, 1), utc(2026, 2, 1), grant.id, 1);
    // 却下(対象外)
    await createRequest(user.id, utc(2026, 1, 16), "cancelled");

    const result = (await getExportConsumptionDetails(utc(2026, 1, 1), utc(2026, 1, 31))).filter(
      (r) => r.userEmail === user.email,
    );

    expect(result).toHaveLength(2);
    const fullDay = result.find((r) => r.targetDate.getTime() === utc(2026, 1, 15).getTime());
    const hourly = result.find((r) => r.targetDate.getTime() === utc(2026, 1, 20).getTime());
    expect(fullDay?.consumedDays).toBe(1);
    expect(fullDay?.hours).toBeNull();
    expect(hourly?.unit).toBe("hourly");
    expect(hourly?.hours).toBe(4);
    expect(hourly?.consumedDays).toBe(0.5);
  });

  it("getExportConsumptionDetails: 取り下げ済み(cancelledAt設定済み)の消化は対象外になる", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const grant = await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);
    const request = await prisma.leaveRequest.create({
      data: { userId: user.id, targetDate: utc(2026, 1, 15), unit: "full_day", status: "approved", reviewedAt: utc(2026, 1, 15) },
      select: { id: true },
    });
    await prisma.leaveConsumption.create({
      data: { leaveRequestId: request.id, leaveGrantId: grant.id, consumedDays: 1, cancelledAt: utc(2026, 1, 16) },
    });

    const result = (await getExportConsumptionDetails(utc(2026, 1, 1), utc(2026, 1, 31))).filter(
      (r) => r.userEmail === user.email,
    );

    expect(result.find((r) => r.targetDate.getTime() === utc(2026, 1, 15).getTime())).toBeUndefined();
  });

  it("getExportSummary: 期間内付与日数・期間内消化日数を正しく集計する", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const grant = await createAnnualAutoGrant(user.id, utc(2026, 1, 1), 10);
    await createApprovedRequestWithConsumption(user.id, utc(2026, 1, 15), utc(2026, 1, 15), grant.id, 2);
    // 期間外の付与・消化は集計対象外
    await createAnnualAutoGrant(user.id, utc(2026, 2, 1), 3);
    await createApprovedRequestWithConsumption(user.id, utc(2026, 2, 2), utc(2026, 2, 2), grant.id, 1);

    const result = await getExportSummary(utc(2026, 1, 1), utc(2026, 1, 31));
    const row = result.find((r) => r.userId === user.id);

    expect(row?.grantedDaysInPeriod).toBe(10);
    expect(row?.consumedDaysInPeriod).toBe(2);
  });

  it("getExportSummary: 期末残日数はreviewedAt基準で計算され、to時点でまだ承認されていない消化は差し引かれない(getLeaveLedgerのgetRemainingDaysAsOfと同じ考え方)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const grant = await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);

    // targetDateは期間外(過去)だがreviewedAtがto以前 → 期末残に反映される
    await createApprovedRequestWithConsumption(user.id, utc(2025, 12, 1), utc(2026, 1, 10), grant.id, 1);
    // reviewedAtがtoより後 → 期末残には反映されない
    await createApprovedRequestWithConsumption(user.id, utc(2026, 1, 20), utc(2026, 2, 1), grant.id, 3);

    const result = await getExportSummary(utc(2026, 1, 1), utc(2026, 1, 31));
    const row = result.find((r) => r.userId === user.id);

    expect(row?.remainingDaysAtTo).toBe(9); // 10 - 1(reviewedAtがto以前の分のみ)
  });

  it("getExportSummary: 在職中・退職済みの両方が対象になり、在職状況が正しく返る", async () => {
    const activeUser = await createTestUser(utc(2024, 1, 1), { status: "active" });
    const terminatedUser = await createTestUser(utc(2020, 1, 1), { status: "terminated" });

    const result = await getExportSummary(utc(2026, 1, 1), utc(2026, 1, 31));

    expect(result.find((r) => r.userId === activeUser.id)?.status).toBe("active");
    expect(result.find((r) => r.userId === terminatedUser.id)?.status).toBe("terminated");
  });
});

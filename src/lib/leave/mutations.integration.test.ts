import { describe, it, expect, afterEach } from "vitest";

import { InsufficientBalanceError } from "@/lib/leave/balance";
import { decimalToNumber } from "@/lib/decimal";
import {
  BatchRequestConflictError,
  DuplicateDatesInBatchError,
  DuplicateRequestError,
  EmptyBatchDatesError,
  ExceedsBatchSizeLimitError,
  ExceedsDailyLimitError,
  ExceedsHourlyAnnualCapError,
  HourlyLeaveOutsideObligationPeriodError,
  InvalidHourlyRequestError,
  NotRequestOwnerError,
  RequestTargetNotActiveError,
  TargetOnHolidayError,
} from "@/lib/leave/errors";
import { createHoliday } from "@/lib/holidays/mutations";
import {
  approveLeaveRequest,
  approveLeaveRequestBatch,
  cancelLeaveRequest,
  cancelLeaveRequestBatch,
  createLeaveRequest,
  createLeaveRequestBatch,
  rejectLeaveRequest,
  rejectLeaveRequestBatch,
  withdrawApprovedLeaveRequest,
} from "@/lib/leave/mutations";
import { computeExpireDate } from "@/lib/leave/schedule";
import { prisma } from "@/lib/prisma";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdUserIds: string[] = [];
const createdHolidayIds: string[] = [];

async function createTestHoliday(date: Date): Promise<{ id: string }> {
  const holiday = await createHoliday({ date, name: "テスト休日", type: "national_holiday" });
  createdHolidayIds.push(holiday.id);
  return { id: holiday.id };
}

async function createTestUser(
  hireDate: Date,
  status: "active" | "terminated" = "active",
): Promise<{ id: string }> {
  const email = `${crypto.randomUUID()}@hourly-leave-test.local`;
  const user = await prisma.user.create({
    data: {
      name: `時間単位年休テスト ${email}`,
      email,
      passwordHash: "not-used-in-test",
      role: "employee",
      hireDate,
      status,
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

afterEach(async () => {
  if (createdHolidayIds.length > 0) {
    await prisma.holiday.deleteMany({ where: { id: { in: createdHolidayIds } } });
    createdHolidayIds.length = 0;
  }
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

describe("createLeaveRequest (時間単位年休)", () => {
  it("時間単位申請を作成でき、hoursが保存される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);

    const request = await createLeaveRequest({
      userId: user.id,
      targetDate: utc(2024, 8, 1),
      unit: "hourly",
      hours: 4,
    });

    expect(request.hours).toBe(4);
    expect(request.unit).toBe("hourly");
  });

  it("unit!==hourlyのときhoursは常にnullで保存される(渡した値は無視される)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);

    const request = await createLeaveRequest({
      userId: user.id,
      targetDate: utc(2024, 8, 1),
      unit: "full_day",
      hours: 5,
    });

    expect(request.hours).toBeNull();
  });

  it("範囲外(0時間・9時間・非整数)のhoursはInvalidHourlyRequestErrorで拒否される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);

    await expect(
      createLeaveRequest({ userId: user.id, targetDate: utc(2024, 8, 1), unit: "hourly", hours: 0 }),
    ).rejects.toThrow(InvalidHourlyRequestError);
    await expect(
      createLeaveRequest({ userId: user.id, targetDate: utc(2024, 8, 2), unit: "hourly", hours: 9 }),
    ).rejects.toThrow(InvalidHourlyRequestError);
    await expect(
      createLeaveRequest({ userId: user.id, targetDate: utc(2024, 8, 3), unit: "hourly", hours: 2.5 }),
    ).rejects.toThrow(InvalidHourlyRequestError);
  });

  it("同日2件目の時間単位申請はDuplicateRequestErrorで拒否される(1日1件までの強制)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);
    const targetDate = utc(2024, 8, 1);

    await createLeaveRequest({ userId: user.id, targetDate, unit: "hourly", hours: 2 });

    await expect(
      createLeaveRequest({ userId: user.id, targetDate, unit: "hourly", hours: 3 }),
    ).rejects.toThrow(DuplicateRequestError);
  });

  it("時間単位5時間(0.625日)+午後半休(0.5日)は1.125日でExceedsDailyLimitErrorになる", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10);
    const targetDate = utc(2024, 8, 1);

    await createLeaveRequest({ userId: user.id, targetDate, unit: "hourly", hours: 5 });

    await expect(
      createLeaveRequest({ userId: user.id, targetDate, unit: "pm_half" }),
    ).rejects.toThrow(ExceedsDailyLimitError);
  });

  it("対象日がどの義務期間にも属さない場合、HourlyLeaveOutsideObligationPeriodErrorで拒否される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    // annual_autoの付与記録を一切作らない(義務期間が存在しない)

    await expect(
      createLeaveRequest({ userId: user.id, targetDate: utc(2024, 8, 1), unit: "hourly", hours: 2 }),
    ).rejects.toThrow(HourlyLeaveOutsideObligationPeriodError);
  });

  it("義務期間内で40時間ちょうどは許可され、それを超える申請はExceedsHourlyAnnualCapErrorになる", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10); // 期間: 2024-07-01〜2025-06-30

    for (let day = 1; day <= 5; day += 1) {
      const request = await createLeaveRequest({
        userId: user.id,
        targetDate: utc(2024, 8, day),
        unit: "hourly",
        hours: 8,
      });
      expect(request.hours).toBe(8);
    }

    await expect(
      createLeaveRequest({ userId: user.id, targetDate: utc(2024, 8, 10), unit: "hourly", hours: 1 }),
    ).rejects.toThrow(ExceedsHourlyAnnualCapError);
  });

  it("義務期間が1日重複する場合、重複日への申請はどちらの期間の上限に対してもチェックされる", async () => {
    // annual-obligation.test.tsと同じ重複パターン(月末入社起因)
    const user = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2027, 3, 3), 11); // 期間: 2027-03-03〜2028-03-02
    await createAnnualAutoGrant(user.id, utc(2028, 3, 2), 12); // 期間: 2028-03-02〜2029-03-01(前の期間と1日重複)

    // 前の期間(2027-03-03〜2028-03-02)を40時間ちょうどまで埋める(重複日以外で)
    for (let day = 1; day <= 5; day += 1) {
      await createLeaveRequest({
        userId: user.id,
        targetDate: utc(2027, 4, day),
        unit: "hourly",
        hours: 8,
      });
    }

    // 重複日(2028-03-02)は後の期間からは1時間も使っていないが、前の期間としては
    // 既に40時間に達しているため、重複日への追加申請は拒否されるべき
    await expect(
      createLeaveRequest({ userId: user.id, targetDate: utc(2028, 3, 2), unit: "hourly", hours: 1 }),
    ).rejects.toThrow(ExceedsHourlyAnnualCapError);
  });
});

describe("createLeaveRequest (時間単位年休) の同時実行", () => {
  it("同一義務期間・別targetDateへの同時申請で合計が上限を超える場合、片方だけ成功する", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2024, 7, 1), 10); // 期間: 2024-07-01〜2025-06-30

    // 既存で32時間使用済みにしておく(残り枠は8時間分のみ)
    for (let day = 1; day <= 4; day += 1) {
      await createLeaveRequest({
        userId: user.id,
        targetDate: utc(2024, 8, day),
        unit: "hourly",
        hours: 8,
      });
    }

    // 残り8時間の枠に対して、別々の日に8時間ずつを同時に申請する(合計16時間で枠を超える)
    const results = await Promise.allSettled([
      createLeaveRequest({ userId: user.id, targetDate: utc(2024, 9, 1), unit: "hourly", hours: 8 }),
      createLeaveRequest({ userId: user.id, targetDate: utc(2024, 9, 2), unit: "hourly", hours: 8 }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });
});

describe("approveLeaveRequest (時間単位年休)", () => {
  // approveLeaveRequestは残高計算の基準日に実際の現在日時(startOfTodayUTC())を使うため、
  // このdescribe内の付与記録は「現在も失効していない」日付を使う必要がある
  it("時間単位申請を正しい日換算でFEFO消費する(4時間→0.5日)", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10);

    const request = await createLeaveRequest({
      userId: user.id,
      targetDate: utc(2025, 8, 1),
      unit: "hourly",
      hours: 4,
    });
    await approveLeaveRequest({ requestId: request.id, reviewerId: reviewer.id });

    const consumption = await prisma.leaveConsumption.findFirst({ where: { leaveRequestId: request.id } });
    expect(consumption).not.toBeNull();
    expect(decimalToNumber(consumption!.consumedDays)).toBe(0.5);
  });

  it(
    "作成時のチェックを経ずに(直接DB操作で)登録された時間単位申請が、承認時点の上限再チェックで" +
      "ExceedsHourlyAnnualCapErrorとして拒否される",
    async () => {
      const user = await createTestUser(utc(2025, 1, 1));
      const reviewer = await createTestUser(utc(2020, 1, 1));
      await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10); // 期間: 2025-07-01〜2026-06-30

      // 正規のフローで40時間ちょうどを承認済みにする
      for (let day = 1; day <= 5; day += 1) {
        const request = await createLeaveRequest({
          userId: user.id,
          targetDate: utc(2025, 8, day),
          unit: "hourly",
          hours: 8,
        });
        await approveLeaveRequest({ requestId: request.id, reviewerId: reviewer.id });
      }

      // createLeaveRequestの上限チェックを経由せず、直接DB操作でpending申請を追加する
      // (seed.tsのように別経路で作成されたレコードを模したケース)
      const bypassedRequest = await prisma.leaveRequest.create({
        data: { userId: user.id, targetDate: utc(2025, 9, 1), unit: "hourly", hours: 8, status: "pending" },
      });

      await expect(
        approveLeaveRequest({ requestId: bypassedRequest.id, reviewerId: reviewer.id }),
      ).rejects.toThrow(ExceedsHourlyAnnualCapError);

      const stillPending = await prisma.leaveRequest.findUnique({ where: { id: bypassedRequest.id } });
      expect(stillPending?.status).toBe("pending");
    },
  );

  // hoursカラムはDB上Int型のため非整数値は保存できない(Postgres側で整数に丸められる)。
  // 実際に発生しうる不正状態は null または範囲外の整数のみ
  it.each([
    ["hours=null", null],
    ["hours=9(範囲外)", 9],
  ])(
    "createLeaveRequestの検証を経ずに直接DB操作で作られた不正なhours(%s)の申請は、" +
      "承認時にInvalidHourlyRequestErrorで拒否され、pendingのまま残る",
    async (_label, invalidHours) => {
      const user = await createTestUser(utc(2025, 1, 1));
      const reviewer = await createTestUser(utc(2020, 1, 1));
      await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10);

      const bypassedRequest = await prisma.leaveRequest.create({
        data: {
          userId: user.id,
          targetDate: utc(2025, 8, 1),
          unit: "hourly",
          hours: invalidHours,
          status: "pending",
        },
      });

      await expect(
        approveLeaveRequest({ requestId: bypassedRequest.id, reviewerId: reviewer.id }),
      ).rejects.toThrow(InvalidHourlyRequestError);

      const stillPending = await prisma.leaveRequest.findUnique({ where: { id: bypassedRequest.id } });
      expect(stillPending?.status).toBe("pending");
      const consumption = await prisma.leaveConsumption.findFirst({
        where: { leaveRequestId: bypassedRequest.id },
      });
      expect(consumption).toBeNull();
    },
  );
});

describe("createLeaveRequestBatch (期間一括申請)", () => {
  it("複数日が1つのbatchIdでまとめて作成される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));

    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2026, 8, 3), utc(2026, 8, 4), utc(2026, 8, 5)],
    });

    expect(created).toHaveLength(3);
    const batchIds = new Set(created.map((r) => r.batchId));
    expect(batchIds.size).toBe(1);
    expect(created.every((r) => r.unit === "full_day")).toBe(true);
    expect(created.map((r) => r.targetDate.getTime()).sort()).toEqual(
      [utc(2026, 8, 3), utc(2026, 8, 4), utc(2026, 8, 5)].map((d) => d.getTime()).sort(),
    );
  });

  it("対象日が空ならEmptyBatchDatesErrorになる", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await expect(createLeaveRequestBatch({ userId: user.id, dates: [] })).rejects.toThrow(
      EmptyBatchDatesError,
    );
  });

  it("32日分を指定するとExceedsBatchSizeLimitErrorになる", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const dates = Array.from({ length: 32 }, (_, i) => utc(2026, 8, 1 + i));
    await expect(createLeaveRequestBatch({ userId: user.id, dates })).rejects.toThrow(
      ExceedsBatchSizeLimitError,
    );
  });

  it("入力内に同一対象日が重複しているとDuplicateDatesInBatchErrorになる", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await expect(
      createLeaveRequestBatch({
        userId: user.id,
        dates: [utc(2026, 8, 3), utc(2026, 8, 3)],
      }),
    ).rejects.toThrow(DuplicateDatesInBatchError);
  });

  it("範囲内に既存の単日申請がある場合、1件も作成されずBatchRequestConflictErrorになる(all-or-nothing)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    // 対象範囲の途中の日にすでに全休の申請が存在する状態を作る
    await createLeaveRequest({ userId: user.id, targetDate: utc(2026, 8, 4), unit: "full_day" });

    await expect(
      createLeaveRequestBatch({
        userId: user.id,
        dates: [utc(2026, 8, 3), utc(2026, 8, 4), utc(2026, 8, 5)],
      }),
    ).rejects.toThrow(BatchRequestConflictError);

    // 一括申請分は1件も作成されておらず、事前に存在した1件だけが残っていること
    const requests = await prisma.leaveRequest.findMany({ where: { userId: user.id } });
    expect(requests).toHaveLength(1);
    expect(requests[0].targetDate).toEqual(utc(2026, 8, 4));
    expect(requests[0].batchId).toBeNull();
  });

  it("退職済みユーザーへの一括申請はRequestTargetNotActiveErrorで拒否される", async () => {
    const user = await createTestUser(utc(2024, 1, 1), "terminated");
    await expect(
      createLeaveRequestBatch({ userId: user.id, dates: [utc(2026, 8, 3)] }),
    ).rejects.toThrow(RequestTargetNotActiveError);
  });
});

describe("approveLeaveRequestの一般ロック(既存の並行性バグ修正、Phase 5)", () => {
  it("残高がちょうど1日分しかない状態で2件を同時承認すると、片方だけ成功し他方はInsufficientBalanceErrorになる", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    // 現在も有効な付与(実行日である今日をまたぐ有効期間)で残高をちょうど1日にする
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 1);

    const requestA = await createLeaveRequest({
      userId: user.id,
      targetDate: utc(2026, 8, 3),
      unit: "full_day",
    });
    const requestB = await createLeaveRequest({
      userId: user.id,
      targetDate: utc(2026, 8, 4),
      unit: "full_day",
    });

    const results = await Promise.allSettled([
      approveLeaveRequest({ requestId: requestA.id, reviewerId: reviewer.id }),
      approveLeaveRequest({ requestId: requestB.id, reviewerId: reviewer.id }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientBalanceError);

    // 消化内訳が二重に記録されていない(残高がマイナスになっていない)ことも確認する
    const consumptions = await prisma.leaveConsumption.findMany({
      where: { leaveGrant: { userId: user.id } },
    });
    const totalConsumed = consumptions.reduce((sum, c) => sum + decimalToNumber(c.consumedDays), 0);
    expect(totalConsumed).toBe(1);
  });
});

describe("approveLeaveRequestBatch / rejectLeaveRequestBatch / cancelLeaveRequestBatch", () => {
  it("approveLeaveRequestBatch: 全件成功する", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10);

    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2026, 8, 3), utc(2026, 8, 4), utc(2026, 8, 5)],
    });
    const batchId = created[0].batchId as string;

    const outcome = await approveLeaveRequestBatch({ batchId, reviewerId: reviewer.id });

    expect(outcome.succeeded).toHaveLength(3);
    expect(outcome.failed).toHaveLength(0);
    const approved = await prisma.leaveRequest.findMany({ where: { batchId, status: "approved" } });
    expect(approved).toHaveLength(3);
  });

  it("approveLeaveRequestBatch: 残高不足で一部だけ失敗する部分成功(承認済みはそのまま残る)", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    // 残高2日分に対して3日分を一括申請し、3件目で残高不足になるようにする
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 2);

    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2026, 8, 3), utc(2026, 8, 4), utc(2026, 8, 5)],
    });
    const batchId = created[0].batchId as string;

    const outcome = await approveLeaveRequestBatch({ batchId, reviewerId: reviewer.id });

    expect(outcome.succeeded).toHaveLength(2);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].reason).toBe(new InsufficientBalanceError().message);

    const approved = await prisma.leaveRequest.findMany({ where: { batchId, status: "approved" } });
    const stillPending = await prisma.leaveRequest.findMany({ where: { batchId, status: "pending" } });
    expect(approved).toHaveLength(2);
    expect(stillPending).toHaveLength(1);
  });

  it("rejectLeaveRequestBatch: 該当batchIdのpending全件が却下される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));

    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2026, 8, 3), utc(2026, 8, 4)],
    });
    const batchId = created[0].batchId as string;

    const outcome = await rejectLeaveRequestBatch({ batchId, reviewerId: reviewer.id, reason: "都合により" });

    expect(outcome.succeeded).toHaveLength(2);
    expect(outcome.failed).toHaveLength(0);
    const rejected = await prisma.leaveRequest.findMany({ where: { batchId, status: "rejected" } });
    expect(rejected).toHaveLength(2);
  });

  it("cancelLeaveRequestBatch: 本人のpending全件が取消される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));

    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2026, 8, 3), utc(2026, 8, 4)],
    });
    const batchId = created[0].batchId as string;

    const outcome = await cancelLeaveRequestBatch({ batchId, actingUserId: user.id });

    expect(outcome.succeeded).toHaveLength(2);
    expect(outcome.failed).toHaveLength(0);
    const cancelled = await prisma.leaveRequest.findMany({ where: { batchId, status: "cancelled" } });
    expect(cancelled).toHaveLength(2);
  });

  it("cancelLeaveRequestBatch: 本人以外が呼ぶと全件failedになる(NotRequestOwnerError)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const otherUser = await createTestUser(utc(2020, 1, 1));

    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2026, 8, 3), utc(2026, 8, 4)],
    });
    const batchId = created[0].batchId as string;

    const outcome = await cancelLeaveRequestBatch({ batchId, actingUserId: otherUser.id });

    expect(outcome.succeeded).toHaveLength(0);
    expect(outcome.failed).toHaveLength(2);
    expect(outcome.failed[0].reason).toBe(new NotRequestOwnerError().message);
    const stillPending = await prisma.leaveRequest.findMany({ where: { batchId, status: "pending" } });
    expect(stillPending).toHaveLength(2);
  });

  it("cancelLeaveRequestBatch: 一部がすでに承認済みの場合、残りのpendingだけが取消される部分成功", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10);

    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2026, 8, 3), utc(2026, 8, 4)],
    });
    const batchId = created[0].batchId as string;
    await approveLeaveRequest({ requestId: created[0].id, reviewerId: reviewer.id });

    const outcome = await cancelLeaveRequestBatch({ batchId, actingUserId: user.id });

    // approveLeaveRequestBatchと異なりcancelLeaveRequestBatchはpendingのみを対象に取得するため、
    // すでにapproved状態の申請はそもそも処理対象に含まれない(succeeded/failedいずれにも現れない)
    expect(outcome.succeeded).toHaveLength(1);
    expect(outcome.failed).toHaveLength(0);
    const approvedStillApproved = await prisma.leaveRequest.findUnique({ where: { id: created[0].id } });
    expect(approvedStillApproved?.status).toBe("approved");
  });
});

describe("休日マスタによる有給申請のブロック", () => {
  it("createLeaveRequest: 休日マスタに登録された日への単日申請はTargetOnHolidayErrorで拒否される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createTestHoliday(utc(2999, 8, 11));

    await expect(
      createLeaveRequest({ userId: user.id, targetDate: utc(2999, 8, 11), unit: "full_day" }),
    ).rejects.toThrow(TargetOnHolidayError);

    const requests = await prisma.leaveRequest.findMany({ where: { userId: user.id } });
    expect(requests).toHaveLength(0);
  });

  it("createLeaveRequest: 休日でない日への申請は影響を受けない", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createTestHoliday(utc(2999, 8, 11));

    const request = await createLeaveRequest({
      userId: user.id,
      targetDate: utc(2999, 8, 12),
      unit: "full_day",
    });
    expect(request.targetDate).toEqual(utc(2999, 8, 12));
  });

  it("createLeaveRequestBatch: 対象範囲内に休日が1件でもあれば、1件も作成されずBatchRequestConflictErrorになる(all-or-nothing)", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    await createTestHoliday(utc(2999, 8, 11));

    await expect(
      createLeaveRequestBatch({
        userId: user.id,
        dates: [utc(2999, 8, 10), utc(2999, 8, 11), utc(2999, 8, 12)],
      }),
    ).rejects.toThrow(BatchRequestConflictError);

    const requests = await prisma.leaveRequest.findMany({ where: { userId: user.id } });
    expect(requests).toHaveLength(0);
  });

  it("approveLeaveRequest: 作成後に休日として登録された日の申請は、承認時にTargetOnHolidayErrorで拒否されpendingのまま残る", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10);

    const request = await createLeaveRequest({
      userId: user.id,
      targetDate: utc(2999, 8, 11),
      unit: "full_day",
    });
    // 申請作成後に、対象日を休日として登録する(休日マスタ導入前の申請や、後から休日追加されたケースを再現)
    await createTestHoliday(utc(2999, 8, 11));

    await expect(
      approveLeaveRequest({ requestId: request.id, reviewerId: reviewer.id }),
    ).rejects.toThrow(TargetOnHolidayError);

    const stillPending = await prisma.leaveRequest.findUnique({ where: { id: request.id } });
    expect(stillPending?.status).toBe("pending");
    const consumption = await prisma.leaveConsumption.findFirst({ where: { leaveRequestId: request.id } });
    expect(consumption).toBeNull();
  });

  it("approveLeaveRequestBatch: 休日該当分はfailedに分類され、それ以外は承認される部分成功", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10);

    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2999, 8, 10), utc(2999, 8, 12)],
    });
    const batchId = created[0].batchId as string;
    // 作成後に片方の対象日を休日として登録する
    await createTestHoliday(utc(2999, 8, 10));

    const outcome = await approveLeaveRequestBatch({ batchId, reviewerId: reviewer.id });

    expect(outcome.succeeded).toHaveLength(1);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].reason).toBe(new TargetOnHolidayError().message);

    const approved = await prisma.leaveRequest.findMany({ where: { batchId, status: "approved" } });
    const stillPending = await prisma.leaveRequest.findMany({ where: { batchId, status: "pending" } });
    expect(approved).toHaveLength(1);
    expect(stillPending).toHaveLength(1);
  });
});

describe("監査ログの記録", () => {
  it("approveLeaveRequest: 承認すると監査ログ(leave_request_approved)が記録される", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10);
    const request = await createLeaveRequest({ userId: user.id, targetDate: utc(2999, 8, 1), unit: "full_day" });

    await approveLeaveRequest({ requestId: request.id, reviewerId: reviewer.id });

    const log = await prisma.auditLog.findFirst({ where: { targetId: request.id } });
    expect(log).not.toBeNull();
    expect(log?.action).toBe("leave_request_approved");
    expect(log?.actorId).toBe(reviewer.id);
    expect(log?.targetUserId).toBe(user.id);
    expect(log?.detail).toMatchObject({ unit: "full_day" });
  });

  it("rejectLeaveRequest: 却下すると監査ログ(leave_request_rejected)が理由付きで記録される", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    const request = await createLeaveRequest({ userId: user.id, targetDate: utc(2999, 8, 1), unit: "full_day" });

    await rejectLeaveRequest({ requestId: request.id, reviewerId: reviewer.id, reason: "業務都合" });

    const log = await prisma.auditLog.findFirst({ where: { targetId: request.id } });
    expect(log?.action).toBe("leave_request_rejected");
    expect(log?.actorId).toBe(reviewer.id);
    expect(log?.detail).toMatchObject({ reason: "業務都合" });
  });

  it("cancelLeaveRequest: 本人取消で監査ログ(leave_request_cancelled)が記録される", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const request = await createLeaveRequest({ userId: user.id, targetDate: utc(2999, 8, 1), unit: "full_day" });

    await cancelLeaveRequest({ requestId: request.id, actingUserId: user.id, reason: "予定変更" });

    const log = await prisma.auditLog.findFirst({ where: { targetId: request.id } });
    expect(log?.action).toBe("leave_request_cancelled");
    expect(log?.actorId).toBe(user.id);
    expect(log?.targetUserId).toBe(user.id);
    expect(log?.detail).toMatchObject({ reason: "予定変更" });
  });

  it("withdrawApprovedLeaveRequest: 承認済み申請の取り下げで監査ログ(leave_request_withdrawn)が記録される", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10);
    const request = await createLeaveRequest({ userId: user.id, targetDate: utc(2999, 8, 1), unit: "full_day" });
    await approveLeaveRequest({ requestId: request.id, reviewerId: reviewer.id });

    await withdrawApprovedLeaveRequest({ requestId: request.id, actingUserId: user.id, reason: "取得日変更" });

    const logs = await prisma.auditLog.findMany({ where: { targetId: request.id }, orderBy: { createdAt: "asc" } });
    expect(logs).toHaveLength(2); // 承認1件 + 取り下げ1件
    expect(logs[1].action).toBe("leave_request_withdrawn");
    expect(logs[1].detail).toMatchObject({ reason: "取得日変更" });
  });

  it("approveLeaveRequestBatch: 一括承認では対象件数分の監査ログが個別に記録される", async () => {
    const user = await createTestUser(utc(2025, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createAnnualAutoGrant(user.id, utc(2025, 7, 1), 10);
    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2999, 9, 1), utc(2999, 9, 2)],
    });
    const batchId = created[0].batchId as string;

    await approveLeaveRequestBatch({ batchId, reviewerId: reviewer.id });

    const logs = await prisma.auditLog.findMany({
      where: { targetId: { in: created.map((r) => r.id) } },
    });
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.action === "leave_request_approved")).toBe(true);
  });

  it("rejectLeaveRequestBatch: 一括却下では対象件数分の監査ログが個別に記録される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2999, 9, 1), utc(2999, 9, 2)],
    });
    const batchId = created[0].batchId as string;

    await rejectLeaveRequestBatch({ batchId, reviewerId: reviewer.id, reason: "都合により" });

    const logs = await prisma.auditLog.findMany({
      where: { targetId: { in: created.map((r) => r.id) } },
    });
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.action === "leave_request_rejected")).toBe(true);
    expect(logs.every((log) => log.detail !== null && (log.detail as { reason?: string }).reason === "都合により")).toBe(
      true,
    );
  });

  it("cancelLeaveRequestBatch: 一括取消では対象件数分の監査ログが個別に記録される", async () => {
    const user = await createTestUser(utc(2024, 1, 1));
    const created = await createLeaveRequestBatch({
      userId: user.id,
      dates: [utc(2999, 9, 1), utc(2999, 9, 2)],
    });
    const batchId = created[0].batchId as string;

    await cancelLeaveRequestBatch({ batchId, actingUserId: user.id });

    const logs = await prisma.auditLog.findMany({
      where: { targetId: { in: created.map((r) => r.id) } },
    });
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.action === "leave_request_cancelled")).toBe(true);
  });
});

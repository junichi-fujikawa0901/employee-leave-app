import { describe, it, expect, afterEach } from "vitest";

import { decimalToNumber } from "@/lib/decimal";
import {
  DuplicateRequestError,
  ExceedsDailyLimitError,
  ExceedsHourlyAnnualCapError,
  HourlyLeaveOutsideObligationPeriodError,
  InvalidHourlyRequestError,
} from "@/lib/leave/errors";
import { approveLeaveRequest, createLeaveRequest } from "@/lib/leave/mutations";
import { computeExpireDate } from "@/lib/leave/schedule";
import { prisma } from "@/lib/prisma";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdUserIds: string[] = [];

async function createTestUser(hireDate: Date): Promise<{ id: string }> {
  const email = `${crypto.randomUUID()}@hourly-leave-test.local`;
  const user = await prisma.user.create({
    data: {
      name: `時間単位年休テスト ${email}`,
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

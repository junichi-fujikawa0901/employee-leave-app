import { describe, it, expect, afterEach } from "vitest";

import { getAnnualObligation } from "@/lib/leave/queries";
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

async function createAnnualAutoGrant(userId: string, grantedDate: Date, grantedDays: number): Promise<void> {
  await prisma.leaveGrant.create({
    data: {
      userId,
      grantType: "annual_auto",
      grantedDate,
      grantedDays,
      expireDate: computeExpireDate(grantedDate),
    },
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
});

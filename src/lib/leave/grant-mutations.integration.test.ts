import { describe, it, expect, afterEach } from "vitest";

import { UserStatus } from "@/generated/prisma/client";
import { GrantTargetNotActiveError } from "@/lib/leave/errors";
import { runAutoGrantsForAllActiveUsers, runAutoGrantsForUser } from "@/lib/leave/grant-mutations";
import { prisma } from "@/lib/prisma";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdUserIds: string[] = [];

async function createTestUser(input: {
  hireDate: Date;
  status?: UserStatus;
  terminationDate?: Date;
}): Promise<{ id: string; name: string }> {
  const email = `${crypto.randomUUID()}@auto-grant-test.local`;
  const user = await prisma.user.create({
    data: {
      name: `自動付与テスト ${email}`,
      email,
      passwordHash: "not-used-in-test",
      role: "employee",
      hireDate: input.hireDate,
      status: input.status ?? UserStatus.active,
      terminationDate: input.terminationDate,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name };
}

afterEach(async () => {
  if (createdUserIds.length === 0) {
    return;
  }
  await prisma.leaveGrant.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("runAutoGrantsForUser", () => {
  it("在職中ユーザーの初回実行で期待どおりの付与が生成される", async () => {
    const user = await createTestUser({ hireDate: utc(2024, 1, 1) });

    const result = await runAutoGrantsForUser(user.id, utc(2024, 7, 1));

    expect(result.insertedCount).toBe(1);
    expect(result.insertedGrants).toEqual([
      { grantedDate: utc(2024, 7, 1), grantedDays: 10, expireDate: utc(2026, 6, 30) },
    ]);

    const grants = await prisma.leaveGrant.findMany({ where: { userId: user.id } });
    expect(grants).toHaveLength(1);
  });

  it("同一asOfで2回実行してもレコードが増えない(べき等性)", async () => {
    const user = await createTestUser({ hireDate: utc(2024, 1, 1) });

    const first = await runAutoGrantsForUser(user.id, utc(2024, 7, 1));
    const second = await runAutoGrantsForUser(user.id, utc(2024, 7, 1));

    expect(first.insertedCount).toBe(1);
    expect(second.insertedCount).toBe(0);
    expect(second.skippedCount).toBe(1);

    const grants = await prisma.leaveGrant.findMany({ where: { userId: user.id } });
    expect(grants).toHaveLength(1);
  });

  it("退職済みユーザーに対してはGrantTargetNotActiveErrorを投げ、レコードを作らない", async () => {
    const user = await createTestUser({
      hireDate: utc(2024, 1, 1),
      status: UserStatus.terminated,
      terminationDate: utc(2024, 8, 1),
    });

    await expect(runAutoGrantsForUser(user.id, utc(2024, 7, 1))).rejects.toThrow(
      GrantTargetNotActiveError,
    );

    const grants = await prisma.leaveGrant.findMany({ where: { userId: user.id } });
    expect(grants).toHaveLength(0);
  });
});

describe("runAutoGrantsForAllActiveUsers", () => {
  it("在職中ユーザーのみ対象になり、退職済みユーザーは結果に含まれない", async () => {
    const active = await createTestUser({ hireDate: utc(2024, 1, 1) });
    const terminated = await createTestUser({
      hireDate: utc(2024, 1, 1),
      status: UserStatus.terminated,
      terminationDate: utc(2024, 8, 1),
    });

    // runAutoGrantsForAllActiveUsersは開発DB上の全active user(seedデータ含む)を
    // 対象にするため、テスト実行前後の差分を記録し、意図せず作成された既存ユーザー分の
    // 付与も含めて後始末する(開発DBを汚染しないため)
    const beforeIds = new Set(
      (await prisma.leaveGrant.findMany({ select: { id: true } })).map((g) => g.id),
    );

    const result = await runAutoGrantsForAllActiveUsers(utc(2024, 7, 1));

    const activeUserIds = result.perUser.map((p) => p.userId);
    expect(activeUserIds).toContain(active.id);
    expect(activeUserIds).not.toContain(terminated.id);

    const terminatedGrants = await prisma.leaveGrant.findMany({ where: { userId: terminated.id } });
    expect(terminatedGrants).toHaveLength(0);

    const afterGrants = await prisma.leaveGrant.findMany({ select: { id: true } });
    const newlyCreatedIds = afterGrants.filter((g) => !beforeIds.has(g.id)).map((g) => g.id);
    if (newlyCreatedIds.length > 0) {
      await prisma.leaveGrant.deleteMany({ where: { id: { in: newlyCreatedIds } } });
    }
  });
});

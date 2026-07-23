import { describe, it, expect, afterEach } from "vitest";

import { getAuditLogs } from "@/lib/audit/queries";
import { prisma } from "@/lib/prisma";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdUserIds: string[] = [];
const createdAuditLogIds: string[] = [];

async function createTestUser(name: string): Promise<{ id: string; name: string }> {
  const email = `${crypto.randomUUID()}@audit-queries-test.local`;
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: "not-used-in-test",
      role: "admin",
      hireDate: utc(2020, 1, 1),
      status: "active",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name };
}

async function createTestAuditLog(input: {
  actorId: string;
  targetUserId: string;
  createdAt: Date;
}): Promise<{ id: string }> {
  const log = await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: "employee_updated",
      targetUserId: input.targetUserId,
      createdAt: input.createdAt,
    },
  });
  createdAuditLogIds.push(log.id);
  return { id: log.id };
}

afterEach(async () => {
  if (createdAuditLogIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { id: { in: createdAuditLogIds } } });
    createdAuditLogIds.length = 0;
  }
  if (createdUserIds.length === 0) {
    return;
  }
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: createdUserIds } }, { targetUserId: { in: createdUserIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("getAuditLogs", () => {
  it("createdAtが期間内(両端含む)のログのみを新しい順に返す", async () => {
    const actor = await createTestUser("実行者テスト");
    const target = await createTestUser("対象テスト");
    await createTestAuditLog({ actorId: actor.id, targetUserId: target.id, createdAt: utc(2026, 1, 1) });
    await createTestAuditLog({ actorId: actor.id, targetUserId: target.id, createdAt: utc(2026, 1, 15) });
    await createTestAuditLog({ actorId: actor.id, targetUserId: target.id, createdAt: utc(2026, 2, 1) });

    const result = await getAuditLogs({ from: utc(2026, 1, 1), to: utc(2026, 1, 31) });
    const filtered = result.filter((r) => r.targetUserId === target.id);

    expect(filtered).toHaveLength(2);
    expect(filtered[0].createdAt.getTime()).toBeGreaterThan(filtered[1].createdAt.getTime());
  });

  it("createdAtがto当日の時刻付き(0時以降)のログも含まれる(日付境界のオフバイワン回帰テスト)", async () => {
    const actor = await createTestUser("境界テスト実行者");
    const target = await createTestUser("境界テスト対象");
    // toは日付のみ(その日の0時)で渡されるが、createdAtはto当日の15時であっても含まれるべき
    const toDayAfternoon = new Date(Date.UTC(2026, 0, 31, 15, 0, 0));
    await createTestAuditLog({ actorId: actor.id, targetUserId: target.id, createdAt: toDayAfternoon });

    const result = await getAuditLogs({ from: utc(2026, 1, 1), to: utc(2026, 1, 31), targetUserId: target.id });

    expect(result).toHaveLength(1);
  });

  it("targetUserIdで絞り込むと、その社員に関するログのみが返る", async () => {
    const actor = await createTestUser("実行者テスト2");
    const targetA = await createTestUser("対象A");
    const targetB = await createTestUser("対象B");
    await createTestAuditLog({ actorId: actor.id, targetUserId: targetA.id, createdAt: utc(2026, 1, 10) });
    await createTestAuditLog({ actorId: actor.id, targetUserId: targetB.id, createdAt: utc(2026, 1, 10) });

    const result = await getAuditLogs({
      from: utc(2026, 1, 1),
      to: utc(2026, 1, 31),
      targetUserId: targetA.id,
    });

    expect(result.every((r) => r.targetUserId === targetA.id)).toBe(true);
    expect(result.some((r) => r.targetUserId === targetB.id)).toBe(false);
  });

  it("実行者・対象社員の名前がactorName/targetUserNameに反映される", async () => {
    const actor = await createTestUser("名前確認実行者");
    const target = await createTestUser("名前確認対象");
    await createTestAuditLog({ actorId: actor.id, targetUserId: target.id, createdAt: utc(2026, 1, 10) });

    const result = await getAuditLogs({ from: utc(2026, 1, 1), to: utc(2026, 1, 31), targetUserId: target.id });

    expect(result[0].actorName).toBe("名前確認実行者");
    expect(result[0].targetUserName).toBe("名前確認対象");
  });
});

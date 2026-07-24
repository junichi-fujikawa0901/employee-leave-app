import { describe, it, expect, afterEach } from "vitest";

import {
  CannotTerminateSelfError,
  createEmployee,
  EmailAlreadyExistsError,
  terminateEmployee,
  updateEmployee,
} from "@/lib/employees/mutations";
import { prisma } from "@/lib/prisma";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdUserIds: string[] = [];

async function createTestAdmin(): Promise<{ id: string }> {
  const email = `${crypto.randomUUID()}@employees-mutations-test.local`;
  const user = await prisma.user.create({
    data: {
      name: "テスト管理者",
      email,
      passwordHash: "not-used-in-test",
      role: "admin",
      hireDate: utc(2020, 1, 1),
      status: "active",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id };
}

afterEach(async () => {
  if (createdUserIds.length === 0) {
    return;
  }
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: createdUserIds } }, { targetUserId: { in: createdUserIds } }] },
  });
  await prisma.leaveRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.leaveGrant.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.specialLeaveRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("createEmployee", () => {
  it("社員を作成でき、監査ログ(employee_created)が記録される", async () => {
    const admin = await createTestAdmin();
    const email = `${crypto.randomUUID()}@new-employee-test.local`;

    const created = await createEmployee({
      name: "新規太郎",
      email,
      password: "password1234",
      hireDate: utc(2026, 4, 1),
      role: "employee",
      actingAdminId: admin.id,
    });
    createdUserIds.push(created.id);

    const log = await prisma.auditLog.findFirst({
      where: { targetUserId: created.id, action: "employee_created" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(admin.id);
    expect(log?.detail).toMatchObject({ name: "新規太郎", email });
  });

  it("メールアドレス重複時はEmailAlreadyExistsErrorになり、失敗分の監査ログは記録されない", async () => {
    const admin = await createTestAdmin();
    const email = `${crypto.randomUUID()}@dup-test.local`;
    const first = await createEmployee({
      name: "重複太郎1",
      email,
      password: "password1234",
      hireDate: utc(2026, 4, 1),
      role: "employee",
      actingAdminId: admin.id,
    });
    createdUserIds.push(first.id);

    await expect(
      createEmployee({
        name: "重複太郎2",
        email,
        password: "password1234",
        hireDate: utc(2026, 4, 1),
        role: "employee",
        actingAdminId: admin.id,
      }),
    ).rejects.toThrow(EmailAlreadyExistsError);

    const logs = await prisma.auditLog.findMany({ where: { targetUserId: first.id } });
    expect(logs).toHaveLength(1);
  });
});

describe("updateEmployee", () => {
  it("氏名・メールを更新でき、監査ログ(employee_updated)に変更前後が記録される", async () => {
    const admin = await createTestAdmin();
    const email = `${crypto.randomUUID()}@update-test.local`;
    const employee = await createEmployee({
      name: "更新前太郎",
      email,
      password: "password1234",
      hireDate: utc(2026, 4, 1),
      role: "employee",
      actingAdminId: admin.id,
    });
    createdUserIds.push(employee.id);

    const newEmail = `${crypto.randomUUID()}@update-test.local`;
    await updateEmployee({
      userId: employee.id,
      name: "更新後太郎",
      email: newEmail,
      actingAdminId: admin.id,
    });

    const log = await prisma.auditLog.findFirst({
      where: { targetUserId: employee.id, action: "employee_updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(admin.id);
    expect(log?.detail).toMatchObject({
      before: { name: "更新前太郎", email },
      after: { name: "更新後太郎", email: newEmail },
    });
  });
});

describe("terminateEmployee", () => {
  it("退職処理を行うと監査ログ(employee_terminated)が記録される", async () => {
    const admin = await createTestAdmin();
    const email = `${crypto.randomUUID()}@terminate-test.local`;
    const employee = await createEmployee({
      name: "退職太郎",
      email,
      password: "password1234",
      hireDate: utc(2020, 4, 1),
      role: "employee",
      actingAdminId: admin.id,
    });
    createdUserIds.push(employee.id);

    await terminateEmployee({
      userId: employee.id,
      terminationDate: utc(2026, 3, 31),
      actingAdminId: admin.id,
    });

    const log = await prisma.auditLog.findFirst({
      where: { targetUserId: employee.id, action: "employee_terminated" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(admin.id);
    expect(log?.detail).toMatchObject({ terminationDate: utc(2026, 3, 31).toISOString() });
  });

  it("自分自身の退職処理はCannotTerminateSelfErrorになる", async () => {
    const admin = await createTestAdmin();
    await expect(
      terminateEmployee({ userId: admin.id, terminationDate: utc(2026, 3, 31), actingAdminId: admin.id }),
    ).rejects.toThrow(CannotTerminateSelfError);
  });

  it("pendingの特別休暇申請は退職処理で自動却下され、承認済みの分は変更されない", async () => {
    const admin = await createTestAdmin();
    const email = `${crypto.randomUUID()}@terminate-special-leave-test.local`;
    const employee = await createEmployee({
      name: "特休退職太郎",
      email,
      password: "password1234",
      hireDate: utc(2020, 4, 1),
      role: "employee",
      actingAdminId: admin.id,
    });
    createdUserIds.push(employee.id);

    const pending = await prisma.specialLeaveRequest.create({
      data: {
        userId: employee.id,
        type: "ceremonial",
        startDate: utc(2026, 4, 10),
        endDate: utc(2026, 4, 10),
      },
    });
    const approved = await prisma.specialLeaveRequest.create({
      data: {
        userId: employee.id,
        type: "ceremonial",
        startDate: utc(2026, 2, 1),
        endDate: utc(2026, 2, 1),
        status: "approved",
        reviewedById: admin.id,
        reviewedAt: utc(2026, 1, 25),
      },
    });

    await terminateEmployee({
      userId: employee.id,
      terminationDate: utc(2026, 3, 31),
      actingAdminId: admin.id,
    });

    const updatedPending = await prisma.specialLeaveRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(updatedPending.status).toBe("rejected");
    expect(updatedPending.rejectReason).toBe("退職処理による自動却下");
    expect(updatedPending.reviewedById).toBe(admin.id);

    const updatedApproved = await prisma.specialLeaveRequest.findUniqueOrThrow({ where: { id: approved.id } });
    expect(updatedApproved.status).toBe("approved");
  });
});

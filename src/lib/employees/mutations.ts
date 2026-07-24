import bcrypt from "bcryptjs";

import type { Role, User } from "@/generated/prisma/client";
import { AuditAction, LeaveRequestStatus, Prisma, SpecialLeaveRequestStatus, UserStatus } from "@/generated/prisma/client";
import { recordAuditLog } from "@/lib/audit/log";
import { hasAnyGrant } from "@/lib/leave/queries";
import { prisma } from "@/lib/prisma";

export class EmployeeMutationError extends Error {}

export class EmailAlreadyExistsError extends EmployeeMutationError {
  constructor() {
    super("このメールアドレスはすでに登録されています");
  }
}

export class HireDateLockedError extends EmployeeMutationError {
  constructor() {
    super("有給付与が発生済みのため入社日は変更できません");
  }
}

export class CannotTerminateSelfError extends EmployeeMutationError {
  constructor() {
    super("自分自身の退職処理はできません");
  }
}

export class EmployeeNotFoundError extends EmployeeMutationError {
  constructor() {
    super("対象の社員が見つかりません");
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const SALT_ROUNDS = 10;

/** spec.md 4.4: 社員の新規登録(フルタイム勤務者のみを登録対象とする運用) */
export async function createEmployee(input: {
  name: string;
  email: string;
  password: string;
  hireDate: Date;
  role: Role;
  actingAdminId: string;
}): Promise<User> {
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          role: input.role,
          hireDate: input.hireDate,
        },
      });

      await recordAuditLog(tx, {
        actorId: input.actingAdminId,
        action: AuditAction.employee_created,
        targetUserId: created.id,
        detail: {
          name: input.name,
          email: input.email,
          hireDate: input.hireDate.toISOString(),
          role: input.role,
        },
      });

      return created;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new EmailAlreadyExistsError();
    }
    throw error;
  }
}

/** spec.md 4.4/7.1: hire_date は初回のLeaveGrantが発生した後は編集不可 */
export async function updateEmployee(input: {
  userId: string;
  name: string;
  email: string;
  hireDate?: Date;
  actingAdminId: string;
}): Promise<User> {
  const current = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!current) {
    throw new EmployeeNotFoundError();
  }

  let hireDate = current.hireDate;
  if (input.hireDate && input.hireDate.getTime() !== current.hireDate.getTime()) {
    if (await hasAnyGrant(input.userId)) {
      throw new HireDateLockedError();
    }
    hireDate = input.hireDate;
  }

  const hasChanges =
    input.name !== current.name || input.email !== current.email || hireDate.getTime() !== current.hireDate.getTime();

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: input.userId },
        data: { name: input.name, email: input.email, hireDate },
      });

      if (hasChanges) {
        await recordAuditLog(tx, {
          actorId: input.actingAdminId,
          action: AuditAction.employee_updated,
          targetUserId: input.userId,
          detail: {
            before: { name: current.name, email: current.email, hireDate: current.hireDate.toISOString() },
            after: { name: input.name, email: input.email, hireDate: hireDate.toISOString() },
          },
        });
      }

      return updated;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new EmailAlreadyExistsError();
    }
    throw error;
  }
}

/**
 * spec.md 4.4: 退職処理。(a)申請中は自動却下 (b)退職日より後のapproved申請は自動取消。
 * LeaveConsumptionには一切触れない(消化済み日数の残日数への復元は行わない)。
 * 特別休暇(SpecialLeaveRequest)は有給とは独立した記録だが、退職後に未処理の申請が
 * 宙に浮かないよう、pending状態のものは同様に自動却下する(spec.mdのスコープ外機能のため
 * 承認済み分の自動取消は行わない — 残高消費を伴わないため取消の実益が薄い)。
 */
export async function terminateEmployee(input: {
  userId: string;
  terminationDate: Date;
  actingAdminId: string;
}): Promise<void> {
  if (input.userId === input.actingAdminId) {
    throw new CannotTerminateSelfError();
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: input.userId },
      data: { status: UserStatus.terminated, terminationDate: input.terminationDate },
    });
    if (updated.count === 0) {
      throw new EmployeeNotFoundError();
    }

    await tx.leaveRequest.updateMany({
      where: { userId: input.userId, status: LeaveRequestStatus.pending },
      data: {
        status: LeaveRequestStatus.rejected,
        reviewedById: input.actingAdminId,
        reviewedAt: new Date(),
        rejectReason: "退職処理による自動却下",
      },
    });

    await tx.leaveRequest.updateMany({
      where: {
        userId: input.userId,
        status: LeaveRequestStatus.approved,
        targetDate: { gt: input.terminationDate },
      },
      data: {
        status: LeaveRequestStatus.cancelled,
        cancelledBy: "system",
        cancelledAt: new Date(),
        cancelReason: "退職処理による自動取消",
      },
    });

    await tx.specialLeaveRequest.updateMany({
      where: { userId: input.userId, status: SpecialLeaveRequestStatus.pending },
      data: {
        status: SpecialLeaveRequestStatus.rejected,
        reviewedById: input.actingAdminId,
        reviewedAt: new Date(),
        rejectReason: "退職処理による自動却下",
      },
    });

    await recordAuditLog(tx, {
      actorId: input.actingAdminId,
      action: AuditAction.employee_terminated,
      targetUserId: input.userId,
      detail: { terminationDate: input.terminationDate.toISOString() },
    });
  });
}

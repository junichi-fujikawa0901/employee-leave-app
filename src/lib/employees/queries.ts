import type { Role, UserStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export interface EmployeeEditTarget {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  hireDate: Date;
  terminationDate: Date | null;
}

/** 社員管理画面(4.4)の編集フォーム用。一覧/詳細より軽量な取得 */
export async function getEmployeeForEdit(userId: string): Promise<EmployeeEditTarget | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    hireDate: user.hireDate,
    terminationDate: user.terminationDate,
  };
}

export async function isEmailTaken(email: string, excludeUserId?: string): Promise<boolean> {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!existing) {
    return false;
  }
  return existing.id !== excludeUserId;
}

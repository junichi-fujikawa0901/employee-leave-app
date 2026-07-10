import { notFound, redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { UserStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** spec.md 8章: すべてのページ/Server Actionで個別に認可チェックを行うための共通ガード */

export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== UserStatus.active) {
    notFound();
  }
  return session;
}

/** admin以外は自分の詳細画面へ逃がす(社員一覧・社員管理はadmin専用) */
export async function requireAdminPage(): Promise<Session> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    redirect(`/employees/${session.user.id}`);
  }
  return session;
}

/** admin、または本人のみアクセス可。それ以外は404(存在有無を漏らさない) */
export async function requireSelfOrAdminPage(targetUserId: string): Promise<Session> {
  const session = await requireSession();
  if (session.user.role === "admin") {
    return session;
  }
  if (session.user.id !== targetUserId) {
    notFound();
  }
  return session;
}

export function isAdmin(session: Session): boolean {
  return session.user.role === "admin";
}

export function isSelf(session: Session, userId: string): boolean {
  return session.user.id === userId;
}

/** Server Action内で発生した認可・業務ルール違反を表す。呼び出し側でcatchしフォームにメッセージ表示する */
export class ActionError extends Error {}

export async function requireSessionForAction(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    throw new ActionError("認証されていません。再度ログインしてください");
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true },
  });
  if (!user || user.status !== UserStatus.active) {
    throw new ActionError("このアカウントは無効化されています");
  }
  return session;
}

export function assertAdminForAction(session: Session): void {
  if (!isAdmin(session)) {
    throw new ActionError("この操作を行う権限がありません");
  }
}

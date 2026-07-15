import { notFound, redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { Role, UserStatus } from "@/generated/prisma/client";
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

/** Route Handler内で発生した認証・認可エラーを表す。呼び出し側でcatchしHTTPステータス付きレスポンスに変換する */
export class RouteAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Route Handler専用の管理者認可ガード。ファイル出力APIなどセッション発行後の
 * 降格・退職を確実に弾く必要がある箇所向けに、status・roleの両方をDBの最新値で判定する
 * (ページ/Server Action用の既存ガードはstatusのみDB確認しroleはセッション値を使うため、
 * このガードはそれらと役割が異なる)。
 *
 * 戻り値のsession.user.roleは判定に使用済みの古い値であり、呼び出し側が
 * これを認可判断に再利用してはならない(判定は本関数内で完結させること)。
 */
export async function requireAdminForRoute(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    throw new RouteAuthError(401, "認証されていません");
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { status: true, role: true },
  });
  if (!user || user.status !== UserStatus.active) {
    throw new RouteAuthError(401, "このアカウントは無効化されています");
  }
  if (user.role !== Role.admin) {
    throw new RouteAuthError(403, "この操作を行う権限がありません");
  }
  return session;
}

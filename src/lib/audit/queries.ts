import type { AuditAction, Prisma } from "@/generated/prisma/client";
import { addDaysUTC } from "@/lib/date/calendar";
import { prisma } from "@/lib/prisma";

export interface AuditLogRow {
  id: string;
  action: AuditAction;
  createdAt: Date;
  actorId: string;
  actorName: string;
  targetUserId: string;
  targetUserName: string;
  targetId: string | null;
  detail: Prisma.JsonValue;
}

/** 監査ログは増え続けるため、一覧画面で一度に取得する件数の上限を設ける */
export const AUDIT_LOG_LIST_LIMIT = 200;

/**
 * 期間・対象社員で絞り込んだ監査ログを新しい順に返す(監査ログ一覧画面用)。
 * createdAtは時刻を含むDateTimeのため、toはその日の終わり(翌日0時未満)まで含める
 * (toを日付のみで単純比較すると、to当日中に記録されたログが取りこぼされるため)。
 */
export async function getAuditLogs(params: {
  from: Date;
  to: Date;
  targetUserId?: string;
}): Promise<AuditLogRow[]> {
  const endOfToDay = addDaysUTC(params.to, 1);
  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: params.from, lt: endOfToDay },
      ...(params.targetUserId ? { targetUserId: params.targetUserId } : {}),
    },
    include: {
      actor: { select: { name: true } },
      targetUser: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: AUDIT_LOG_LIST_LIMIT,
  });

  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    createdAt: log.createdAt,
    actorId: log.actorId,
    actorName: log.actor.name,
    targetUserId: log.targetUserId,
    targetUserName: log.targetUser.name,
    targetId: log.targetId,
    detail: log.detail,
  }));
}

/** 監査ログ一覧画面の対象社員絞り込みセレクトボックス用 */
export async function getAuditableUsers(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

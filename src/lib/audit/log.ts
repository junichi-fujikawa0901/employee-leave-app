import type { AuditAction, Prisma } from "@/generated/prisma/client";

export interface AuditLogInput {
  actorId: string;
  action: AuditAction;
  targetUserId: string;
  targetId?: string;
  detail?: Prisma.InputJsonValue;
}

/**
 * 監査ログを1件記録する薄いヘルパー。呼び出し元のトランザクション(tx)にそのまま乗せることで、
 * 操作が成功したときのみログが残る(ロールバック時はログも一緒に消える)。
 */
export async function recordAuditLog(tx: Prisma.TransactionClient, input: AuditLogInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetUserId: input.targetUserId,
      targetId: input.targetId,
      detail: input.detail,
    },
  });
}

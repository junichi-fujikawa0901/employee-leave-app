"use server";

import { revalidatePath } from "next/cache";

import { ActionError, assertAdminForAction, requireSessionForAction } from "@/lib/auth/guards";
import { InsufficientBalanceError } from "@/lib/leave/balance";
import { DomainError } from "@/lib/leave/errors";
import {
  approveLeaveRequest,
  approveLeaveRequestBatch,
  type BatchOutcome,
  rejectLeaveRequest,
  rejectLeaveRequestBatch,
} from "@/lib/leave/mutations";
import { prisma } from "@/lib/prisma";

export interface ActionState {
  error?: string;
  /** エラーではない情報メッセージ(一括操作の成功件数など) */
  message?: string;
}

/** 一括操作の結果をActionStateに変換する。分母は常にsucceeded+failed(処理対象になったpending件数) */
function summarizeBatchOutcome(outcome: BatchOutcome, verb: string): ActionState {
  const total = outcome.succeeded.length + outcome.failed.length;
  if (total === 0) {
    return { message: "対象の申請はすでに処理済みでした" };
  }
  if (outcome.failed.length === 0) {
    return { message: `${total}件をまとめて${verb}しました` };
  }
  const reasons = outcome.failed.map((f) => f.reason).join(" / ");
  return {
    error: `${total}件中${outcome.succeeded.length}件を${verb}しました(失敗${outcome.failed.length}件: ${reasons})`,
  };
}

function revalidatePendingRequestPages(userId: string): void {
  revalidatePath("/dashboard/pending-requests");
  revalidatePath("/dashboard");
  revalidatePath(`/employees/${userId}`);
  revalidatePath("/employees");
}

/**
 * bind引数のuserId(クライアントに渡るhidden inputのため理論上改ざん可能)を
 * revalidatePathの対象決定にそのまま信頼せず、requestIdからDB上の実際のuserIdを取得し直す。
 * 対象が見つからない場合(既に削除等)はフォールバックとしてbind引数を使う。
 */
async function resolveRequestOwnerId(requestId: string, fallbackUserId: string): Promise<string> {
  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId }, select: { userId: true } });
  return request?.userId ?? fallbackUserId;
}

async function resolveBatchOwnerId(batchId: string, fallbackUserId: string): Promise<string> {
  const request = await prisma.leaveRequest.findFirst({ where: { batchId }, select: { userId: true } });
  return request?.userId ?? fallbackUserId;
}

export async function approvePendingRequestAction(
  userId: string,
  requestId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ownerId = await resolveRequestOwnerId(requestId, userId);
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    await approveLeaveRequest({ requestId, reviewerId: session.user.id });
  } catch (error) {
    // 他の管理者が直前に処理済みだった場合(DomainError等)も一覧を古いままにしないため、
    // エラー経路でも revalidate する
    revalidatePendingRequestPages(ownerId);
    if (
      error instanceof ActionError ||
      error instanceof DomainError ||
      error instanceof InsufficientBalanceError
    ) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePendingRequestPages(ownerId);
  return {};
}

export async function rejectPendingRequestAction(
  userId: string,
  requestId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ownerId = await resolveRequestOwnerId(requestId, userId);
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const reason = formData.get("reason");
    await rejectLeaveRequest({
      requestId,
      reviewerId: session.user.id,
      reason: typeof reason === "string" ? reason : undefined,
    });
  } catch (error) {
    revalidatePendingRequestPages(ownerId);
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePendingRequestPages(ownerId);
  return {};
}

export async function approvePendingRequestBatchAction(
  userId: string,
  batchId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ownerId = await resolveBatchOwnerId(batchId, userId);
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const outcome = await approveLeaveRequestBatch({ batchId, reviewerId: session.user.id });
    revalidatePendingRequestPages(ownerId);
    return summarizeBatchOutcome(outcome, "承認");
  } catch (error) {
    revalidatePendingRequestPages(ownerId);
    if (
      error instanceof ActionError ||
      error instanceof DomainError ||
      error instanceof InsufficientBalanceError
    ) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function rejectPendingRequestBatchAction(
  userId: string,
  batchId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ownerId = await resolveBatchOwnerId(batchId, userId);
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const reason = formData.get("reason");
    const outcome = await rejectLeaveRequestBatch({
      batchId,
      reviewerId: session.user.id,
      reason: typeof reason === "string" ? reason : undefined,
    });
    revalidatePendingRequestPages(ownerId);
    return summarizeBatchOutcome(outcome, "却下");
  } catch (error) {
    revalidatePendingRequestPages(ownerId);
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

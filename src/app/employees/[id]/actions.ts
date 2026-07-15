"use server";

import { revalidatePath } from "next/cache";

import { LeaveUnit } from "@/generated/prisma/client";
import { ActionError, assertAdminForAction, requireSessionForAction } from "@/lib/auth/guards";
import { InsufficientBalanceError } from "@/lib/leave/balance";
import { MAX_BULK_REQUEST_DAYS, buildBulkRequestDates } from "@/lib/leave/date-range";
import { DomainError } from "@/lib/leave/errors";
import {
  approveLeaveRequest,
  approveLeaveRequestBatch,
  type BatchOutcome,
  cancelLeaveRequest,
  cancelLeaveRequestBatch,
  createLeaveRequest,
  createLeaveRequestBatch,
  rejectLeaveRequest,
  rejectLeaveRequestBatch,
  withdrawApprovedLeaveRequest,
} from "@/lib/leave/mutations";

export interface ActionState {
  error?: string;
  /** エラーではない情報メッセージ(一括操作の成功件数など) */
  message?: string;
}

/** 一括操作の結果をActionStateに変換する。分母は常にsucceeded+failed(処理対象になったpending件数) */
function summarizeBatchOutcome(outcome: BatchOutcome, verb: string): ActionState {
  const total = outcome.succeeded.length + outcome.failed.length;
  if (total === 0) {
    // 表示側は2件以上pendingがある場合のみボタンを出すため通常到達しないが、
    // クリック直前に他の操作で処理済みになった場合の防御的なメッセージ
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

function isValidUnit(value: FormDataEntryValue | null): value is LeaveUnit {
  return (
    value === LeaveUnit.full_day ||
    value === LeaveUnit.am_half ||
    value === LeaveUnit.pm_half ||
    value === LeaveUnit.hourly
  );
}

function revalidateEmployeePages(employeeId: string): void {
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/employees");
}

export async function submitLeaveRequestAction(
  employeeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    if (session.user.id !== employeeId) {
      return { error: "本人のみ申請できます" };
    }

    const targetDateValue = formData.get("targetDate");
    const unitValue = formData.get("unit");
    const hoursValue = formData.get("hours");

    if (typeof targetDateValue !== "string" || !targetDateValue) {
      return { error: "対象日を入力してください" };
    }
    if (!isValidUnit(unitValue)) {
      return { error: "区分を選択してください" };
    }

    let hours: number | null = null;
    if (unitValue === LeaveUnit.hourly) {
      const parsed = typeof hoursValue === "string" ? Number(hoursValue) : NaN;
      if (!Number.isFinite(parsed)) {
        return { error: "時間数を入力してください" };
      }
      hours = parsed;
    }

    await createLeaveRequest({
      userId: employeeId,
      targetDate: new Date(`${targetDateValue}T00:00:00.000Z`),
      unit: unitValue,
      hours,
    });
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidateEmployeePages(employeeId);
  return {};
}

export async function cancelLeaveRequestAction(
  employeeId: string,
  requestId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    if (session.user.id !== employeeId) {
      return { error: "本人のみ取消できます" };
    }

    const reason = formData.get("reason");
    await cancelLeaveRequest({
      requestId,
      actingUserId: session.user.id,
      reason: typeof reason === "string" ? reason : undefined,
    });
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidateEmployeePages(employeeId);
  return {};
}

export async function withdrawApprovedLeaveRequestAction(
  employeeId: string,
  requestId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    if (session.user.id !== employeeId) {
      return { error: "本人のみ取り下げできます" };
    }

    const reason = formData.get("reason");
    await withdrawApprovedLeaveRequest({
      requestId,
      actingUserId: session.user.id,
      reason: typeof reason === "string" ? reason : undefined,
    });
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidateEmployeePages(employeeId);
  return {};
}

export async function approveLeaveRequestAction(
  employeeId: string,
  requestId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    await approveLeaveRequest({ requestId, reviewerId: session.user.id });
  } catch (error) {
    if (
      error instanceof ActionError ||
      error instanceof DomainError ||
      error instanceof InsufficientBalanceError
    ) {
      return { error: error.message };
    }
    throw error;
  }

  revalidateEmployeePages(employeeId);
  return {};
}

export async function rejectLeaveRequestAction(
  employeeId: string,
  requestId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
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
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidateEmployeePages(employeeId);
  return {};
}

/** spec.md 6章: 期間一括申請(Phase 5)。開始日・終了日・土日除外から対象日をサーバー側で再計算する */
export async function submitLeaveRequestBatchAction(
  employeeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    if (session.user.id !== employeeId) {
      return { error: "本人のみ申請できます" };
    }

    const startValue = formData.get("startDate");
    const endValue = formData.get("endDate");
    const skipWeekends = formData.get("skipWeekends") === "on";

    if (typeof startValue !== "string" || !startValue || typeof endValue !== "string" || !endValue) {
      return { error: "開始日・終了日を入力してください" };
    }

    const start = new Date(`${startValue}T00:00:00.000Z`);
    const end = new Date(`${endValue}T00:00:00.000Z`);
    if (start.getTime() > end.getTime()) {
      return { error: "終了日は開始日以降にしてください" };
    }

    // クライアントが計算したプレビューの日付リストはそのまま信用せず、サーバー側で再計算する
    const dates = buildBulkRequestDates(start, end, { skipWeekends });
    if (dates.length === 0) {
      return { error: "対象日が1件もありません(土日除外の設定を確認してください)" };
    }
    if (dates.length > MAX_BULK_REQUEST_DAYS) {
      return { error: `一括申請できるのは${MAX_BULK_REQUEST_DAYS}日までです(現在${dates.length}日)` };
    }

    const created = await createLeaveRequestBatch({ userId: employeeId, dates });
    revalidateEmployeePages(employeeId);
    return { message: `${created.length}日分をまとめて申請しました` };
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function approveLeaveRequestBatchAction(
  employeeId: string,
  batchId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const outcome = await approveLeaveRequestBatch({ batchId, reviewerId: session.user.id });
    revalidateEmployeePages(employeeId);
    return summarizeBatchOutcome(outcome, "承認");
  } catch (error) {
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

export async function rejectLeaveRequestBatchAction(
  employeeId: string,
  batchId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const reason = formData.get("reason");
    const outcome = await rejectLeaveRequestBatch({
      batchId,
      reviewerId: session.user.id,
      reason: typeof reason === "string" ? reason : undefined,
    });
    revalidateEmployeePages(employeeId);
    return summarizeBatchOutcome(outcome, "却下");
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function cancelLeaveRequestBatchAction(
  employeeId: string,
  batchId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    if (session.user.id !== employeeId) {
      return { error: "本人のみ取消できます" };
    }

    const reason = formData.get("reason");
    const outcome = await cancelLeaveRequestBatch({
      batchId,
      actingUserId: session.user.id,
      reason: typeof reason === "string" ? reason : undefined,
    });
    revalidateEmployeePages(employeeId);
    return summarizeBatchOutcome(outcome, "取消");
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

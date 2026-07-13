"use server";

import { revalidatePath } from "next/cache";

import { ActionError, assertAdminForAction, requireSessionForAction } from "@/lib/auth/guards";
import { startOfTodayUTC } from "@/lib/date/calendar";
import { DomainError } from "@/lib/leave/errors";
import { runAutoGrantsForAllActiveUsers } from "@/lib/leave/grant-mutations";
import { type AutoGrantPreview, previewAutoGrants } from "@/lib/leave/queries";

export interface PreviewActionState {
  error?: string;
  preview?: AutoGrantPreview;
}

/** 社員一覧の「付与を実行」プレビュー用。DBへの書き込みは行わない */
export async function previewAutoGrantsAction(): Promise<PreviewActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);
    return { preview: await previewAutoGrants() };
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

export interface ConfirmActionState {
  error?: string;
  result?: { totalInserted: number; userCount: number };
}

/**
 * プレビュー時点の asOf をそのまま使って確定実行する。asOf を取り直さないことで、
 * プレビュー内容と確定結果の整合性を保証する(受け入れ基準)。
 */
export async function confirmAutoGrantsAction(
  _prevState: ConfirmActionState,
  formData: FormData,
): Promise<ConfirmActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const asOfValue = formData.get("asOf");
    if (typeof asOfValue !== "string" || !asOfValue) {
      return { error: "実行基準日が不正です。プレビューをやり直してください" };
    }
    const asOf = new Date(`${asOfValue}T00:00:00.000Z`);
    if (Number.isNaN(asOf.getTime()) || asOf.getTime() > startOfTodayUTC().getTime()) {
      return { error: "実行基準日が不正です。プレビューをやり直してください" };
    }

    const outcome = await runAutoGrantsForAllActiveUsers(asOf);
    revalidatePath("/employees");
    return { result: { totalInserted: outcome.totalInserted, userCount: outcome.perUser.length } };
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

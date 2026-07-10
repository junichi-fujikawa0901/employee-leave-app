"use server";

import { revalidatePath } from "next/cache";

import { LeaveUnit } from "@/generated/prisma/client";
import { ActionError, assertAdminForAction, requireSessionForAction } from "@/lib/auth/guards";
import { InsufficientBalanceError } from "@/lib/leave/balance";
import { DomainError } from "@/lib/leave/errors";
import {
  approveLeaveRequest,
  cancelLeaveRequest,
  createLeaveRequest,
  rejectLeaveRequest,
  withdrawApprovedLeaveRequest,
} from "@/lib/leave/mutations";

export interface ActionState {
  error?: string;
}

function isValidUnit(value: FormDataEntryValue | null): value is LeaveUnit {
  return value === LeaveUnit.full_day || value === LeaveUnit.am_half || value === LeaveUnit.pm_half;
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

    if (typeof targetDateValue !== "string" || !targetDateValue) {
      return { error: "対象日を入力してください" };
    }
    if (!isValidUnit(unitValue)) {
      return { error: "区分を選択してください" };
    }

    await createLeaveRequest({
      userId: employeeId,
      targetDate: new Date(`${targetDateValue}T00:00:00.000Z`),
      unit: unitValue,
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

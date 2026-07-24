"use server";

import { revalidatePath } from "next/cache";

import type { SpecialLeaveType } from "@/generated/prisma/client";
import { ActionError, assertAdminForAction, requireSessionForAction } from "@/lib/auth/guards";
import { DomainError } from "@/lib/leave/errors";
import { prisma } from "@/lib/prisma";
import {
  approveSpecialLeaveRequest,
  cancelSpecialLeaveRequest,
  createSpecialLeaveRequest,
  rejectSpecialLeaveRequest,
} from "@/lib/special-leave/mutations";

export interface ActionState {
  error?: string;
  message?: string;
}

function isValidType(value: FormDataEntryValue | null): value is SpecialLeaveType {
  return value === "ceremonial" || value === "maternity" || value === "childcare" || value === "summer";
}

function revalidateSpecialLeavePages(userId: string): void {
  revalidatePath("/special-leaves");
  revalidatePath(`/employees/${userId}`);
}

/** bind引数のrequestIdからDB上の実際のuserIdを取得する(revalidatePathの対象決定用) */
async function resolveRequestOwnerId(requestId: string): Promise<string | null> {
  const request = await prisma.specialLeaveRequest.findUnique({ where: { id: requestId }, select: { userId: true } });
  return request?.userId ?? null;
}

export async function submitSpecialLeaveRequestAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();

    const typeValue = formData.get("type");
    const startDateValue = formData.get("startDate");
    const endDateValue = formData.get("endDate");

    if (!isValidType(typeValue)) {
      return { error: "種別を選択してください" };
    }
    if (typeof startDateValue !== "string" || !startDateValue) {
      return { error: "開始日を入力してください" };
    }
    if (typeof endDateValue !== "string" || !endDateValue) {
      return { error: "終了日を入力してください" };
    }

    await createSpecialLeaveRequest({
      userId: session.user.id,
      type: typeValue,
      startDate: new Date(`${startDateValue}T00:00:00.000Z`),
      endDate: new Date(`${endDateValue}T00:00:00.000Z`),
    });

    revalidateSpecialLeavePages(session.user.id);
    return { message: "特別休暇を申請しました" };
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function cancelSpecialLeaveRequestAction(
  requestId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    const reason = formData.get("reason");

    await cancelSpecialLeaveRequest({
      requestId,
      actingUserId: session.user.id,
      reason: typeof reason === "string" ? reason : undefined,
    });

    revalidateSpecialLeavePages(session.user.id);
    return {};
  } catch (error) {
    if (error instanceof ActionError || error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function approveSpecialLeaveRequestAction(
  requestId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const ownerId = await resolveRequestOwnerId(requestId);
    try {
      await approveSpecialLeaveRequest({ requestId, reviewerId: session.user.id });
    } catch (error) {
      if (ownerId) {
        revalidateSpecialLeavePages(ownerId);
      }
      if (error instanceof DomainError) {
        return { error: error.message };
      }
      throw error;
    }

    if (ownerId) {
      revalidateSpecialLeavePages(ownerId);
    }
    return {};
  } catch (error) {
    if (error instanceof ActionError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function rejectSpecialLeaveRequestAction(
  requestId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const ownerId = await resolveRequestOwnerId(requestId);
    try {
      const reason = formData.get("reason");
      await rejectSpecialLeaveRequest({
        requestId,
        reviewerId: session.user.id,
        reason: typeof reason === "string" ? reason : undefined,
      });
    } catch (error) {
      if (ownerId) {
        revalidateSpecialLeavePages(ownerId);
      }
      if (error instanceof DomainError) {
        return { error: error.message };
      }
      throw error;
    }

    if (ownerId) {
      revalidateSpecialLeavePages(ownerId);
    }
    return {};
  } catch (error) {
    if (error instanceof ActionError) {
      return { error: error.message };
    }
    throw error;
  }
}

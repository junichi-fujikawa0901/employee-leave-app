"use server";

import { revalidatePath } from "next/cache";

import { HolidayType } from "@/generated/prisma/client";
import { ActionError, assertAdminForAction, requireSessionForAction } from "@/lib/auth/guards";
import {
  createHoliday,
  deleteCompanyHoliday,
  HolidayMutationError,
  type NationalHolidaySyncPreview,
  type NationalHolidaySyncResult,
  previewNationalHolidaySync,
  syncNationalHolidays,
  updateCompanyHoliday,
} from "@/lib/holidays/mutations";
import { NationalHolidayFetchError, NationalHolidayParseError } from "@/lib/holidays/national-holiday-source";

function isNationalHolidaySourceError(error: unknown): error is NationalHolidayFetchError | NationalHolidayParseError {
  return error instanceof NationalHolidayFetchError || error instanceof NationalHolidayParseError;
}

export interface PreviewSyncActionState {
  error?: string;
  preview?: NationalHolidaySyncPreview;
}

/** 休日マスタの「祝日データを確認する」プレビュー用。DBへの書き込みは行わない */
export async function previewNationalHolidaySyncAction(): Promise<PreviewSyncActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);
    return { preview: await previewNationalHolidaySync() };
  } catch (error) {
    if (error instanceof ActionError || error instanceof HolidayMutationError || isNationalHolidaySourceError(error)) {
      return { error: error.message };
    }
    throw error;
  }
}

export interface ConfirmSyncActionState {
  error?: string;
  result?: NationalHolidaySyncResult;
}

export async function confirmNationalHolidaySyncAction(
  _prevState: ConfirmSyncActionState,
  _formData: FormData,
): Promise<ConfirmSyncActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);
    const result = await syncNationalHolidays();
    revalidatePath("/holidays");
    return { result };
  } catch (error) {
    if (error instanceof ActionError || error instanceof HolidayMutationError || isNationalHolidaySourceError(error)) {
      return { error: error.message };
    }
    throw error;
  }
}

export interface CalendarActionState {
  error?: string;
  success?: boolean;
}

/**
 * カレンダーUI(holiday-calendar.tsx)から呼ばれる、ページ遷移なしの新規登録。
 * 種別は常にcompany_day_offとして作成する(祝日はnational_holiday取り込み経由でのみ増える運用を維持するため、
 * カレンダー上には種別選択を出さない)。
 */
export async function createHolidayFromCalendarAction(
  _prevState: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const dateValue = formData.get("date");
    const name = formData.get("name");

    if (typeof dateValue !== "string" || !dateValue) {
      return { error: "日付が不正です" };
    }
    if (typeof name !== "string" || !name.trim()) {
      return { error: "名称を入力してください" };
    }

    await createHoliday({
      date: new Date(`${dateValue}T00:00:00.000Z`),
      name: name.trim(),
      type: HolidayType.company_day_off,
    });
  } catch (error) {
    if (error instanceof ActionError || error instanceof HolidayMutationError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/holidays");
  return { success: true };
}

/**
 * カレンダーUIから呼ばれる、ページ遷移なしの編集(名称のみ)。updateCompanyHolidayにより
 * type=company_day_offのレコードのみを対象とするため、祝日IDを渡されてもHolidayNotFoundErrorになる。
 */
export async function updateHolidayFromCalendarAction(
  holidayId: string,
  _prevState: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const name = formData.get("name");
    if (typeof name !== "string" || !name.trim()) {
      return { error: "名称を入力してください" };
    }

    await updateCompanyHoliday({ id: holidayId, name: name.trim() });
  } catch (error) {
    if (error instanceof ActionError || error instanceof HolidayMutationError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/holidays");
  return { success: true };
}

/** カレンダーUIから呼ばれる、ページ遷移なしの削除。deleteCompanyHolidayによりtype=company_day_offのみ対象 */
export async function deleteHolidayFromCalendarAction(
  holidayId: string,
  _prevState: CalendarActionState,
  _formData: FormData,
): Promise<CalendarActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);
    await deleteCompanyHoliday(holidayId);
  } catch (error) {
    if (error instanceof ActionError || error instanceof HolidayMutationError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/holidays");
  return { success: true };
}

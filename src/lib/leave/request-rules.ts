import { LeaveUnit } from "@/generated/prisma/client";

export function unitToDays(unit: LeaveUnit): number {
  return unit === LeaveUnit.full_day ? 1 : 0.5;
}

export type RequestRuleViolation = "duplicate_unit" | "exceeds_daily_limit";

export type RequestRuleCheckResult = { ok: true } | { ok: false; reason: RequestRuleViolation };

/**
 * spec.md 4.3 / 6章: 同一日・同一区分の重複申請、および同一日の合計申請日数が
 * 1.0日を超える申請を禁止する。existingActiveUnitsOnSameDate は同一ユーザー・
 * 同一対象日で status が pending/approved の既存申請の unit 一覧。
 */
export function checkNewRequest(
  existingActiveUnitsOnSameDate: LeaveUnit[],
  newUnit: LeaveUnit,
): RequestRuleCheckResult {
  if (existingActiveUnitsOnSameDate.includes(newUnit)) {
    return { ok: false, reason: "duplicate_unit" };
  }

  const totalDays =
    existingActiveUnitsOnSameDate.reduce((sum, unit) => sum + unitToDays(unit), 0) + unitToDays(newUnit);
  if (totalDays > 1) {
    return { ok: false, reason: "exceeds_daily_limit" };
  }

  return { ok: true };
}

/** 承認済み申請の取り下げは対象日の3日前まで可能とする */
export const WITHDRAWAL_MIN_DAYS_BEFORE_TARGET = 3;

export function isWithinWithdrawalWindow(targetDate: Date, asOf: Date): boolean {
  const targetDay = Date.UTC(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate(),
  );
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const diffDays = Math.floor((targetDay - asOfDay) / (1000 * 60 * 60 * 24));
  return diffDays >= WITHDRAWAL_MIN_DAYS_BEFORE_TARGET;
}

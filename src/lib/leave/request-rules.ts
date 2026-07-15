import { LeaveUnit } from "@/generated/prisma/client";

/** 時間単位年休(Phase 4)の換算基準となる会社共通の所定労働時間 */
export const STANDARD_DAILY_HOURS = 8;
/** 時間単位年休の年間上限(労基法39条4項: 5日分を限度) */
export const HOURLY_ANNUAL_CAP_DAYS = 5;
export const HOURLY_ANNUAL_CAP_HOURS = STANDARD_DAILY_HOURS * HOURLY_ANNUAL_CAP_DAYS;

export function unitToDays(unit: LeaveUnit, hours: number | null = null): number {
  if (unit === LeaveUnit.hourly) {
    return (hours ?? 0) / STANDARD_DAILY_HOURS;
  }
  return unit === LeaveUnit.full_day ? 1 : 0.5;
}

export type RequestRuleViolation = "duplicate_unit" | "exceeds_daily_limit";

export type RequestRuleCheckResult = { ok: true } | { ok: false; reason: RequestRuleViolation };

export interface ExistingRequestUnit {
  unit: LeaveUnit;
  hours: number | null;
}

/**
 * spec.md 4.3 / 6章: 同一日・同一区分の重複申請、および同一日の合計申請日数が
 * 1.0日を超える申請を禁止する。existingActiveUnitsOnSameDate は同一ユーザー・
 * 同一対象日で status が pending/approved の既存申請の unit/hours 一覧。
 * hourly は同一日1件までのみ許容する方針のため、重複区分チェックがそのまま
 * 「時間単位は1日1件まで」を強制する(Phase 4)。
 */
export function checkNewRequest(
  existingActiveUnitsOnSameDate: ExistingRequestUnit[],
  newUnit: LeaveUnit,
  newHours: number | null = null,
): RequestRuleCheckResult {
  if (existingActiveUnitsOnSameDate.some((existing) => existing.unit === newUnit)) {
    return { ok: false, reason: "duplicate_unit" };
  }

  const totalDays =
    existingActiveUnitsOnSameDate.reduce(
      (sum, existing) => sum + unitToDays(existing.unit, existing.hours),
      0,
    ) + unitToDays(newUnit, newHours);
  if (totalDays > 1) {
    return { ok: false, reason: "exceeds_daily_limit" };
  }

  return { ok: true };
}

export type HourlyCapCheckResult = { ok: true } | { ok: false; reason: "exceeds_hourly_annual_cap" };

/**
 * 義務期間(Phase 2のObligationPeriod)内で時間単位年休の合計時間が上限(40時間=5日)を
 * 超えないかを判定する。整数の時間同士で比較する(日換算numberでの比較より堅牢なため)。
 */
export function checkHourlyCap(existingHoursInPeriod: number, newHours: number): HourlyCapCheckResult {
  if (existingHoursInPeriod + newHours > HOURLY_ANNUAL_CAP_HOURS) {
    return { ok: false, reason: "exceeds_hourly_annual_cap" };
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

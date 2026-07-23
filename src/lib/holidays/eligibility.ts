export type HolidayEligibilityViolation = "target_on_holiday";

export type HolidayEligibilityCheckResult =
  | { ok: true }
  | { ok: false; reason: HolidayEligibilityViolation };

/**
 * targetDateが休日マスタに登録された日付(holidayDatesはtoUtcMidnight済みのtimestamp集合)に
 * 含まれる場合はNGを返す純粋関数。既存のrequest-rules.tsのcheckNewRequestとは
 * 関心事(重複・日数上限 vs 休日)が異なるため、混ぜずに別関数として並置する。
 */
export function checkHolidayEligibility(
  targetDate: Date,
  holidayDates: Set<number>,
): HolidayEligibilityCheckResult {
  if (holidayDates.has(targetDate.getTime())) {
    return { ok: false, reason: "target_on_holiday" };
  }
  return { ok: true };
}

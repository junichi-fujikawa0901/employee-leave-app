import { describe, it, expect } from "vitest";
import { checkHolidayEligibility } from "@/lib/holidays/eligibility";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("checkHolidayEligibility", () => {
  it("targetDateがholidayDatesに含まれる場合はNG(target_on_holiday)を返す", () => {
    const holidayDates = new Set([utc(2026, 8, 11).getTime()]);
    const result = checkHolidayEligibility(utc(2026, 8, 11), holidayDates);
    expect(result).toEqual({ ok: false, reason: "target_on_holiday" });
  });

  it("targetDateがholidayDatesに含まれない場合はOKを返す", () => {
    const holidayDates = new Set([utc(2026, 8, 11).getTime()]);
    const result = checkHolidayEligibility(utc(2026, 8, 12), holidayDates);
    expect(result).toEqual({ ok: true });
  });

  it("holidayDatesが空集合の場合は常にOKを返す", () => {
    const result = checkHolidayEligibility(utc(2026, 8, 11), new Set());
    expect(result).toEqual({ ok: true });
  });
});

import { describe, it, expect } from "vitest";
import { LeaveUnit } from "@/generated/prisma/client";
import {
  unitToDays,
  checkNewRequest,
  checkHourlyCap,
  isWithinWithdrawalWindow,
  HOURLY_ANNUAL_CAP_HOURS,
  type ExistingRequestUnit,
} from "@/lib/leave/request-rules";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const unit = (unit: LeaveUnit, hours: number | null = null): ExistingRequestUnit => ({ unit, hours });

describe("unitToDays", () => {
  it("full_dayは1日", () => {
    expect(unitToDays(LeaveUnit.full_day)).toBe(1);
  });

  it("半休(am_half/pm_half)は0.5日", () => {
    expect(unitToDays(LeaveUnit.am_half)).toBe(0.5);
    expect(unitToDays(LeaveUnit.pm_half)).toBe(0.5);
  });

  it("時間単位(hourly)は所定労働時間8時間で日換算する(1〜8時間、丸め誤差なく正確)", () => {
    expect(unitToDays(LeaveUnit.hourly, 1)).toBe(0.125);
    expect(unitToDays(LeaveUnit.hourly, 2)).toBe(0.25);
    expect(unitToDays(LeaveUnit.hourly, 3)).toBe(0.375);
    expect(unitToDays(LeaveUnit.hourly, 4)).toBe(0.5);
    expect(unitToDays(LeaveUnit.hourly, 5)).toBe(0.625);
    expect(unitToDays(LeaveUnit.hourly, 6)).toBe(0.75);
    expect(unitToDays(LeaveUnit.hourly, 7)).toBe(0.875);
    expect(unitToDays(LeaveUnit.hourly, 8)).toBe(1);
  });

  it("hoursを渡さない場合、hourlyは0日として扱う", () => {
    expect(unitToDays(LeaveUnit.hourly)).toBe(0);
  });
});

describe("checkNewRequest", () => {
  it("同一区分の重複はduplicate_unit", () => {
    const result = checkNewRequest([unit(LeaveUnit.full_day)], LeaveUnit.full_day, null);
    expect(result).toEqual({ ok: false, reason: "duplicate_unit" });
  });

  it("午前半休+午後半休で合計ちょうど1.0日は許可(境界: 1.0超のみ超過扱い)", () => {
    const result = checkNewRequest([unit(LeaveUnit.am_half)], LeaveUnit.pm_half, null);
    expect(result).toEqual({ ok: true });
  });

  it("全休が既にある状態に半休を追加すると1.5日でexceeds_daily_limit", () => {
    const result = checkNewRequest([unit(LeaveUnit.full_day)], LeaveUnit.am_half, null);
    expect(result).toEqual({ ok: false, reason: "exceeds_daily_limit" });
  });

  it("既存申請が無い状態でfull_dayを新規申請するのは許可", () => {
    const result = checkNewRequest([], LeaveUnit.full_day, null);
    expect(result).toEqual({ ok: true });
  });

  it("時間単位が既にある状態に2件目の時間単位を追加するとduplicate_unit(1日1件までの強制)", () => {
    const result = checkNewRequest([unit(LeaveUnit.hourly, 2)], LeaveUnit.hourly, 3);
    expect(result).toEqual({ ok: false, reason: "duplicate_unit" });
  });

  it("午後半休(0.5日)+時間単位4時間(0.5日)で合計ちょうど1.0日は許可", () => {
    const result = checkNewRequest([unit(LeaveUnit.pm_half)], LeaveUnit.hourly, 4);
    expect(result).toEqual({ ok: true });
  });

  it("時間単位5時間(0.625日)+午後半休(0.5日)は1.125日でexceeds_daily_limit", () => {
    const result = checkNewRequest([unit(LeaveUnit.hourly, 5)], LeaveUnit.pm_half, null);
    expect(result).toEqual({ ok: false, reason: "exceeds_daily_limit" });
  });
});

describe("checkHourlyCap", () => {
  it("既存0時間+新規40時間はちょうど上限で許可", () => {
    expect(checkHourlyCap(0, HOURLY_ANNUAL_CAP_HOURS)).toEqual({ ok: true });
  });

  it("既存分と新規分の合計が上限を1時間でも超えるとexceeds_hourly_annual_cap", () => {
    expect(checkHourlyCap(HOURLY_ANNUAL_CAP_HOURS - 4, 5)).toEqual({
      ok: false,
      reason: "exceeds_hourly_annual_cap",
    });
  });

  it("既存分が上限未満で新規分を足しても収まる場合は許可", () => {
    expect(checkHourlyCap(10, 8)).toEqual({ ok: true });
  });
});

describe("isWithinWithdrawalWindow", () => {
  const asOf = utc(2026, 7, 13);

  it("ちょうど3日前は取り下げ可能(境界: 3日以上を含む)", () => {
    expect(isWithinWithdrawalWindow(utc(2026, 7, 16), asOf)).toBe(true);
  });

  it("2日前は取り下げ不可", () => {
    expect(isWithinWithdrawalWindow(utc(2026, 7, 15), asOf)).toBe(false);
  });

  it("4日前は取り下げ可能", () => {
    expect(isWithinWithdrawalWindow(utc(2026, 7, 17), asOf)).toBe(true);
  });

  it("対象日が今日と同日は取り下げ不可", () => {
    expect(isWithinWithdrawalWindow(asOf, asOf)).toBe(false);
  });

  it("対象日が過去日は取り下げ不可", () => {
    expect(isWithinWithdrawalWindow(utc(2026, 7, 10), asOf)).toBe(false);
  });

  it("時刻情報があってもUTC日付のみで比較する", () => {
    const asOfWithTime = new Date(Date.UTC(2026, 6, 13, 23, 59, 59));
    const targetExact3Days = new Date(Date.UTC(2026, 6, 16, 0, 0, 0));
    expect(isWithinWithdrawalWindow(targetExact3Days, asOfWithTime)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { LeaveUnit } from "@/generated/prisma/client";
import { unitToDays, checkNewRequest, isWithinWithdrawalWindow } from "@/lib/leave/request-rules";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("unitToDays", () => {
  it("full_dayは1日", () => {
    expect(unitToDays(LeaveUnit.full_day)).toBe(1);
  });

  it("半休(am_half/pm_half)は0.5日", () => {
    expect(unitToDays(LeaveUnit.am_half)).toBe(0.5);
    expect(unitToDays(LeaveUnit.pm_half)).toBe(0.5);
  });
});

describe("checkNewRequest", () => {
  it("同一区分の重複はduplicate_unit", () => {
    const result = checkNewRequest([LeaveUnit.full_day], LeaveUnit.full_day);
    expect(result).toEqual({ ok: false, reason: "duplicate_unit" });
  });

  it("午前半休+午後半休で合計ちょうど1.0日は許可(境界: 1.0超のみ超過扱い)", () => {
    const result = checkNewRequest([LeaveUnit.am_half], LeaveUnit.pm_half);
    expect(result).toEqual({ ok: true });
  });

  it("全休が既にある状態に半休を追加すると1.5日でexceeds_daily_limit", () => {
    const result = checkNewRequest([LeaveUnit.full_day], LeaveUnit.am_half);
    expect(result).toEqual({ ok: false, reason: "exceeds_daily_limit" });
  });

  it("既存申請が無い状態でfull_dayを新規申請するのは許可", () => {
    const result = checkNewRequest([], LeaveUnit.full_day);
    expect(result).toEqual({ ok: true });
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

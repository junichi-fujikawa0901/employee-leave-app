import { describe, it, expect } from "vitest";
import {
  getObligationPeriods,
  computeObligationStatus,
  selectPriorityObligation,
  isRecentlyOverdue,
  AT_RISK_THRESHOLD_DAYS,
  OVERDUE_DISPLAY_WINDOW_DAYS,
  type ObligationPeriod,
  type ObligationPeriodStatus,
} from "@/lib/leave/annual-obligation";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("getObligationPeriods", () => {
  it("付与記録が無ければ空配列を返す", () => {
    expect(getObligationPeriods([], utc(2025, 1, 1))).toEqual([]);
  });

  it("grantedDaysが10日未満の付与のみの場合は空配列を返す(義務対象外)", () => {
    const grants = [{ grantedDate: utc(2024, 7, 1), grantedDays: 5 }];
    expect(getObligationPeriods(grants, utc(2025, 1, 1))).toEqual([]);
  });

  it("単一の付与から義務期間(付与日〜+1年-1日)を1件返す", () => {
    const grants = [{ grantedDate: utc(2024, 7, 1), grantedDays: 10 }];
    expect(getObligationPeriods(grants, utc(2024, 12, 1))).toEqual([
      { start: utc(2024, 7, 1), end: utc(2025, 6, 30), baseGrantDays: 10 },
    ]);
  });

  it("asOfより後に始まる(未来の)付与は含めない", () => {
    const grants = [{ grantedDate: utc(2025, 7, 1), grantedDays: 11 }];
    expect(getObligationPeriods(grants, utc(2025, 6, 30))).toEqual([]);
  });

  it("複数の付与がある場合、start<=asOfのものをstart昇順で全件返す(過年度分も含む)", () => {
    const grants = [
      { grantedDate: utc(2024, 7, 1), grantedDays: 10 },
      { grantedDate: utc(2025, 7, 1), grantedDays: 11 },
      { grantedDate: utc(2026, 7, 1), grantedDays: 12 },
    ];
    const result = getObligationPeriods(grants, utc(2026, 8, 1));
    expect(result).toEqual([
      { start: utc(2024, 7, 1), end: utc(2025, 6, 30), baseGrantDays: 10 },
      { start: utc(2025, 7, 1), end: utc(2026, 6, 30), baseGrantDays: 11 },
      { start: utc(2026, 7, 1), end: utc(2027, 6, 30), baseGrantDays: 12 },
    ]);
  });

  it("月末入社(2025-08-31)では義務期間同士が1日重複することがあり、両方の期間がそのまま返る", () => {
    // hireDate=2025-08-31の法定マイルストーン(6ヶ月/18ヶ月/30ヶ月)は
    // addMonthsUTCの月末ロールオーバーにより 2026-03-03 / 2027-03-03 / 2028-03-02 となる。
    // 2027-03-03付与の義務期間(〜2028-03-02)と2028-03-02付与の義務期間(2028-03-02〜)が
    // 2028-03-02の1日だけ重複する。
    const grants = [
      { grantedDate: utc(2026, 3, 3), grantedDays: 10 },
      { grantedDate: utc(2027, 3, 3), grantedDays: 11 },
      { grantedDate: utc(2028, 3, 2), grantedDays: 12 },
    ];
    const result = getObligationPeriods(grants, utc(2028, 3, 2));
    expect(result).toEqual([
      { start: utc(2026, 3, 3), end: utc(2027, 3, 2), baseGrantDays: 10 },
      { start: utc(2027, 3, 3), end: utc(2028, 3, 2), baseGrantDays: 11 },
      { start: utc(2028, 3, 2), end: utc(2029, 3, 1), baseGrantDays: 12 },
    ]);
    // 2028-03-02は2番目と3番目の期間の両方に含まれる(重複日の取得実績は両方の集計に含まれる、意図した挙動)
    expect(result[1].end.getTime()).toBe(result[2].start.getTime());
  });
});

describe("computeObligationStatus", () => {
  const period: ObligationPeriod = { start: utc(2024, 7, 1), end: utc(2025, 6, 30), baseGrantDays: 10 };

  it("取得済みが0日ならremaining=5、期限に十分余裕があればon_track", () => {
    const result = computeObligationStatus(0, 0, period, utc(2024, 8, 1));
    expect(result.remaining).toBe(5);
    expect(result.status).toBe("on_track");
  });

  it(`期限ちょうど${AT_RISK_THRESHOLD_DAYS}日前はat_risk`, () => {
    const asOf = utc(2025, 5, 1); // 2025-06-30の60日前
    const result = computeObligationStatus(0, 0, period, asOf);
    expect(result.status).toBe("at_risk");
  });

  it(`期限${AT_RISK_THRESHOLD_DAYS + 1}日前はon_track`, () => {
    const asOf = utc(2025, 4, 30); // 2025-06-30の61日前
    const result = computeObligationStatus(0, 0, period, asOf);
    expect(result.status).toBe("on_track");
  });

  it("期限当日はまだat_risk(期限を過ぎていない)", () => {
    const result = computeObligationStatus(0, 0, period, utc(2025, 6, 30));
    expect(result.status).toBe("at_risk");
  });

  it("期限を過ぎていて未達ならoverdue", () => {
    const result = computeObligationStatus(2, 0, period, utc(2025, 7, 15));
    expect(result.status).toBe("overdue");
    expect(result.remaining).toBe(3);
  });

  it("取得済みが5日ちょうどならmet", () => {
    const result = computeObligationStatus(5, 0, period, utc(2024, 8, 1));
    expect(result.status).toBe("met");
    expect(result.remaining).toBe(0);
  });

  it("半休0.5日×10回=5日でもmet(0.5日刻みの積算)", () => {
    const result = computeObligationStatus(0.5 * 10, 0, period, utc(2024, 8, 1));
    expect(result.status).toBe("met");
  });

  it("取得予定(planned)が5日あっても取得済みが0ならmetにならない(実績のみで判定)", () => {
    const result = computeObligationStatus(0, 5, period, utc(2024, 8, 1));
    expect(result.status).not.toBe("met");
    expect(result.remaining).toBe(5);
  });
});

describe("selectPriorityObligation", () => {
  function statusOf(
    level: "met" | "at_risk" | "on_track" | "overdue",
    start: Date,
    deadline: Date,
  ): ObligationPeriodStatus {
    return {
      period: { start, end: deadline, baseGrantDays: 10 },
      status: {
        required: 5,
        taken: level === "met" ? 5 : 0,
        planned: 0,
        remaining: level === "met" ? 0 : 5,
        deadline,
        status: level,
      },
    };
  }

  it("空配列ならnullを返す", () => {
    expect(selectPriorityObligation([])).toBeNull();
  });

  it("過年度on_track + 当年度met の場合、過年度の未達を選ぶ", () => {
    const pastUnmet = statusOf("on_track", utc(2023, 7, 1), utc(2024, 6, 30));
    const currentMet = statusOf("met", utc(2024, 7, 1), utc(2025, 6, 30));
    expect(selectPriorityObligation([currentMet, pastUnmet])).toBe(pastUnmet);
  });

  it("過年度at_risk + 当年度on_track の場合、at_riskを優先する", () => {
    const pastAtRisk = statusOf("at_risk", utc(2023, 7, 1), utc(2024, 6, 30));
    const currentOnTrack = statusOf("on_track", utc(2024, 7, 1), utc(2025, 6, 30));
    expect(selectPriorityObligation([currentOnTrack, pastAtRisk])).toBe(pastAtRisk);
  });

  it("複数at_riskがある場合、deadlineが最も古い(=最も緊急な)ものを選ぶ", () => {
    const older = statusOf("at_risk", utc(2022, 7, 1), utc(2023, 6, 30));
    const newer = statusOf("at_risk", utc(2023, 7, 1), utc(2024, 6, 30));
    expect(selectPriorityObligation([newer, older])).toBe(older);
  });

  it("全期間metなら、startが最大(最新)の期間を選ぶ", () => {
    const older = statusOf("met", utc(2023, 7, 1), utc(2024, 6, 30));
    const newer = statusOf("met", utc(2024, 7, 1), utc(2025, 6, 30));
    expect(selectPriorityObligation([older, newer])).toBe(newer);
  });

  it("overdue(期限超過・法令違反確定)は他のどのステータスよりも最優先で選ばれる", () => {
    const overdue = statusOf("overdue", utc(2022, 7, 1), utc(2023, 6, 30));
    const atRisk = statusOf("at_risk", utc(2023, 7, 1), utc(2024, 6, 30));
    const onTrack = statusOf("on_track", utc(2024, 7, 1), utc(2025, 6, 30));
    const met = statusOf("met", utc(2025, 7, 1), utc(2026, 6, 30));
    expect(selectPriorityObligation([atRisk, onTrack, met, overdue])).toBe(overdue);
  });

  it("複数overdueがある場合、deadlineが最も古い(=最も長期化している)ものを選ぶ", () => {
    const older = statusOf("overdue", utc(2021, 7, 1), utc(2022, 6, 30));
    const newer = statusOf("overdue", utc(2022, 7, 1), utc(2023, 6, 30));
    expect(selectPriorityObligation([newer, older])).toBe(older);
  });
});

describe("isRecentlyOverdue", () => {
  const deadline = utc(2026, 7, 10);

  it("期限当日はtrue(超過0日)", () => {
    expect(isRecentlyOverdue(deadline, utc(2026, 7, 10))).toBe(true);
  });

  it(`期限からちょうど${OVERDUE_DISPLAY_WINDOW_DAYS}日後はtrue(境界を含む)`, () => {
    expect(isRecentlyOverdue(deadline, utc(2026, 7, 24))).toBe(true);
  });

  it(`期限から${OVERDUE_DISPLAY_WINDOW_DAYS + 1}日後はfalse`, () => {
    expect(isRecentlyOverdue(deadline, utc(2026, 7, 25))).toBe(false);
  });

  it("期限がまだ来ていない(未来)場合はfalse", () => {
    expect(isRecentlyOverdue(deadline, utc(2026, 7, 9))).toBe(false);
  });
});

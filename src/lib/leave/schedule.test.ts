import { describe, it, expect } from "vitest";
import { getNextGrantMilestone, getNextGrantYearMonth, computeExpireDate } from "@/lib/leave/schedule";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("getNextGrantMilestone", () => {
  const hireDate = utc(2024, 1, 1);

  it("6ヶ月ちょうどの基準日(asOfが基準日と同一)は10日のマイルストーンを返す(境界: baseDate >= asOf は含む)", () => {
    const result = getNextGrantMilestone(hireDate, utc(2024, 7, 1));
    expect(result).toEqual({ baseDate: utc(2024, 7, 1), grantedDays: 10 });
  });

  it("基準日の前日をasOfにしても同じマイルストーン(6ヶ月・10日)を返す", () => {
    const result = getNextGrantMilestone(hireDate, utc(2024, 6, 30));
    expect(result).toEqual({ baseDate: utc(2024, 7, 1), grantedDays: 10 });
  });

  it("基準日の翌日をasOfにすると次のマイルストーン(1年6ヶ月・11日)にスキップする", () => {
    const result = getNextGrantMilestone(hireDate, utc(2024, 7, 2));
    expect(result).toEqual({ baseDate: utc(2025, 7, 1), grantedDays: 11 });
  });

  it("固定テーブルの複数マイルストーンを跨いだ判定ができる(2年6ヶ月時点→2年6ヶ月・12日)", () => {
    const result = getNextGrantMilestone(hireDate, utc(2026, 6, 1));
    expect(result).toEqual({ baseDate: utc(2026, 7, 1), grantedDays: 12 });
  });

  it("固定テーブル最終マイルストーン(5年6ヶ月・18日)の前日はまだ同じマイルストーンを返す", () => {
    const result = getNextGrantMilestone(hireDate, utc(2029, 6, 30));
    expect(result).toEqual({ baseDate: utc(2029, 7, 1), grantedDays: 18 });
  });

  it("固定テーブル最終(5年6ヶ月・18日)の直後は20日打ち止めの継続付与に切り替わる", () => {
    const result = getNextGrantMilestone(hireDate, utc(2029, 7, 2));
    expect(result).toEqual({ baseDate: utc(2030, 7, 1), grantedDays: 20 });
  });

  it("20日打ち止め以降も12ヶ月ごとに継続してマイルストーンを算出できる(3世代先)", () => {
    const result = getNextGrantMilestone(utc(2020, 1, 1), utc(2028, 1, 1));
    expect(result).toEqual({ baseDate: utc(2028, 7, 1), grantedDays: 20 });
  });
});

describe("getNextGrantYearMonth", () => {
  it("getNextGrantMilestoneのbaseDateから年・月(1始まり)を導出する", () => {
    expect(getNextGrantYearMonth(utc(2024, 1, 1), utc(2024, 7, 1))).toEqual({ year: 2024, month: 7 });
  });
});

describe("computeExpireDate", () => {
  it("付与日から2年後の前日を返す", () => {
    expect(computeExpireDate(utc(2024, 7, 1))).toEqual(utc(2026, 6, 30));
  });

  it("spec.md 5.2の具体例: 2026-04-01付与は2028-03-31まで有効(2028-04-01失効ではない)", () => {
    expect(computeExpireDate(utc(2026, 4, 1))).toEqual(utc(2028, 3, 31));
  });

  it("うるう年2/29付与の場合、Dateの月末正規化により3/1の前日=2/28になる(現行実装の挙動を固定する回帰テスト)", () => {
    expect(computeExpireDate(utc(2024, 2, 29))).toEqual(utc(2026, 2, 28));
  });
});

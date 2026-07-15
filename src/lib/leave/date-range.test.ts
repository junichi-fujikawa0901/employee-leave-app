import { describe, it, expect } from "vitest";
import { buildBulkRequestDates } from "@/lib/leave/date-range";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("buildBulkRequestDates", () => {
  it("skipWeekends=falseなら土日を含めてそのまま列挙する", () => {
    // 2026-08-01は土曜日、2026-08-02は日曜日
    const dates = buildBulkRequestDates(utc(2026, 8, 1), utc(2026, 8, 3), { skipWeekends: false });
    expect(dates).toEqual([utc(2026, 8, 1), utc(2026, 8, 2), utc(2026, 8, 3)]);
  });

  it("skipWeekends=trueなら土曜・日曜を除外する", () => {
    const dates = buildBulkRequestDates(utc(2026, 8, 1), utc(2026, 8, 3), { skipWeekends: true });
    expect(dates).toEqual([utc(2026, 8, 3)]);
  });

  it("範囲がすべて土日の場合は空配列になる", () => {
    const dates = buildBulkRequestDates(utc(2026, 8, 1), utc(2026, 8, 2), { skipWeekends: true });
    expect(dates).toEqual([]);
  });

  it("平日のみの範囲ではskipWeekendsの有無で結果が変わらない", () => {
    const withSkip = buildBulkRequestDates(utc(2026, 8, 3), utc(2026, 8, 7), { skipWeekends: true });
    const withoutSkip = buildBulkRequestDates(utc(2026, 8, 3), utc(2026, 8, 7), { skipWeekends: false });
    expect(withSkip).toEqual(withoutSkip);
    expect(withSkip).toHaveLength(5);
  });
});

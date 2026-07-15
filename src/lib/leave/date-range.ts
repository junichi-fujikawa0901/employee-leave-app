import { enumerateDatesUTC } from "@/lib/date/calendar";

/** 期間一括申請(Phase 5)の対象日数の上限(暫定) */
export const MAX_BULK_REQUEST_DAYS = 31;

/**
 * start〜endの範囲から、期間一括申請の対象日候補を組み立てる。skipWeekendsがtrueなら
 * 土曜(6)・日曜(0)を除外する。土日除外はUI上の便利機能であり、休日を保証するものではない
 * (spec.md 9章: 勤務日適格性は本システムでは保証しない)。
 *
 * この関数はMAX_BULK_REQUEST_DAYSの上限チェックを行わない(単なる日付リスト生成に徹する)。
 * 上限判定は呼び出し側(UI表示・サーバー側検証それぞれ)の責務とする。
 */
export function buildBulkRequestDates(
  start: Date,
  end: Date,
  options: { skipWeekends: boolean },
): Date[] {
  const dates = enumerateDatesUTC(start, end);
  if (!options.skipWeekends) {
    return dates;
  }
  return dates.filter((date) => {
    const day = date.getUTCDay();
    return day !== 0 && day !== 6;
  });
}

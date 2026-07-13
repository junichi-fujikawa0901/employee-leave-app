import { addDaysUTC, addYearsUTC, toUtcMidnight } from "@/lib/date/calendar";

/** 労基法(2019年改正): 年5日取得義務の対象となる最低付与日数 */
const OBLIGATION_ELIGIBLE_GRANT_DAYS = 10;

export const REQUIRED_OBLIGATION_DAYS = 5;
export const AT_RISK_THRESHOLD_DAYS = 90;

export interface ObligationPeriod {
  start: Date;
  end: Date;
  baseGrantDays: number;
}

/**
 * grantedDays >= 10 の付与ごとに義務期間([grantedDate, grantedDate + 1年 - 1日])を作り、
 * start <= asOf のものを start 昇順で全件返す。
 *
 * 月末入社などで期間同士が1日重複するケースでは、両方の期間がそのまま返る。
 * 重複日の取得実績は両方の期間の集計に含まれる(これは意図した挙動。期間重複自体の
 * 解消はPhase 1のスケジュール計算側の課題であり、ここでは扱わない)。
 */
export function getObligationPeriods(
  grants: { grantedDate: Date; grantedDays: number }[],
  asOf: Date,
): ObligationPeriod[] {
  const normalizedAsOf = toUtcMidnight(asOf);
  return grants
    .filter((grant) => grant.grantedDays >= OBLIGATION_ELIGIBLE_GRANT_DAYS)
    .map((grant) => {
      const start = toUtcMidnight(grant.grantedDate);
      return {
        start,
        end: addDaysUTC(addYearsUTC(start, 1), -1),
        baseGrantDays: grant.grantedDays,
      };
    })
    .filter((period) => period.start.getTime() <= normalizedAsOf.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export type ObligationStatusLevel = "met" | "at_risk" | "behind";

export interface ObligationStatus {
  required: number;
  taken: number;
  planned: number;
  remaining: number;
  deadline: Date;
  status: ObligationStatusLevel;
}

/**
 * 1義務期間分の状態を計算する。takenDaysがrequired(5日)に達していればmet。
 * 未達の場合、期限までの残り日数(期限超過を含む)がAT_RISK_THRESHOLD_DAYS以下ならat_risk、
 * それより余裕があればbehind。
 */
export function computeObligationStatus(
  takenDays: number,
  plannedDays: number,
  period: ObligationPeriod,
  asOf: Date,
): ObligationStatus {
  const normalizedAsOf = toUtcMidnight(asOf);
  const remaining = Math.max(0, REQUIRED_OBLIGATION_DAYS - takenDays);

  let status: ObligationStatusLevel;
  if (remaining === 0) {
    status = "met";
  } else {
    const daysUntilDeadline = Math.floor(
      (period.end.getTime() - normalizedAsOf.getTime()) / (1000 * 60 * 60 * 24),
    );
    status = daysUntilDeadline <= AT_RISK_THRESHOLD_DAYS ? "at_risk" : "behind";
  }

  return {
    required: REQUIRED_OBLIGATION_DAYS,
    taken: takenDays,
    planned: plannedDays,
    remaining,
    deadline: period.end,
    status,
  };
}

export interface ObligationPeriodStatus {
  period: ObligationPeriod;
  status: ObligationStatus;
}

/**
 * 表示すべき義務期間を1件選ぶ。優先順位:
 * 1. at_risk(未達・期限90日以内、または期限超過)をdeadline昇順(最も緊急なもの)
 * 2. behind(未達・期限91日超)をdeadline昇順
 * 3. どちらも無ければstartが最大の期間(= metのはず)
 * 4. 期間が空ならnull
 */
export function selectPriorityObligation(
  periodStatuses: ObligationPeriodStatus[],
): ObligationPeriodStatus | null {
  if (periodStatuses.length === 0) {
    return null;
  }

  const byDeadlineAsc = (a: ObligationPeriodStatus, b: ObligationPeriodStatus) =>
    a.status.deadline.getTime() - b.status.deadline.getTime();

  const atRisk = periodStatuses.filter((ps) => ps.status.status === "at_risk").sort(byDeadlineAsc);
  if (atRisk.length > 0) {
    return atRisk[0];
  }

  const behind = periodStatuses.filter((ps) => ps.status.status === "behind").sort(byDeadlineAsc);
  if (behind.length > 0) {
    return behind[0];
  }

  return [...periodStatuses].sort((a, b) => b.period.start.getTime() - a.period.start.getTime())[0];
}

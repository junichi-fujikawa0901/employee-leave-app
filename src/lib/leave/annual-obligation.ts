import { addDaysUTC, addYearsUTC, toUtcMidnight } from "@/lib/date/calendar";

/** 労基法(2019年改正): 年5日取得義務の対象となる最低付与日数 */
const OBLIGATION_ELIGIBLE_GRANT_DAYS = 10;

export const REQUIRED_OBLIGATION_DAYS = 5;
/** 「要注意」とする期限までの残り日数のしきい値(二ヶ月以内 = 60日) */
export const AT_RISK_THRESHOLD_DAYS = 60;
/** 社員一覧で「義務違反」を目立たせて表示する、期限超過後の日数のしきい値(二週間 = 14日) */
export const OVERDUE_DISPLAY_WINDOW_DAYS = 14;

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

/**
 * met: 5日取得済み。
 * on_track: 未達だが期限まで(AT_RISK_THRESHOLD_DAYSより)余裕がある。バッジは出さない(通常表示)。
 * at_risk: 未達で期限がAT_RISK_THRESHOLD_DAYS以内に迫っている(期限前のみ)。黄色で「まもなく期限」。
 * overdue: 未達のまま期限を過ぎた(法令違反が確定している)。赤色で「義務違反(期限超過)」。
 */
export type ObligationStatusLevel = "met" | "on_track" | "at_risk" | "overdue";

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
 * 未達の場合、期限を過ぎていればoverdue、期限までの残り日数がAT_RISK_THRESHOLD_DAYS以下なら
 * at_risk、それより余裕があればon_track。
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
    if (daysUntilDeadline < 0) {
      status = "overdue";
    } else if (daysUntilDeadline <= AT_RISK_THRESHOLD_DAYS) {
      status = "at_risk";
    } else {
      status = "on_track";
    }
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

/**
 * 期限超過(overdue)後、OVERDUE_DISPLAY_WINDOW_DAYS以内かどうかを判定する。
 * 社員一覧画面では、義務違反を「発生した直後」だけ目立たせて通知し、それより古いものは
 * ノイズになるため表示しない(社員詳細画面では期間の古さに関わらず常に表示する)。
 * deadlineが未来(まだ超過していない)の場合はfalseを返す。
 */
export function isRecentlyOverdue(deadline: Date, asOf: Date): boolean {
  const normalizedAsOf = toUtcMidnight(asOf);
  const daysSinceDeadline = Math.floor(
    (normalizedAsOf.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24),
  );
  return daysSinceDeadline >= 0 && daysSinceDeadline <= OVERDUE_DISPLAY_WINDOW_DAYS;
}

export interface ObligationPeriodStatus {
  period: ObligationPeriod;
  status: ObligationStatus;
}

/**
 * 表示すべき義務期間を1件選ぶ。優先順位:
 * 1. overdue(未達のまま期限超過。法令違反が確定している)をdeadline昇順(最も古い=最も長期化しているもの)
 * 2. at_risk(未達・期限がAT_RISK_THRESHOLD_DAYS以内、まだ期限前)をdeadline昇順(最も緊急なもの)
 * 3. on_track(未達・まだ期限に余裕がある)をdeadline昇順
 * 4. met のうち start が最大(最新)の期間
 * 5. 上記のいずれも無ければnull(periodStatusesが空の場合のみ。1件でもあれば必ずいずれかの
 *    ステータスに分類されるため、通常はここに到達しない)
 */
export function selectPriorityObligation(
  periodStatuses: ObligationPeriodStatus[],
): ObligationPeriodStatus | null {
  if (periodStatuses.length === 0) {
    return null;
  }

  const byDeadlineAsc = (a: ObligationPeriodStatus, b: ObligationPeriodStatus) =>
    a.status.deadline.getTime() - b.status.deadline.getTime();

  const overdue = periodStatuses.filter((ps) => ps.status.status === "overdue").sort(byDeadlineAsc);
  if (overdue.length > 0) {
    return overdue[0];
  }

  const atRisk = periodStatuses.filter((ps) => ps.status.status === "at_risk").sort(byDeadlineAsc);
  if (atRisk.length > 0) {
    return atRisk[0];
  }

  const onTrack = periodStatuses.filter((ps) => ps.status.status === "on_track").sort(byDeadlineAsc);
  if (onTrack.length > 0) {
    return onTrack[0];
  }

  const met = periodStatuses.filter((ps) => ps.status.status === "met");
  if (met.length > 0) {
    return [...met].sort((a, b) => b.period.start.getTime() - a.period.start.getTime())[0];
  }

  return null;
}

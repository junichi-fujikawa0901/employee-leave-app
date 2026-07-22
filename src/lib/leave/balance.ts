import { toUtcMidnight } from "@/lib/date/calendar";

export interface GrantBalanceInput {
  id: string;
  grantedDate: Date;
  expireDate: Date;
  remainingDays: number;
}

export interface ConsumptionPlanItem {
  grantId: string;
  consumedDays: number;
}

export class InsufficientBalanceError extends Error {
  constructor() {
    super("残日数が不足しているため承認できません");
    this.name = "InsufficientBalanceError";
  }
}

export function isGrantActive(expireDate: Date, asOf: Date): boolean {
  return expireDate.getTime() >= asOf.getTime();
}

export const GRANT_EXPIRY_WARNING_DAYS = 90;

export type GrantExpiryStatusLevel = "expired" | "at_risk" | "normal";

/**
 * remainingDays <= 0(消化済み/未消化分なし。負値はデータ異常だが同様にnormal扱い)は
 * 警告不要としてnormal扱い。未消化分が残っているのに失効日を過ぎている場合のみexpired
 * (切り捨てられた日数がある、という記録上の注意喚起)。失効前でGRANT_EXPIRY_WARNING_DAYS
 * 日以内ならat_risk。asOfはUTC0時に正規化してから比較する
 * (annual-obligation.tsのcomputeObligationStatusと同じ方針。isGrantActive自体は単純な
 * 時刻比較なので、非正規化のasOfをそのまま渡すと失効日当日の判定がズレうる)。
 */
export function computeGrantExpiryStatus(
  remainingDays: number,
  expireDate: Date,
  asOf: Date,
): GrantExpiryStatusLevel {
  if (remainingDays <= 0) {
    return "normal";
  }
  const normalizedAsOf = toUtcMidnight(asOf);
  if (!isGrantActive(expireDate, normalizedAsOf)) {
    return "expired";
  }
  const daysUntilExpire = Math.floor(
    (expireDate.getTime() - normalizedAsOf.getTime()) / (1000 * 60 * 60 * 24),
  );
  return daysUntilExpire <= GRANT_EXPIRY_WARNING_DAYS ? "at_risk" : "normal";
}

/** spec.md 5.2 FEFO: 失効日昇順 → 付与日昇順 → ID昇順 */
export function sortFefo<T extends { expireDate: Date; grantedDate: Date; id: string }>(grants: T[]): T[] {
  return [...grants].sort((a, b) => {
    const expireDiff = a.expireDate.getTime() - b.expireDate.getTime();
    if (expireDiff !== 0) {
      return expireDiff;
    }
    const grantedDiff = a.grantedDate.getTime() - b.grantedDate.getTime();
    if (grantedDiff !== 0) {
      return grantedDiff;
    }
    return a.id.localeCompare(b.id);
  });
}

export function sumRemaining(activeGrants: GrantBalanceInput[]): number {
  return activeGrants.reduce((total, grant) => total + grant.remainingDays, 0);
}

/** FEFO順に必要日数を按分した消化プランを返す。残高不足なら InsufficientBalanceError を投げる */
export function planFefoConsumption(
  activeGrants: GrantBalanceInput[],
  requiredDays: number,
): ConsumptionPlanItem[] {
  const ordered = sortFefo(activeGrants);
  const plan: ConsumptionPlanItem[] = [];
  let remainingToConsume = requiredDays;

  for (const grant of ordered) {
    if (remainingToConsume <= 0) {
      break;
    }
    if (grant.remainingDays <= 0) {
      continue;
    }
    const consumedDays = Math.min(grant.remainingDays, remainingToConsume);
    plan.push({ grantId: grant.id, consumedDays });
    remainingToConsume -= consumedDays;
  }

  if (remainingToConsume > 0) {
    throw new InsufficientBalanceError();
  }

  return plan;
}

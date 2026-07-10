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

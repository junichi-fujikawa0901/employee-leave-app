import { addDaysUTC, addMonthsUTC, addYearsUTC } from "@/lib/date/calendar";

/** spec.md 5.1: 法定付与日数テーブル（フルタイム・8割出勤要件を満たす場合） */
const FIXED_MILESTONES: { monthsOffset: number; grantedDays: number }[] = [
  { monthsOffset: 6, grantedDays: 10 },
  { monthsOffset: 18, grantedDays: 11 },
  { monthsOffset: 30, grantedDays: 12 },
  { monthsOffset: 42, grantedDays: 14 },
  { monthsOffset: 54, grantedDays: 16 },
  { monthsOffset: 66, grantedDays: 18 },
];
const CONTINUING_GRANTED_DAYS = 20;
const CONTINUING_INTERVAL_MONTHS = 12;
const MAX_MILESTONE_LOOKUPS = 1000;

export interface GrantMilestone {
  baseDate: Date;
  grantedDays: number;
}

function milestoneAtIndex(hireDate: Date, index: number): GrantMilestone {
  if (index < FIXED_MILESTONES.length) {
    const { monthsOffset, grantedDays } = FIXED_MILESTONES[index];
    return { baseDate: addMonthsUTC(hireDate, monthsOffset), grantedDays };
  }

  const lastFixed = FIXED_MILESTONES[FIXED_MILESTONES.length - 1];
  const stepsBeyondFixed = index - FIXED_MILESTONES.length + 1;
  const monthsOffset = lastFixed.monthsOffset + CONTINUING_INTERVAL_MONTHS * stepsBeyondFixed;
  return { baseDate: addMonthsUTC(hireDate, monthsOffset), grantedDays: CONTINUING_GRANTED_DAYS };
}

/** hireDate を基準に、asOf 以降で最初に到来する付与基準日を返す */
export function getNextGrantMilestone(hireDate: Date, asOf: Date): GrantMilestone | null {
  for (let index = 0; index < MAX_MILESTONE_LOOKUPS; index += 1) {
    const milestone = milestoneAtIndex(hireDate, index);
    if (milestone.baseDate.getTime() >= asOf.getTime()) {
      return milestone;
    }
  }
  return null;
}

export function getNextGrantYearMonth(
  hireDate: Date,
  asOf: Date,
): { year: number; month: number } | null {
  const milestone = getNextGrantMilestone(hireDate, asOf);
  if (!milestone) {
    return null;
  }
  return { year: milestone.baseDate.getUTCFullYear(), month: milestone.baseDate.getUTCMonth() + 1 };
}

/** spec.md 5.2: expire_date は「利用可能な最終日」＝付与日から2年後の前日 */
export function computeExpireDate(grantedDate: Date): Date {
  return addDaysUTC(addYearsUTC(grantedDate, 2), -1);
}

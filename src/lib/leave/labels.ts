import { LeaveRequestStatus, LeaveUnit } from "@/generated/prisma/client";
import type { ObligationStatusLevel } from "@/lib/leave/annual-obligation";

export const UNIT_LABELS: Record<LeaveUnit, string> = {
  full_day: "全休",
  am_half: "午前半休",
  pm_half: "午後半休",
};

export const STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "却下",
  cancelled: "取消済み",
};

export const STATUS_BADGE_CLASSES: Record<LeaveRequestStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-500",
};

/** 年5日取得義務(Phase 2)のステータス表示。at_riskは期限間近・期限超過の両方を含む */
export const OBLIGATION_STATUS_LABELS: Record<ObligationStatusLevel, string> = {
  met: "達成",
  behind: "未達",
  at_risk: "要注意(期限間近/超過)",
};

export const OBLIGATION_STATUS_BADGE_CLASSES: Record<ObligationStatusLevel, string> = {
  met: "bg-green-100 text-green-800",
  behind: "bg-yellow-100 text-yellow-800",
  at_risk: "bg-red-100 text-red-800",
};

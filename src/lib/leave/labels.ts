import { LeaveRequestStatus, LeaveUnit } from "@/generated/prisma/client";

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

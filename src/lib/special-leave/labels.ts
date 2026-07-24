import type { SpecialLeaveRequestStatus, SpecialLeaveType } from "@/generated/prisma/client";

export const SPECIAL_LEAVE_TYPE_LABELS: Record<SpecialLeaveType, string> = {
  ceremonial: "慶弔休暇",
  maternity: "産前産後",
  childcare: "育児",
  summer: "夏季休暇",
};

export const SPECIAL_LEAVE_STATUS_LABELS: Record<SpecialLeaveRequestStatus, string> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "却下",
  cancelled: "取消済み",
};

export const SPECIAL_LEAVE_STATUS_BADGE_CLASSES: Record<SpecialLeaveRequestStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-500",
};

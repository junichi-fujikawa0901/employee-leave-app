import { LeaveRequestStatus, LeaveUnit } from "@/generated/prisma/client";
import type { ObligationStatusLevel } from "@/lib/leave/annual-obligation";
import type { GrantExpiryStatusLevel } from "@/lib/leave/balance";

export const UNIT_LABELS: Record<LeaveUnit, string> = {
  full_day: "全休",
  am_half: "午前半休",
  pm_half: "午後半休",
  hourly: "時間単位",
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

/**
 * 年5日取得義務(Phase 2)のステータス表示。on_track(まだ余裕がある)はバッジを出さない
 * (通常表示)ため未定義。at_riskは期限が迫っている旨の黄色バッジ、overdueは既に法令違反が
 * 確定している旨の赤バッジ。
 */
export const OBLIGATION_STATUS_LABELS: Partial<Record<ObligationStatusLevel, string>> = {
  met: "達成",
  at_risk: "まもなく期限",
  overdue: "義務違反(期限超過)",
};

export const OBLIGATION_STATUS_BADGE_CLASSES: Partial<Record<ObligationStatusLevel, string>> = {
  met: "bg-green-100 text-green-800",
  at_risk: "bg-yellow-100 text-yellow-800",
  overdue: "bg-red-100 text-red-800",
};

/**
 * 有給付与(LeaveGrant)個別の失効ステータス表示。上記の年5日取得義務(OBLIGATION_STATUS_*)とは
 * 別概念 — こちらは実際の有給の失効日(LeaveGrant.expireDate)に対するもの。normalはバッジ非表示のため未定義。
 */
export const GRANT_EXPIRY_STATUS_LABELS: Partial<Record<GrantExpiryStatusLevel, string>> = {
  at_risk: "まもなく失効",
  expired: "失効済み(未消化分あり)",
};

export const GRANT_EXPIRY_STATUS_BADGE_CLASSES: Partial<Record<GrantExpiryStatusLevel, string>> = {
  at_risk: "bg-red-100 text-red-800",
  expired: "bg-gray-100 text-gray-500",
};

import { GrantType, UserStatus } from "@/generated/prisma/client";

export const EXPORT_GRANT_TYPE_LABELS: Record<GrantType, string> = {
  [GrantType.annual_auto]: "法定自動付与",
  [GrantType.special]: "特別付与",
};

export const EXPORT_USER_STATUS_LABELS: Record<UserStatus, string> = {
  [UserStatus.active]: "在職中",
  [UserStatus.terminated]: "退職済み",
};

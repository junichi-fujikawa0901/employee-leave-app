import { AuditAction } from "@/generated/prisma/client";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  [AuditAction.leave_request_approved]: "有給申請を承認",
  [AuditAction.leave_request_rejected]: "有給申請を却下",
  [AuditAction.leave_request_cancelled]: "有給申請を取消",
  [AuditAction.leave_request_withdrawn]: "承認済み申請を取り下げ",
  [AuditAction.employee_terminated]: "退職処理",
  [AuditAction.employee_created]: "社員を新規登録",
  [AuditAction.employee_updated]: "社員情報を編集",
  [AuditAction.special_leave_request_approved]: "特別休暇申請を承認",
  [AuditAction.special_leave_request_rejected]: "特別休暇申請を却下",
  [AuditAction.special_leave_request_cancelled]: "特別休暇申請を取消",
};

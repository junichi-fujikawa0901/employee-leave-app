import { DomainError } from "@/lib/leave/errors";

export class InvalidDateRangeError extends DomainError {
  constructor() {
    super("終了日は開始日以降にしてください");
  }
}

export class SpecialLeaveTargetNotActiveError extends DomainError {
  constructor() {
    super("退職済みの社員は特別休暇を申請できません");
  }
}

export class SummerLeaveOutsideWindowError extends DomainError {
  constructor() {
    super("夏季休暇は同一年の7月1日〜9月30日の範囲内で申請してください");
  }
}

export class SummerLeaveCapExceededError extends DomainError {
  constructor() {
    super("夏季休暇は年間3日までです");
  }
}

export class SpecialLeaveRequestNotFoundError extends DomainError {
  constructor() {
    super("対象の特別休暇申請が見つかりません");
  }
}

export class SpecialLeaveRequestNotPendingError extends DomainError {
  constructor() {
    super("この申請はすでに処理済みです");
  }
}

export class SpecialLeaveSelfApprovalError extends DomainError {
  constructor() {
    super("自分自身が申請したものは承認・却下できません");
  }
}

export class SpecialLeaveNotRequestOwnerError extends DomainError {
  constructor() {
    super("この申請を取り消す権限がありません");
  }
}

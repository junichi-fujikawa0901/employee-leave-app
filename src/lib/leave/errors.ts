export class DomainError extends Error {}

export class DuplicateRequestError extends DomainError {
  constructor() {
    super("同一日・同一区分の重複申請はできません");
  }
}

export class ExceedsDailyLimitError extends DomainError {
  constructor() {
    super("同一日の合計申請日数が1.0日を超える申請はできません");
  }
}

export class SelfApprovalError extends DomainError {
  constructor() {
    super("自分自身が申請したものは承認・却下できません");
  }
}

export class RequestNotFoundError extends DomainError {
  constructor() {
    super("対象の申請が見つかりません");
  }
}

export class RequestNotPendingError extends DomainError {
  constructor() {
    super("この申請はすでに処理済みです");
  }
}

export class NotRequestOwnerError extends DomainError {
  constructor() {
    super("この申請を取り消す権限がありません");
  }
}

export class RequestNotApprovedError extends DomainError {
  constructor() {
    super("承認済みの申請のみ取り下げできます");
  }
}

export class WithdrawalDeadlinePassedError extends DomainError {
  constructor() {
    super("取得日の3日前を過ぎているため取り下げできません");
  }
}

export class GrantTargetNotFoundError extends DomainError {
  constructor() {
    super("対象の社員が見つかりません");
  }
}

export class GrantTargetNotActiveError extends DomainError {
  constructor() {
    super("退職済みの社員には自動付与を実行できません");
  }
}

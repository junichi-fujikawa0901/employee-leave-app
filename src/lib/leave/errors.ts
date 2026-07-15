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

export class InvalidHourlyRequestError extends DomainError {
  constructor() {
    super("時間単位年休は1〜8時間の整数で指定してください");
  }
}

export class HourlyLeaveOutsideObligationPeriodError extends DomainError {
  constructor() {
    super("対象日に対応する法定付与期間が見つかりません");
  }
}

export class ExceedsHourlyAnnualCapError extends DomainError {
  constructor() {
    super("時間単位年休は義務期間内で40時間(5日相当)までです");
  }
}

export class EmptyBatchDatesError extends DomainError {
  constructor() {
    super("対象日を1件以上指定してください");
  }
}

export class ExceedsBatchSizeLimitError extends DomainError {
  constructor() {
    super("一括申請できるのは31日までです");
  }
}

export class DuplicateDatesInBatchError extends DomainError {
  constructor() {
    super("対象日の中に重複があります");
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type BatchRequestConflictReason = "duplicate_unit" | "exceeds_daily_limit";

export class BatchRequestConflictError extends DomainError {
  constructor(
    public readonly conflicts: { targetDate: Date; reason: BatchRequestConflictReason }[],
  ) {
    super(
      `一部の対象日で申請できません(重複または1日の上限超過): ${conflicts
        .map((c) => formatDate(c.targetDate))
        .join(", ")}`,
    );
  }
}

export class RequestTargetNotActiveError extends DomainError {
  constructor() {
    super("退職済みの社員は有給を申請できません");
  }
}

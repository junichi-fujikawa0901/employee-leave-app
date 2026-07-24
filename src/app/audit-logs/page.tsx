import type { AuditAction, Prisma } from "@/generated/prisma/client";
import { AUDIT_ACTION_LABELS } from "@/lib/audit/labels";
import { AUDIT_LOG_LIST_LIMIT, getAuditableUsers, getAuditLogs, type AuditLogRow } from "@/lib/audit/queries";
import { requireAdminPage } from "@/lib/auth/guards";
import { addDaysUTC, startOfTodayUTC } from "@/lib/date/calendar";
import { SPECIAL_LEAVE_TYPE_LABELS } from "@/lib/special-leave/labels";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 不正な日付文字列(URL手入力等)が渡された場合はfallbackにする */
function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function formatDateTime(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/** detailのJsonから、操作種別ごとに読みやすいサマリー文字列を組み立てる */
function formatDetail(action: AuditAction, detail: Prisma.JsonValue): string {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    return "";
  }
  const d = detail as Record<string, unknown>;
  const dateOnly = (value: unknown) => (typeof value === "string" ? value.slice(0, 10) : "");

  switch (action) {
    case "leave_request_approved":
      return `対象日: ${dateOnly(d.targetDate)} / 区分: ${String(d.unit ?? "")}`;
    case "leave_request_rejected":
    case "leave_request_cancelled":
    case "leave_request_withdrawn": {
      const reason = typeof d.reason === "string" && d.reason ? ` / 理由: ${d.reason}` : "";
      return `対象日: ${dateOnly(d.targetDate)} / 区分: ${String(d.unit ?? "")}${reason}`;
    }
    case "employee_terminated":
      return `退職日: ${dateOnly(d.terminationDate)}`;
    case "employee_created":
      return `氏名: ${String(d.name ?? "")} / メール: ${String(d.email ?? "")}`;
    case "employee_updated": {
      const before = (d.before ?? {}) as Record<string, unknown>;
      const after = (d.after ?? {}) as Record<string, unknown>;
      return `変更前: ${String(before.name ?? "")}(${String(before.email ?? "")}) → 変更後: ${String(after.name ?? "")}(${String(after.email ?? "")})`;
    }
    case "special_leave_request_approved": {
      const type = d.type as keyof typeof SPECIAL_LEAVE_TYPE_LABELS | undefined;
      return `種別: ${type ? SPECIAL_LEAVE_TYPE_LABELS[type] : ""} / 期間: ${dateOnly(d.startDate)}〜${dateOnly(d.endDate)}`;
    }
    case "special_leave_request_rejected":
    case "special_leave_request_cancelled": {
      const type = d.type as keyof typeof SPECIAL_LEAVE_TYPE_LABELS | undefined;
      const reason = typeof d.reason === "string" && d.reason ? ` / 理由: ${d.reason}` : "";
      return `種別: ${type ? SPECIAL_LEAVE_TYPE_LABELS[type] : ""} / 期間: ${dateOnly(d.startDate)}〜${dateOnly(d.endDate)}${reason}`;
    }
    default:
      return "";
  }
}

/** 監査ログ一覧画面(管理者専用)。有給申請の承認/却下/取消/取り下げ・退職処理・社員登録編集を横断で確認できる */
export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; targetUserId?: string }>;
}) {
  await requireAdminPage();
  const { from: fromParam, to: toParam, targetUserId } = await searchParams;

  const today = startOfTodayUTC();
  const defaultFrom = addDaysUTC(today, -30);
  const from = parseDateParam(fromParam, defaultFrom);
  const to = parseDateParam(toParam, today);

  const [logs, users] = await Promise.all([
    getAuditLogs({ from, to, targetUserId: targetUserId || undefined }),
    getAuditableUsers(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="w-fit">
        <h1 className="text-2xl font-bold text-gray-900">監査ログ</h1>
        <span className="mt-2 block h-1 w-full bg-brand-accent" aria-hidden="true" />
      </div>

      <p className="text-xs text-gray-500">
        有給申請の承認/却下/取消/取り下げ、退職処理、社員登録・編集を「誰が・いつ・誰に対して」行ったか横断で確認できます。直近{AUDIT_LOG_LIST_LIMIT}件まで表示します。
      </p>

      <form
        method="get"
        action="/audit-logs"
        className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4 shadow"
      >
        <div className="space-y-1">
          <label htmlFor="from" className="block text-sm font-medium text-gray-700">
            開始日
          </label>
          <input
            id="from"
            name="from"
            type="date"
            required
            defaultValue={formatDate(from)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="to" className="block text-sm font-medium text-gray-700">
            終了日
          </label>
          <input
            id="to"
            name="to"
            type="date"
            required
            defaultValue={formatDate(to)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
          <label htmlFor="targetUserId" className="block text-sm font-medium text-gray-700">
            対象社員
          </label>
          <select
            id="targetUserId"
            name="targetUserId"
            defaultValue={targetUserId ?? ""}
            className="w-full max-w-full rounded border border-gray-300 px-3 py-2 text-sm sm:w-auto"
          >
            <option value="">全社員</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light"
        >
          絞り込む
        </button>
      </form>

      {logs.length === 0 ? (
        <div className="overflow-hidden rounded-lg bg-white shadow">
          <p className="p-4 text-sm text-gray-400">条件に一致する監査ログはありません</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg bg-white shadow md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">日時</th>
                  <th className="px-4 py-3 font-medium">実行者</th>
                  <th className="px-4 py-3 font-medium">対象社員</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                  <th className="px-4 py-3 font-medium">詳細</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: AuditLogRow) => (
                  <tr key={log.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-900">{formatDateTime(log.createdAt)}</td>
                    <td className="px-4 py-3 text-gray-700">{log.actorName}</td>
                    <td className="px-4 py-3 text-gray-700">{log.targetUserName}</td>
                    <td className="px-4 py-3 text-gray-700">{AUDIT_ACTION_LABELS[log.action]}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDetail(log.action, log.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {logs.map((log: AuditLogRow) => {
              const detail = formatDetail(log.action, log.detail);
              return (
                <div key={log.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-900">{AUDIT_ACTION_LABELS[log.action]}</p>
                    <span className="shrink-0 text-xs text-gray-500">{formatDateTime(log.createdAt)}</span>
                  </div>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">実行者</dt>
                      <dd className="text-gray-700">{log.actorName}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-gray-500">対象社員</dt>
                      <dd className="text-gray-700">{log.targetUserName}</dd>
                    </div>
                    {detail && (
                      <div>
                        <dt className="text-gray-500">詳細</dt>
                        <dd className="mt-0.5 text-gray-500">{detail}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

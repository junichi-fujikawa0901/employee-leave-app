"use client";

import { useActionState, useState, useTransition } from "react";

import {
  confirmNationalHolidaySyncAction,
  type ConfirmSyncActionState,
  previewNationalHolidaySyncAction,
  type PreviewSyncActionState,
} from "./actions";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const ACTION_LABELS: Record<string, string> = {
  create: "新規登録",
  update: "名称更新",
  skip_company_day_off: "スキップ(会社休日と重複)",
};

const initialConfirmState: ConfirmSyncActionState = {};

export function NationalHolidaySyncPanel() {
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [previewState, setPreviewState] = useState<PreviewSyncActionState | null>(null);
  const [confirmState, confirmAction, isConfirmPending] = useActionState(
    confirmNationalHolidaySyncAction,
    initialConfirmState,
  );

  const handlePreview = () => {
    startPreviewTransition(async () => {
      const result = await previewNationalHolidaySyncAction();
      setPreviewState(result);
    });
  };

  const handleCancel = () => {
    setPreviewState(null);
  };

  if (confirmState.result) {
    return (
      <div className="rounded-lg border border-green-200 bg-white p-6 shadow">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">祝日データの取り込み(内閣府)</h2>
        <p className="text-sm text-green-700">
          新規{confirmState.result.created}件・更新{confirmState.result.updated}件を反映しました
          {confirmState.result.skipped > 0 &&
            `(会社休日と重複のため${confirmState.result.skipped}件はスキップ)`}
          。
        </p>
      </div>
    );
  }

  if (!previewState) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">祝日データの取り込み(内閣府)</h2>
        <p className="mb-4 text-xs text-gray-500">
          内閣府公表の祝日データを取り込みます。すでに会社独自の休日として登録されている日は上書きせずスキップします。実行前に内容を確認できます。
        </p>
        <button
          type="button"
          onClick={handlePreview}
          disabled={isPreviewPending}
          className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
        >
          {isPreviewPending ? "取得中..." : "祝日データを確認する"}
        </button>
      </div>
    );
  }

  if (previewState.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-white p-6 shadow">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">祝日データの取り込み(内閣府)</h2>
        <p className="mb-4 text-sm text-red-600">{previewState.error}</p>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600"
        >
          閉じる
        </button>
      </div>
    );
  }

  const preview = previewState.preview;
  if (!preview) {
    return null;
  }

  if (preview.createCount === 0 && preview.updateCount === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">祝日データの取り込み(内閣府)</h2>
        <p className="mb-4 text-sm text-gray-500">
          新規・更新される祝日はありません
          {preview.skipCount > 0 && `(会社休日と重複のため${preview.skipCount}件はスキップ対象)`}。
        </p>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600"
        >
          閉じる
        </button>
      </div>
    );
  }

  return (
    <form action={confirmAction} className="rounded-lg border border-gray-200 bg-white p-6 shadow">
      <h2 className="mb-2 text-sm font-semibold text-gray-900">祝日データの取り込みプレビュー(内閣府)</h2>
      <p className="mb-4 text-xs text-gray-500">
        新規{preview.createCount}件・更新{preview.updateCount}件を反映します
        {preview.skipCount > 0 && `(会社休日と重複のため${preview.skipCount}件はスキップ)`}。
      </p>
      <div className="mb-4 max-h-64 overflow-y-auto rounded border border-gray-100">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">日付</th>
              <th className="px-3 py-2 font-medium">名称</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {preview.items.map((item) => (
              <tr key={item.date.toISOString()} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-900">{formatDate(item.date)}</td>
                <td className="px-3 py-2 text-gray-700">{item.name}</td>
                <td className="px-3 py-2 text-gray-700">{ACTION_LABELS[item.action]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirmState.error && <p className="mb-2 text-sm text-red-600">{confirmState.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isConfirmPending}
          className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
        >
          {isConfirmPending ? "実行中..." : "この内容で取り込む"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}

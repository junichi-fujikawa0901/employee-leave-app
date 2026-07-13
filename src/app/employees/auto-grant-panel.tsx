"use client";

import { useActionState, useState, useTransition } from "react";

import {
  confirmAutoGrantsAction,
  type ConfirmActionState,
  previewAutoGrantsAction,
  type PreviewActionState,
} from "./actions";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const initialConfirmState: ConfirmActionState = {};

export function AutoGrantPanel() {
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [previewState, setPreviewState] = useState<PreviewActionState | null>(null);
  const [confirmState, confirmAction, isConfirmPending] = useActionState(
    confirmAutoGrantsAction,
    initialConfirmState,
  );

  const handlePreview = () => {
    startPreviewTransition(async () => {
      const result = await previewAutoGrantsAction();
      setPreviewState(result);
    });
  };

  const handleCancel = () => {
    setPreviewState(null);
  };

  if (confirmState.result) {
    return (
      <div className="rounded-lg border border-green-200 bg-white p-6 shadow">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">有給自動付与</h2>
        <p className="text-sm text-green-700">
          {confirmState.result.userCount}名に対し、合計{confirmState.result.totalInserted}
          件の付与を実行しました。
        </p>
      </div>
    );
  }

  if (!previewState) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">有給自動付与</h2>
        <p className="mb-4 text-xs text-gray-500">
          勤続年数マイルストーンに到達した在職中の社員に、本日時点の有給付与を実行します。
          実行前に対象者と付与内容を確認できます。
        </p>
        <button
          type="button"
          onClick={handlePreview}
          disabled={isPreviewPending}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
        >
          {isPreviewPending ? "確認中..." : "本日時点の付与を確認する"}
        </button>
      </div>
    );
  }

  if (previewState.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-white p-6 shadow">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">有給自動付与</h2>
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

  if (preview.totalCount === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">有給自動付与</h2>
        <p className="mb-4 text-sm text-gray-500">
          {formatDate(preview.asOf)}時点で、新たに付与対象となる社員はいません。
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
      <h2 className="mb-2 text-sm font-semibold text-gray-900">有給自動付与のプレビュー</h2>
      <p className="mb-4 text-xs text-gray-500">
        {formatDate(preview.asOf)}時点で、以下の{preview.items.length}
        名・合計{preview.totalCount}件の付与が実行されます。
      </p>
      <div className="mb-4 max-h-64 overflow-y-auto rounded border border-gray-100">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">氏名</th>
              <th className="px-3 py-2 font-medium">付与日</th>
              <th className="px-3 py-2 font-medium">付与日数</th>
            </tr>
          </thead>
          <tbody>
            {preview.items.flatMap((item) =>
              item.grants.map((grant) => (
                <tr key={`${item.userId}:${grant.grantedDate.toISOString()}`} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-900">{item.userName}</td>
                  <td className="px-3 py-2 text-gray-700">{formatDate(grant.grantedDate)}</td>
                  <td className="px-3 py-2 text-gray-700">{grant.grantedDays}日</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <input type="hidden" name="asOf" value={formatDate(preview.asOf)} />
      {confirmState.error && <p className="mb-2 text-sm text-red-600">{confirmState.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isConfirmPending}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isConfirmPending ? "実行中..." : "この内容で付与を実行する"}
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

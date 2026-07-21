"use client";

import { useActionState, useState } from "react";

import type { ActionState } from "./actions";
import {
  approveLeaveRequestBatchAction,
  cancelLeaveRequestBatchAction,
  rejectLeaveRequestBatchAction,
} from "./actions";

const initialState: ActionState = {};

export function CancelRequestBatchButton({
  employeeId,
  batchId,
}: {
  employeeId: string;
  batchId: string;
}) {
  const action = cancelLeaveRequestBatchAction.bind(null, employeeId, batchId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [showReason, setShowReason] = useState(false);

  if (!showReason) {
    return (
      <button
        type="button"
        onClick={() => setShowReason(true)}
        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
      >
        まとめて取消
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input
        name="reason"
        placeholder="取消理由(任意)"
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-navy px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
        >
          まとめて取消を確定
        </button>
        <button
          type="button"
          onClick={() => setShowReason(false)}
          className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-500"
        >
          やめる
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.message && <p className="text-xs text-green-700">{state.message}</p>}
    </form>
  );
}

export function ApproveRequestBatchButton({
  employeeId,
  batchId,
}: {
  employeeId: string;
  batchId: string;
}) {
  const action = approveLeaveRequestBatchAction.bind(null, employeeId, batchId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="inline-block">
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        まとめて承認
      </button>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
      {state.message && <p className="mt-1 text-xs text-green-700">{state.message}</p>}
    </form>
  );
}

export function RejectRequestBatchButton({
  employeeId,
  batchId,
}: {
  employeeId: string;
  batchId: string;
}) {
  const action = rejectLeaveRequestBatchAction.bind(null, employeeId, batchId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [showReason, setShowReason] = useState(false);

  if (!showReason) {
    return (
      <button
        type="button"
        onClick={() => setShowReason(true)}
        className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700"
      >
        まとめて却下
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input
        name="reason"
        placeholder="却下理由(任意)"
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          まとめて却下を確定
        </button>
        <button
          type="button"
          onClick={() => setShowReason(false)}
          className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-500"
        >
          やめる
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.message && <p className="text-xs text-green-700">{state.message}</p>}
    </form>
  );
}

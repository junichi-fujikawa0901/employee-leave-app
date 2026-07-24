"use client";

import { useActionState, useState } from "react";

import type { ActionState } from "./actions";
import {
  approvePendingRequestAction,
  approvePendingRequestBatchAction,
  rejectPendingRequestAction,
  rejectPendingRequestBatchAction,
} from "./actions";

const initialState: ActionState = {};

export function ApprovePendingRequestButton({
  userId,
  requestId,
}: {
  userId: string;
  requestId: string;
}) {
  const action = approvePendingRequestAction.bind(null, userId, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="inline-block">
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        承認
      </button>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

export function RejectPendingRequestButton({
  userId,
  requestId,
}: {
  userId: string;
  requestId: string;
}) {
  const action = rejectPendingRequestAction.bind(null, userId, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [showReason, setShowReason] = useState(false);

  if (!showReason) {
    return (
      <button
        type="button"
        onClick={() => setShowReason(true)}
        className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700"
      >
        却下
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
          却下を確定
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
    </form>
  );
}

export function ApprovePendingRequestBatchButton({
  userId,
  batchId,
}: {
  userId: string;
  batchId: string;
}) {
  const action = approvePendingRequestBatchAction.bind(null, userId, batchId);
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

export function RejectPendingRequestBatchButton({
  userId,
  batchId,
}: {
  userId: string;
  batchId: string;
}) {
  const action = rejectPendingRequestBatchAction.bind(null, userId, batchId);
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

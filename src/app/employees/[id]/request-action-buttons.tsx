"use client";

import { useActionState, useState } from "react";

import type { ActionState } from "./actions";
import {
  approveLeaveRequestAction,
  cancelLeaveRequestAction,
  rejectLeaveRequestAction,
  withdrawApprovedLeaveRequestAction,
} from "./actions";

const initialState: ActionState = {};

export function CancelRequestButton({
  employeeId,
  requestId,
}: {
  employeeId: string;
  requestId: string;
}) {
  const action = cancelLeaveRequestAction.bind(null, employeeId, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [showReason, setShowReason] = useState(false);

  if (!showReason) {
    return (
      <button
        type="button"
        onClick={() => setShowReason(true)}
        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
      >
        取消
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
          取消を確定
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

export function WithdrawRequestButton({
  employeeId,
  requestId,
}: {
  employeeId: string;
  requestId: string;
}) {
  const action = withdrawApprovedLeaveRequestAction.bind(null, employeeId, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [showReason, setShowReason] = useState(false);

  if (!showReason) {
    return (
      <button
        type="button"
        onClick={() => setShowReason(true)}
        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
      >
        取り下げ
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input
        name="reason"
        placeholder="取り下げ理由(任意)"
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-navy px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
        >
          取り下げを確定
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

export function ApproveRequestButton({
  employeeId,
  requestId,
}: {
  employeeId: string;
  requestId: string;
}) {
  const action = approveLeaveRequestAction.bind(null, employeeId, requestId);
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

export function RejectRequestButton({
  employeeId,
  requestId,
}: {
  employeeId: string;
  requestId: string;
}) {
  const action = rejectLeaveRequestAction.bind(null, employeeId, requestId);
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

"use client";

import { useActionState } from "react";

import type { ActionState } from "./actions";
import { updateEmployeeAction } from "./actions";

const initialState: ActionState = {};

export function EditEmployeeForm({
  employeeId,
  name,
  email,
  hireDate,
  hireDateEditable,
}: {
  employeeId: string;
  name: string;
  email: string;
  hireDate: string;
  hireDateEditable: boolean;
}) {
  const action = updateEmployeeAction.bind(null, employeeId, hireDateEditable);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-4 rounded-lg bg-white p-6 shadow">
      <div className="space-y-1">
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          氏名
        </label>
        <input
          id="name"
          name="name"
          defaultValue={name}
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          メールアドレス
        </label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={email}
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="hireDate" className="block text-sm font-medium text-gray-700">
          入社日
        </label>
        <input
          id="hireDate"
          name="hireDate"
          type="date"
          defaultValue={hireDate}
          disabled={!hireDateEditable}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
        />
        {!hireDateEditable && (
          <p className="text-xs text-gray-400">有給付与が発生済みのため入社日は編集できません</p>
        )}
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
      >
        {isPending ? "保存中..." : "保存する"}
      </button>
    </form>
  );
}

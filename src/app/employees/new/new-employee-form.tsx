"use client";

import { useActionState } from "react";

import type { ActionState } from "./actions";
import { createEmployeeAction } from "./actions";

const initialState: ActionState = {};

export function NewEmployeeForm() {
  const [state, formAction, isPending] = useActionState(createEmployeeAction, initialState);

  return (
    <form action={formAction} className="max-w-md space-y-4 rounded-lg bg-white p-6 shadow">
      <div className="space-y-1">
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          氏名
        </label>
        <input
          id="name"
          name="name"
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
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          初期パスワード
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
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
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="role" className="block text-sm font-medium text-gray-700">
          権限
        </label>
        <select
          id="role"
          name="role"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="employee">社員</option>
          <option value="admin">管理者</option>
        </select>
      </div>
      <p className="text-xs text-gray-400">
        登録対象はフルタイム(週所定労働日数5日、または年間所定労働日数217日以上)勤務者に限ります。
      </p>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded bg-brand-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
      >
        {isPending ? "登録中..." : "登録する"}
      </button>
    </form>
  );
}

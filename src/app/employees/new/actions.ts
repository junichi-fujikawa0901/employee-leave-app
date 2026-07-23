"use server";

import { redirect } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { ActionError, assertAdminForAction, requireSessionForAction } from "@/lib/auth/guards";
import { createEmployee, EmployeeMutationError } from "@/lib/employees/mutations";

export interface ActionState {
  error?: string;
}

function isValidRole(value: FormDataEntryValue | null): value is Role {
  return value === Role.admin || value === Role.employee;
}

export async function createEmployeeAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let createdId: string;
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const name = formData.get("name");
    const email = formData.get("email");
    const password = formData.get("password");
    const hireDateValue = formData.get("hireDate");
    const roleValue = formData.get("role");

    if (typeof name !== "string" || !name.trim()) {
      return { error: "氏名を入力してください" };
    }
    if (typeof email !== "string" || !email.trim()) {
      return { error: "メールアドレスを入力してください" };
    }
    if (typeof password !== "string" || password.length < 8) {
      return { error: "初期パスワードは8文字以上で入力してください" };
    }
    if (typeof hireDateValue !== "string" || !hireDateValue) {
      return { error: "入社日を入力してください" };
    }
    if (!isValidRole(roleValue)) {
      return { error: "権限を選択してください" };
    }

    const created = await createEmployee({
      name: name.trim(),
      email: email.trim(),
      password,
      hireDate: new Date(`${hireDateValue}T00:00:00.000Z`),
      role: roleValue,
      actingAdminId: session.user.id,
    });
    createdId = created.id;
  } catch (error) {
    if (error instanceof ActionError || error instanceof EmployeeMutationError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect(`/employees/${createdId}`);
}

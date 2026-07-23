"use server";

import { redirect } from "next/navigation";

import { ActionError, assertAdminForAction, requireSessionForAction } from "@/lib/auth/guards";
import {
  EmployeeMutationError,
  terminateEmployee,
  updateEmployee,
} from "@/lib/employees/mutations";

export interface ActionState {
  error?: string;
}

export async function updateEmployeeAction(
  employeeId: string,
  hireDateEditable: boolean,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const name = formData.get("name");
    const email = formData.get("email");
    const hireDateValue = formData.get("hireDate");

    if (typeof name !== "string" || !name.trim()) {
      return { error: "氏名を入力してください" };
    }
    if (typeof email !== "string" || !email.trim()) {
      return { error: "メールアドレスを入力してください" };
    }

    await updateEmployee({
      userId: employeeId,
      name: name.trim(),
      email: email.trim(),
      hireDate:
        hireDateEditable && typeof hireDateValue === "string" && hireDateValue
          ? new Date(`${hireDateValue}T00:00:00.000Z`)
          : undefined,
      actingAdminId: session.user.id,
    });
  } catch (error) {
    if (error instanceof ActionError || error instanceof EmployeeMutationError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect(`/employees/${employeeId}`);
}

export async function terminateEmployeeAction(
  employeeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSessionForAction();
    assertAdminForAction(session);

    const terminationDateValue = formData.get("terminationDate");
    if (typeof terminationDateValue !== "string" || !terminationDateValue) {
      return { error: "退職日を入力してください" };
    }

    await terminateEmployee({
      userId: employeeId,
      terminationDate: new Date(`${terminationDateValue}T00:00:00.000Z`),
      actingAdminId: session.user.id,
    });
  } catch (error) {
    if (error instanceof ActionError || error instanceof EmployeeMutationError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect(`/employees/${employeeId}`);
}

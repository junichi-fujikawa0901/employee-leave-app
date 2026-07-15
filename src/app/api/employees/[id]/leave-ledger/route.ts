import { NextResponse } from "next/server";

import { RouteAuthError, requireAdminForRoute } from "@/lib/auth/guards";
import { startOfTodayUTC } from "@/lib/date/calendar";
import { buildLeaveLedgerWorkbook } from "@/lib/leave/ledger-excel";
import { getLeaveLedger } from "@/lib/leave/queries";
import { prisma } from "@/lib/prisma";

/** Phase 3: 年次有給休暇管理簿(Excel)のダウンロード。管理者限定 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireAdminForRoute();
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { id } = await params;
  const employee = await prisma.user.findUnique({
    where: { id },
    select: { name: true, email: true, hireDate: true },
  });
  if (!employee) {
    return new NextResponse(null, { status: 404 });
  }

  const periods = await getLeaveLedger(id, startOfTodayUTC());
  const buffer = await buildLeaveLedgerWorkbook(employee, periods, new Date());

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="leave-ledger.xlsx"; filename*=UTF-8''${encodeURIComponent(
        `${employee.name}_年次有給休暇管理簿.xlsx`,
      )}`,
      "Cache-Control": "private, no-store",
    },
  });
}

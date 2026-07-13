import { UserStatus } from "@/generated/prisma/client";
import { startOfTodayUTC } from "@/lib/date/calendar";
import { decimalToNumber } from "@/lib/decimal";
import { GrantTargetNotActiveError, GrantTargetNotFoundError } from "@/lib/leave/errors";
import { planAutoGrants, SYSTEM_LAUNCH_DATE } from "@/lib/leave/schedule";
import { prisma } from "@/lib/prisma";

export interface AutoGrantRunResult {
  insertedGrants: { grantedDate: Date; grantedDays: number; expireDate: Date }[];
  insertedCount: number;
  skippedCount: number;
}

/**
 * 在職中のユーザーに対し、SYSTEM_LAUNCH_DATE〜asOfの間で未生成のannual_autoマイルストーンを
 * LeaveGrantとして生成する。在職状態の確認と挿入は同一トランザクション内で行い、
 * 実行中に退職処理が割り込むレースを防ぐ。attendance_confirmed_*はnullのまま生成する
 * (確認は人事がシステム外で実施)。
 */
export async function runAutoGrantsForUser(
  userId: string,
  asOf: Date = startOfTodayUTC(),
): Promise<AutoGrantRunResult> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true, hireDate: true },
    });
    if (!user) {
      throw new GrantTargetNotFoundError();
    }
    if (user.status !== UserStatus.active) {
      throw new GrantTargetNotActiveError();
    }

    const planned = planAutoGrants(user.hireDate, asOf, SYSTEM_LAUNCH_DATE);
    if (planned.length === 0) {
      return { insertedGrants: [], insertedCount: 0, skippedCount: 0 };
    }

    const created = await tx.leaveGrant.createManyAndReturn({
      data: planned.map((g) => ({
        userId,
        grantedDate: g.grantedDate,
        grantedDays: g.grantedDays,
        expireDate: g.expireDate,
      })),
      skipDuplicates: true,
    });

    return {
      insertedGrants: created.map((g) => ({
        grantedDate: g.grantedDate,
        grantedDays: decimalToNumber(g.grantedDays),
        expireDate: g.expireDate,
      })),
      insertedCount: created.length,
      skippedCount: planned.length - created.length,
    };
  });
}

export interface AutoGrantAllRunResult {
  perUser: { userId: string; userName: string; result: AutoGrantRunResult }[];
  totalInserted: number;
}

/** 在職中の全ユーザーに対して runAutoGrantsForUser を実行する */
export async function runAutoGrantsForAllActiveUsers(
  asOf: Date = startOfTodayUTC(),
): Promise<AutoGrantAllRunResult> {
  const activeUsers = await prisma.user.findMany({
    where: { status: UserStatus.active },
    select: { id: true, name: true },
    orderBy: { hireDate: "asc" },
  });

  const perUser: AutoGrantAllRunResult["perUser"] = [];
  for (const user of activeUsers) {
    let result: AutoGrantRunResult;
    try {
      result = await runAutoGrantsForUser(user.id, asOf);
    } catch (error) {
      // active一覧取得後にレースで退職処理が割り込んだ場合のみここに来る。
      // バッチ全体は継続し、その社員だけスキップする。
      if (error instanceof GrantTargetNotActiveError || error instanceof GrantTargetNotFoundError) {
        continue;
      }
      throw error;
    }
    if (result.insertedCount > 0) {
      perUser.push({ userId: user.id, userName: user.name, result });
    }
  }

  return {
    perUser,
    totalInserted: perUser.reduce((sum, p) => sum + p.result.insertedCount, 0),
  };
}

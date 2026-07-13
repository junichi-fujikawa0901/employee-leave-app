import bcrypt from "bcryptjs";

import type { LeaveUnit, Role, User } from "../src/generated/prisma/client";
import { type GrantBalanceInput, isGrantActive, planFefoConsumption } from "../src/lib/leave/balance";
import { unitToDays } from "../src/lib/leave/request-rules";
import { computeExpireDate, planAutoGrants, SYSTEM_LAUNCH_DATE } from "../src/lib/leave/schedule";
import { prisma } from "../src/lib/prisma";

/**
 * このseedデータは「本システムは2024-01-01から運用を開始した」という前提で設計する。
 * 入社日(hire_date)はシステム運用開始より前でもよいが、LeaveGrant/LeaveRequestなど
 * システムが記録した実績データはこの日付以降にのみ存在するものとして生成する。
 * SYSTEM_LAUNCH_DATEはschedule.tsの定数と共有する。
 */

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function daysFromNow(days: number): Date {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function todayUTC(): Date {
  return daysFromNow(0);
}

async function ensureUser(data: {
  name: string;
  email: string;
  password: string;
  role: Role;
  hireDate: Date;
  status?: "active" | "terminated";
  terminationDate?: Date;
}): Promise<User> {
  const passwordHash = await bcrypt.hash(data.password, 10);
  return prisma.user.upsert({
    where: { email: data.email },
    update: {
      name: data.name,
      role: data.role,
      hireDate: data.hireDate,
      status: data.status ?? "active",
      terminationDate: data.terminationDate ?? null,
    },
    create: {
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
      hireDate: data.hireDate,
      status: data.status ?? "active",
      terminationDate: data.terminationDate,
    },
  });
}

/** この社員の有給関連データ(付与・申請・消化)を一度削除してから作り直す(再実行しても常に同じ結果になるように) */
async function resetLeaveData(userId: string, seedFn: () => Promise<void>): Promise<void> {
  await prisma.leaveConsumption.deleteMany({ where: { leaveRequest: { userId } } });
  await prisma.leaveRequest.deleteMany({ where: { userId } });
  await prisma.leaveGrant.deleteMany({ where: { userId } });
  await seedFn();
}

interface LedgerGrant {
  id: string;
  grantedDate: Date;
  expireDate: Date;
  remaining: number;
}

/**
 * 入社日から法定スケジュール通りに算出した付与枠を作成し、以後の日付順の
 * 承認済み申請をFEFOで消化していく台帳(ledger)を返す。実際の
 * approveLeaveRequestと同じロジック(isGrantActive/planFefoConsumption)を
 * 使うため、生成される消化内訳はアプリの実装と矛盾しない。
 *
 * throughDateには「今日」(在職中)、または退職日(退職済み社員は退職以降
 * 有給付与が発生しないため)を渡す。
 */
async function createAutoGrantLedger(userId: string, hireDate: Date, throughDate: Date) {
  const schedule = planAutoGrants(hireDate, throughDate, SYSTEM_LAUNCH_DATE);
  const grants: LedgerGrant[] = [];
  for (const item of schedule) {
    const grant = await prisma.leaveGrant.create({
      data: {
        userId,
        grantedDate: item.grantedDate,
        grantedDays: item.grantedDays,
        expireDate: item.expireDate,
      },
    });
    grants.push({ id: grant.id, grantedDate: item.grantedDate, expireDate: item.expireDate, remaining: item.grantedDays });
  }

  return {
    grants,

    /** 法定付与とは別枠の特別付与(grant_type: special)を台帳に追加する */
    async addSpecialGrant(grantedDate: Date, grantedDays: number) {
      const expireDate = computeExpireDate(grantedDate);
      const grant = await prisma.leaveGrant.create({
        data: { userId, grantType: "special", grantedDate, grantedDays, expireDate },
      });
      grants.push({ id: grant.id, grantedDate, expireDate, remaining: grantedDays });
      return grant;
    },

    async consumeApproved(
      targetDate: Date,
      unit: LeaveUnit,
      reviewedById: string,
      overrides?: { requestedAt?: Date; reviewedAt?: Date },
    ) {
      const active: GrantBalanceInput[] = grants
        .filter((g) => g.remaining > 0 && g.grantedDate.getTime() <= targetDate.getTime())
        .filter((g) => isGrantActive(g.expireDate, targetDate))
        .map((g) => ({ id: g.id, grantedDate: g.grantedDate, expireDate: g.expireDate, remainingDays: g.remaining }));

      const plan = planFefoConsumption(active, unitToDays(unit));

      const requestedAt = overrides?.requestedAt ?? new Date(targetDate.getTime() - 5 * 24 * 60 * 60 * 1000);
      const reviewedAt = overrides?.reviewedAt ?? new Date(targetDate.getTime() - 3 * 24 * 60 * 60 * 1000);

      const request = await prisma.leaveRequest.create({
        data: {
          userId,
          targetDate,
          unit,
          status: "approved",
          requestedAt,
          reviewedById,
          reviewedAt,
        },
      });

      for (const item of plan) {
        await prisma.leaveConsumption.create({
          data: { leaveRequestId: request.id, leaveGrantId: item.grantId, consumedDays: item.consumedDays },
        });
        const grant = grants.find((g) => g.id === item.grantId);
        if (grant) {
          grant.remaining -= item.consumedDays;
        }
      }

      return request;
    },
  };
}

async function main() {
  const today = todayUTC();

  // 管理者2名(自己承認禁止の運用には最低2名が前提。spec.md 3章/9章)
  const admin1 = await ensureUser({
    name: "管理者 太郎",
    email: "admin@example.com",
    password: "password1234",
    role: "admin",
    hireDate: utcDate(2018, 4, 1),
  });

  const admin2 = await ensureUser({
    name: "管理者 花子",
    email: "admin2@example.com",
    password: "password1234",
    role: "admin",
    hireDate: utcDate(2019, 7, 1),
  });

  // admin1: 法定スケジュール通りの付与(2024/2025年)+ 複数年にまたがる取得履歴 + 自己承認禁止デモ用のpending申請
  await resetLeaveData(admin1.id, async () => {
    const ledger = await createAutoGrantLedger(admin1.id, admin1.hireDate, today);
    await ledger.consumeApproved(utcDate(2024, 11, 15), "full_day", admin2.id);
    await ledger.consumeApproved(utcDate(2025, 6, 10), "am_half", admin2.id);
    await ledger.consumeApproved(utcDate(2025, 12, 5), "full_day", admin2.id);

    await prisma.leaveRequest.create({
      data: { userId: admin1.id, targetDate: daysFromNow(14), unit: "full_day", status: "pending" },
    });
  });

  // admin2: 法定スケジュール通りの付与(2024/2025/2026年、うち2024年分は現在すでに失効)+ 複数年にまたがる取得履歴
  await resetLeaveData(admin2.id, async () => {
    const ledger = await createAutoGrantLedger(admin2.id, admin2.hireDate, today);
    await ledger.consumeApproved(utcDate(2024, 3, 15), "full_day", admin1.id);
    await ledger.consumeApproved(utcDate(2024, 9, 20), "full_day", admin1.id);
    await ledger.consumeApproved(utcDate(2025, 5, 10), "am_half", admin1.id);
    await ledger.consumeApproved(utcDate(2025, 5, 11), "pm_half", admin1.id);
    await ledger.consumeApproved(utcDate(2026, 2, 1), "full_day", admin1.id);
  });

  // 入社直後(有給付与なし)の社員。「今日から3ヶ月前に入社」という相対的な意味を持たせるため今日基準のまま
  const newcomer = await ensureUser({
    name: "新人 一郎",
    email: "newcomer@example.com",
    password: "password1234",
    role: "employee",
    hireDate: daysFromNow(-90),
  });
  // 入社6ヶ月未満のため、法定スケジュール通りに算出しても付与は0件になるはず
  await resetLeaveData(newcomer.id, async () => {
    await createAutoGrantLedger(newcomer.id, newcomer.hireDate, today);
  });

  // 失効済みの付与枠を持つ社員(残日数集計から除外されることを確認する用)。
  // 入社日から法定スケジュール通りに算出すると、勤続年数の長さから最初の付与枠が
  // 現時点で自然に失効済みとなる(手動で失効日を作り込む必要はない)
  const expiredGrantUser = await ensureUser({
    name: "失効 次郎",
    email: "expired-grant@example.com",
    password: "password1234",
    role: "employee",
    hireDate: utcDate(2019, 1, 1),
  });
  await resetLeaveData(expiredGrantUser.id, async () => {
    await createAutoGrantLedger(expiredGrantUser.id, expiredGrantUser.hireDate, today);
  });

  // FEFO分割消費の検証用の社員。法定スケジュール通りの付与に加えて、
  // 「残り少なく失効日が近い」特別付与(grant_type: special)を1件加え、
  // FEFO分割消費を意図的に発生させる
  const fefoUser = await ensureUser({
    name: "FEFO 三郎",
    email: "fefo-test@example.com",
    password: "password1234",
    role: "employee",
    hireDate: utcDate(2021, 7, 1),
  });
  await resetLeaveData(fefoUser.id, async () => {
    const ledger = await createAutoGrantLedger(fefoUser.id, fefoUser.hireDate, today);
    // 残り0.5日の特別付与として直接作成する(過去の消化を捏造してFEFO順と矛盾させない)
    await ledger.addSpecialGrant(utcDate(2024, 8, 1), 0.5);

    // 承認するとFEFO順(特別付与の残0.5日→法定付与の一部)に分割消費されることを確認できるpending申請
    await prisma.leaveRequest.create({
      data: { userId: fefoUser.id, targetDate: daysFromNow(5), unit: "full_day", status: "pending" },
    });
  });

  // 却下済み・取消済み申請を持つ社員(理由の閲覧確認用、複数年にまたがる履歴)
  const historyUser = await ensureUser({
    name: "却下 四郎",
    email: "rejected-cancelled@example.com",
    password: "password1234",
    role: "employee",
    hireDate: utcDate(2022, 1, 1),
  });
  await resetLeaveData(historyUser.id, async () => {
    await createAutoGrantLedger(historyUser.id, historyUser.hireDate, today);
    await prisma.leaveRequest.create({
      data: {
        userId: historyUser.id,
        targetDate: utcDate(2024, 5, 10),
        unit: "full_day",
        status: "rejected",
        requestedAt: utcDate(2024, 5, 1),
        reviewedById: admin1.id,
        reviewedAt: utcDate(2024, 5, 2),
        rejectReason: "繁忙期のため却下",
      },
    });
    await prisma.leaveRequest.create({
      data: {
        userId: historyUser.id,
        targetDate: utcDate(2025, 9, 1),
        unit: "pm_half",
        status: "cancelled",
        requestedAt: utcDate(2025, 8, 20),
        cancelledBy: historyUser.id,
        cancelledAt: utcDate(2025, 8, 25),
        cancelReason: "予定変更のため",
      },
    });
  });

  // 退職済み社員(退職処理による自動却下・自動取消が反映済みの状態を再現)。
  // 退職日以降は付与が発生しないため、法定スケジュールはthroughDate=退職日で打ち切る
  const terminatedUser = await ensureUser({
    name: "退職 五郎",
    email: "terminated@example.com",
    password: "password1234",
    role: "employee",
    hireDate: utcDate(2023, 1, 1),
    status: "terminated",
    terminationDate: utcDate(2025, 12, 1),
  });
  await resetLeaveData(terminatedUser.id, async () => {
    const ledger = await createAutoGrantLedger(
      terminatedUser.id,
      terminatedUser.hireDate,
      terminatedUser.terminationDate ?? today,
    );

    await prisma.leaveRequest.create({
      data: {
        userId: terminatedUser.id,
        targetDate: utcDate(2025, 11, 10),
        unit: "full_day",
        status: "rejected",
        requestedAt: utcDate(2025, 11, 1),
        reviewedById: admin1.id,
        reviewedAt: utcDate(2025, 12, 1),
        rejectReason: "退職処理による自動却下",
      },
    });

    // 退職日より後の対象日で承認済みだった申請が、退職処理により自動取消となるケース。
    // 承認済み状態をFEFOロジックで正しく作った上で、消化内訳(cancelledAt)には触れず
    // ステータスのみ取消済みへ更新する(=消化済み日数は残日数に復元しない)
    const autoCancelledRequest = await ledger.consumeApproved(
      utcDate(2026, 1, 15),
      "full_day",
      admin1.id,
      { requestedAt: utcDate(2025, 11, 20), reviewedAt: utcDate(2025, 11, 25) },
    );
    await prisma.leaveRequest.update({
      where: { id: autoCancelledRequest.id },
      data: {
        status: "cancelled",
        cancelledBy: "system",
        cancelledAt: terminatedUser.terminationDate ?? today,
        cancelReason: "退職処理による自動取消",
      },
    });
  });

  console.log("Seeded users (システムは2024-01-01から運用開始という前提、全員password1234):");
  console.log("  admin@example.com (管理者1・2024/2025年の取得履歴あり)");
  console.log("  admin2@example.com (管理者2・2024〜2026年の取得履歴あり)");
  console.log("  newcomer@example.com (入社直後)");
  console.log("  expired-grant@example.com (失効枠あり)");
  console.log("  fefo-test@example.com (FEFO分割消費検証用・pending申請あり)");
  console.log("  rejected-cancelled@example.com (却下・取消履歴あり)");
  console.log("  terminated@example.com (退職済み・ログイン不可)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

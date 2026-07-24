import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  InvalidDateRangeError,
  SpecialLeaveNotRequestOwnerError,
  SpecialLeaveRequestNotFoundError,
  SpecialLeaveRequestNotPendingError,
  SpecialLeaveSelfApprovalError,
  SpecialLeaveTargetNotActiveError,
  SummerLeaveCapExceededError,
  SummerLeaveOutsideWindowError,
} from "@/lib/special-leave/errors";
import {
  approveSpecialLeaveRequest,
  cancelSpecialLeaveRequest,
  createSpecialLeaveRequest,
  rejectSpecialLeaveRequest,
} from "@/lib/special-leave/mutations";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdUserIds: string[] = [];

async function createTestUser(
  hireDate: Date,
  options?: { status?: "active" | "terminated" },
): Promise<{ id: string }> {
  const email = `${crypto.randomUUID()}@special-leave-test.local`;
  const user = await prisma.user.create({
    data: {
      name: `特別休暇テスト ${email}`,
      email,
      passwordHash: "not-used-in-test",
      role: "employee",
      hireDate,
      status: options?.status ?? "active",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id };
}

afterEach(async () => {
  if (createdUserIds.length === 0) {
    return;
  }
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: createdUserIds } }, { targetUserId: { in: createdUserIds } }] },
  });
  await prisma.specialLeaveRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("createSpecialLeaveRequest", () => {
  it("4種類とも作成でき、statusはpendingになる", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    for (const type of ["ceremonial", "maternity", "childcare"] as const) {
      await createSpecialLeaveRequest({
        userId: user.id,
        type,
        startDate: utc(2026, 1, 10),
        endDate: utc(2026, 1, 12),
      });
    }
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2026, 8, 1),
      endDate: utc(2026, 8, 1),
    });

    const requests = await prisma.specialLeaveRequest.findMany({ where: { userId: user.id } });
    expect(requests).toHaveLength(4);
    expect(requests.every((r) => r.status === "pending")).toBe(true);
  });

  it("startDate > endDateはInvalidDateRangeError", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    await expect(
      createSpecialLeaveRequest({
        userId: user.id,
        type: "ceremonial",
        startDate: utc(2026, 1, 12),
        endDate: utc(2026, 1, 10),
      }),
    ).rejects.toThrow(InvalidDateRangeError);
  });

  it("退職済みの社員はSpecialLeaveTargetNotActiveError", async () => {
    const user = await createTestUser(utc(2020, 1, 1), { status: "terminated" });

    await expect(
      createSpecialLeaveRequest({
        userId: user.id,
        type: "ceremonial",
        startDate: utc(2026, 1, 10),
        endDate: utc(2026, 1, 10),
      }),
    ).rejects.toThrow(SpecialLeaveTargetNotActiveError);
  });

  it("慶弔休暇は10日間でも日数上限なく作成できる(summer以外に上限は適用されない)", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 1),
      endDate: utc(2026, 1, 10),
    });

    const requests = await prisma.specialLeaveRequest.findMany({ where: { userId: user.id } });
    expect(requests).toHaveLength(1);
  });
});

describe("createSpecialLeaveRequest (夏季休暇の上限)", () => {
  it("既存2日+新規1日はちょうど3日で成功する", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2026, 7, 1),
      endDate: utc(2026, 7, 2),
    });
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2026, 8, 10),
      endDate: utc(2026, 8, 10),
    });

    const requests = await prisma.specialLeaveRequest.findMany({ where: { userId: user.id, type: "summer" } });
    expect(requests).toHaveLength(2);
  });

  it("単発4日申請は上限超過でSummerLeaveCapExceededError", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    await expect(
      createSpecialLeaveRequest({
        userId: user.id,
        type: "summer",
        startDate: utc(2026, 7, 1),
        endDate: utc(2026, 7, 4),
      }),
    ).rejects.toThrow(SummerLeaveCapExceededError);
  });

  it("既存2日がある状態で新規2日を申請すると上限超過(2件目がエラー)", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2026, 7, 1),
      endDate: utc(2026, 7, 2),
    });

    await expect(
      createSpecialLeaveRequest({
        userId: user.id,
        type: "summer",
        startDate: utc(2026, 8, 1),
        endDate: utc(2026, 8, 2),
      }),
    ).rejects.toThrow(SummerLeaveCapExceededError);
  });

  it("年度をまたぐと別枠として3日使える", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2025, 7, 1),
      endDate: utc(2025, 7, 3),
    });
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2026, 7, 1),
      endDate: utc(2026, 7, 3),
    });

    const requests = await prisma.specialLeaveRequest.findMany({ where: { userId: user.id, type: "summer" } });
    expect(requests).toHaveLength(2);
  });

  it("窓外(6月始まり)の申請はSummerLeaveOutsideWindowError", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    await expect(
      createSpecialLeaveRequest({
        userId: user.id,
        type: "summer",
        startDate: utc(2026, 6, 30),
        endDate: utc(2026, 7, 2),
      }),
    ).rejects.toThrow(SummerLeaveOutsideWindowError);
  });

  it("窓外(10月にはみ出す)の申請はSummerLeaveOutsideWindowError", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    await expect(
      createSpecialLeaveRequest({
        userId: user.id,
        type: "summer",
        startDate: utc(2026, 9, 29),
        endDate: utc(2026, 10, 2),
      }),
    ).rejects.toThrow(SummerLeaveOutsideWindowError);
  });

  it("却下された分は上限枠に戻り、新たに3日申請できる", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));

    const request = await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2026, 7, 1),
      endDate: utc(2026, 7, 2),
    }).then(() =>
      prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id, type: "summer" } }),
    );
    await rejectSpecialLeaveRequest({ requestId: request.id, reviewerId: reviewer.id });

    await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2026, 8, 1),
      endDate: utc(2026, 8, 3),
    });

    const requests = await prisma.specialLeaveRequest.findMany({
      where: { userId: user.id, type: "summer", status: { not: "rejected" } },
    });
    expect(requests).toHaveLength(1);
  });

  it("残り2日枠に2日分の申請を同時発火すると片方だけ成功する", async () => {
    const user = await createTestUser(utc(2020, 1, 1));

    await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2026, 7, 1),
      endDate: utc(2026, 7, 1),
    });

    const results = await Promise.allSettled([
      createSpecialLeaveRequest({
        userId: user.id,
        type: "summer",
        startDate: utc(2026, 8, 1),
        endDate: utc(2026, 8, 2),
      }),
      createSpecialLeaveRequest({
        userId: user.id,
        type: "summer",
        startDate: utc(2026, 9, 1),
        endDate: utc(2026, 9, 2),
      }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(SummerLeaveCapExceededError);
  });
});

describe("approveSpecialLeaveRequest", () => {
  it("承認するとstatusがapprovedになり、AuditLogが1件記録される", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 10),
      endDate: utc(2026, 1, 10),
    });
    const request = await prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id } });

    await approveSpecialLeaveRequest({ requestId: request.id, reviewerId: reviewer.id });

    const updated = await prisma.specialLeaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(updated.status).toBe("approved");
    expect(updated.reviewedById).toBe(reviewer.id);

    const logs = await prisma.auditLog.findMany({ where: { targetId: request.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("special_leave_request_approved");
  });

  it("自分自身の申請は承認できない(SpecialLeaveSelfApprovalError)", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 10),
      endDate: utc(2026, 1, 10),
    });
    const request = await prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id } });

    await expect(approveSpecialLeaveRequest({ requestId: request.id, reviewerId: user.id })).rejects.toThrow(
      SpecialLeaveSelfApprovalError,
    );
  });

  it("pending以外への承認はSpecialLeaveRequestNotPendingError", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 10),
      endDate: utc(2026, 1, 10),
    });
    const request = await prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id } });
    await approveSpecialLeaveRequest({ requestId: request.id, reviewerId: reviewer.id });

    await expect(approveSpecialLeaveRequest({ requestId: request.id, reviewerId: reviewer.id })).rejects.toThrow(
      SpecialLeaveRequestNotPendingError,
    );
  });

  it("存在しない申請IDはSpecialLeaveRequestNotFoundError", async () => {
    const reviewer = await createTestUser(utc(2020, 1, 1));

    await expect(
      approveSpecialLeaveRequest({ requestId: "does-not-exist", reviewerId: reviewer.id }),
    ).rejects.toThrow(SpecialLeaveRequestNotFoundError);
  });

  it("直接DB作成で上限を超えたpendingレコードは承認時に弾かれる", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));

    // createSpecialLeaveRequestの検証を経ずに、上限を超える2件を直接作成する
    await prisma.specialLeaveRequest.create({
      data: { userId: user.id, type: "summer", startDate: utc(2026, 7, 1), endDate: utc(2026, 7, 2) },
    });
    await prisma.specialLeaveRequest.create({
      data: { userId: user.id, type: "summer", startDate: utc(2026, 8, 1), endDate: utc(2026, 8, 2) },
    });

    const requests = await prisma.specialLeaveRequest.findMany({
      where: { userId: user.id, type: "summer" },
      orderBy: { startDate: "asc" },
    });

    await approveSpecialLeaveRequest({ requestId: requests[0].id, reviewerId: reviewer.id });
    await expect(
      approveSpecialLeaveRequest({ requestId: requests[1].id, reviewerId: reviewer.id }),
    ).rejects.toThrow(SummerLeaveCapExceededError);
  });

  it("直接DB作成でstartDate>endDateのレコードは承認時にInvalidDateRangeErrorで弾かれる", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));

    const request = await prisma.specialLeaveRequest.create({
      data: { userId: user.id, type: "ceremonial", startDate: utc(2026, 1, 12), endDate: utc(2026, 1, 10) },
    });

    await expect(
      approveSpecialLeaveRequest({ requestId: request.id, reviewerId: reviewer.id }),
    ).rejects.toThrow(InvalidDateRangeError);
  });

  it("直接DB作成で窓外のsummerレコードは承認時にSummerLeaveOutsideWindowErrorで弾かれる", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));

    const request = await prisma.specialLeaveRequest.create({
      data: { userId: user.id, type: "summer", startDate: utc(2026, 6, 30), endDate: utc(2026, 7, 1) },
    });

    await expect(
      approveSpecialLeaveRequest({ requestId: request.id, reviewerId: reviewer.id }),
    ).rejects.toThrow(SummerLeaveOutsideWindowError);
  });

  it("退職済みの社員のpending申請はSpecialLeaveTargetNotActiveErrorで承認できない", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 10),
      endDate: utc(2026, 1, 10),
    });
    const request = await prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id } });

    await prisma.user.update({ where: { id: user.id }, data: { status: "terminated" } });

    await expect(
      approveSpecialLeaveRequest({ requestId: request.id, reviewerId: reviewer.id }),
    ).rejects.toThrow(SpecialLeaveTargetNotActiveError);
  });

  it("残り2日枠に2日分のpending summerを同時承認すると片方だけ成功する", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));

    await createSpecialLeaveRequest({
      userId: user.id,
      type: "summer",
      startDate: utc(2026, 7, 1),
      endDate: utc(2026, 7, 1),
    });
    const first = await prisma.specialLeaveRequest.findFirstOrThrow({
      where: { userId: user.id, type: "summer" },
    });
    await approveSpecialLeaveRequest({ requestId: first.id, reviewerId: reviewer.id });

    // createSpecialLeaveRequestの検証(pending+approved合計チェック)を経ずに、
    // 残り2日枠を超える2件のpendingを直接作成する(承認時の再検証だけをテストするため)
    const pendingA = await prisma.specialLeaveRequest.create({
      data: { userId: user.id, type: "summer", startDate: utc(2026, 8, 1), endDate: utc(2026, 8, 2) },
    });
    const pendingB = await prisma.specialLeaveRequest.create({
      data: { userId: user.id, type: "summer", startDate: utc(2026, 9, 1), endDate: utc(2026, 9, 2) },
    });

    const results = await Promise.allSettled([
      approveSpecialLeaveRequest({ requestId: pendingA.id, reviewerId: reviewer.id }),
      approveSpecialLeaveRequest({ requestId: pendingB.id, reviewerId: reviewer.id }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(SummerLeaveCapExceededError);
  });
});

describe("rejectSpecialLeaveRequest", () => {
  it("却下するとstatusがrejectedになり理由が保存される", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 10),
      endDate: utc(2026, 1, 10),
    });
    const request = await prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id } });

    await rejectSpecialLeaveRequest({ requestId: request.id, reviewerId: reviewer.id, reason: "業務都合" });

    const updated = await prisma.specialLeaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(updated.status).toBe("rejected");
    expect(updated.rejectReason).toBe("業務都合");
  });

  it("自分自身の申請は却下できない", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 10),
      endDate: utc(2026, 1, 10),
    });
    const request = await prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id } });

    await expect(rejectSpecialLeaveRequest({ requestId: request.id, reviewerId: user.id })).rejects.toThrow(
      SpecialLeaveSelfApprovalError,
    );
  });
});

describe("cancelSpecialLeaveRequest", () => {
  it("本人はpending申請を取消できる", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 10),
      endDate: utc(2026, 1, 10),
    });
    const request = await prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id } });

    await cancelSpecialLeaveRequest({ requestId: request.id, actingUserId: user.id, reason: "予定変更" });

    const updated = await prisma.specialLeaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(updated.status).toBe("cancelled");
    expect(updated.cancelReason).toBe("予定変更");
  });

  it("他人の申請は取消できない(SpecialLeaveNotRequestOwnerError)", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const other = await createTestUser(utc(2020, 1, 1));
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 10),
      endDate: utc(2026, 1, 10),
    });
    const request = await prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id } });

    await expect(
      cancelSpecialLeaveRequest({ requestId: request.id, actingUserId: other.id }),
    ).rejects.toThrow(SpecialLeaveNotRequestOwnerError);
  });

  it("承認済みの申請は取消できない", async () => {
    const user = await createTestUser(utc(2020, 1, 1));
    const reviewer = await createTestUser(utc(2020, 1, 1));
    await createSpecialLeaveRequest({
      userId: user.id,
      type: "ceremonial",
      startDate: utc(2026, 1, 10),
      endDate: utc(2026, 1, 10),
    });
    const request = await prisma.specialLeaveRequest.findFirstOrThrow({ where: { userId: user.id } });
    await approveSpecialLeaveRequest({ requestId: request.id, reviewerId: reviewer.id });

    await expect(
      cancelSpecialLeaveRequest({ requestId: request.id, actingUserId: user.id }),
    ).rejects.toThrow(SpecialLeaveRequestNotPendingError);
  });
});

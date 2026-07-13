import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { startOfTodayUTC } from "@/lib/date/calendar";
import { runAutoGrantsForAllActiveUsers } from "@/lib/leave/grant-mutations";

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // CRON_SECRET未設定時は認証不能として扱う(Bearer undefinedでの突破を防ぐ)
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(authHeader);
  if (expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Vercel Cron から日次で呼ばれる有給自動付与バッチ。
 * Vercel Cronは `Authorization: Bearer $CRON_SECRET` を付けてリクエストする
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)。
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runAutoGrantsForAllActiveUsers(startOfTodayUTC());
  return NextResponse.json({
    totalInserted: result.totalInserted,
    userCount: result.perUser.length,
  });
}

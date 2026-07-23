import type { Holiday } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function getHolidays(): Promise<Holiday[]> {
  return prisma.holiday.findMany({ orderBy: { date: "asc" } });
}

/** start〜end(両端含む)の範囲にある休日の日付一覧を、対象日判定用のtimestamp Setとして返す */
export async function getHolidayDateSet(start: Date, end: Date): Promise<Set<number>> {
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    select: { date: true },
  });
  return new Set(holidays.map((holiday) => holiday.date.getTime()));
}

/** start〜end(両端含む)の範囲にある休日をname/type込みで返す(カレンダー表示用) */
export async function getHolidaysInRange(start: Date, end: Date): Promise<Holiday[]> {
  return prisma.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
  });
}

/** 休日が1件でも登録されている年の一覧を昇順で返す(カレンダー表示の年ジャンプ用) */
export async function getHolidayYears(): Promise<number[]> {
  const holidays = await prisma.holiday.findMany({ select: { date: true } });
  const years = new Set(holidays.map((holiday) => holiday.date.getUTCFullYear()));
  return Array.from(years).sort((a, b) => a - b);
}

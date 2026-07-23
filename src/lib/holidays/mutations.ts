import type { Holiday } from "@/generated/prisma/client";
import { HolidayType, Prisma } from "@/generated/prisma/client";
import { fetchNationalHolidays } from "@/lib/holidays/national-holiday-source";
import { prisma } from "@/lib/prisma";

export class HolidayMutationError extends Error {}

export class DuplicateHolidayDateError extends HolidayMutationError {
  constructor() {
    super("その日付はすでに休日として登録されています");
  }
}

export class HolidayNotFoundError extends HolidayMutationError {
  constructor() {
    super("対象の休日が見つかりません");
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createHoliday(input: {
  date: Date;
  name: string;
  type: HolidayType;
}): Promise<Holiday> {
  try {
    return await prisma.holiday.create({ data: input });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DuplicateHolidayDateError();
    }
    throw error;
  }
}

/**
 * カレンダーUIからの編集用。対象がtype=company_day_offであることをWHERE条件に含めて
 * DBレベルで保証する(祝日を誤って編集できないようにするための専用関数。カレンダー側の
 * クリック不可UIガードだけではServer Actionを直接呼ばれた場合に祝日を書き換えられて
 * しまうため、Codexレビューのmust-fix対応)。
 */
export async function updateCompanyHoliday(input: {
  id: string;
  name: string;
}): Promise<Holiday> {
  const result = await prisma.holiday.updateMany({
    where: { id: input.id, type: HolidayType.company_day_off },
    data: { name: input.name },
  });
  if (result.count === 0) {
    throw new HolidayNotFoundError();
  }
  return prisma.holiday.findUniqueOrThrow({ where: { id: input.id } });
}

/** カレンダーUIからの削除用。updateCompanyHolidayと同様にtype=company_day_offをWHERE条件に含めて保護する */
export async function deleteCompanyHoliday(id: string): Promise<void> {
  const result = await prisma.holiday.deleteMany({ where: { id, type: HolidayType.company_day_off } });
  if (result.count === 0) {
    throw new HolidayNotFoundError();
  }
}

export type NationalHolidaySyncAction = "create" | "update" | "skip_company_day_off";

export interface NationalHolidaySyncPreviewItem {
  date: Date;
  name: string;
  action: NationalHolidaySyncAction;
}

export interface NationalHolidaySyncPreview {
  items: NationalHolidaySyncPreviewItem[];
  createCount: number;
  updateCount: number;
  skipCount: number;
}

/**
 * 内閣府の祝日データをfetchし、既存のHolidayレコードと突き合わせて
 * 新規/更新/スキップ(会社独自休日と重複)を判定する。DBへの書き込みは行わない。
 */
export async function previewNationalHolidaySync(): Promise<NationalHolidaySyncPreview> {
  const fetched = await fetchNationalHolidays();
  const existing = await prisma.holiday.findMany({
    where: { date: { in: fetched.map((item) => item.date) } },
  });
  const existingByDate = new Map(existing.map((holiday) => [holiday.date.getTime(), holiday]));

  const items: NationalHolidaySyncPreviewItem[] = fetched.map((item) => {
    const existingHoliday = existingByDate.get(item.date.getTime());
    if (!existingHoliday) {
      return { date: item.date, name: item.name, action: "create" };
    }
    if (existingHoliday.type === HolidayType.company_day_off) {
      return { date: item.date, name: item.name, action: "skip_company_day_off" };
    }
    return { date: item.date, name: item.name, action: "update" };
  });

  return {
    items,
    createCount: items.filter((item) => item.action === "create").length,
    updateCount: items.filter((item) => item.action === "update").length,
    skipCount: items.filter((item) => item.action === "skip_company_day_off").length,
  };
}

export interface NationalHolidaySyncResult {
  created: number;
  updated: number;
  skipped: number;
}

/**
 * 内閣府の祝日データを再取得し、確定反映する。プレビュー時点のデータをそのまま渡すのではなく
 * 再fetchする設計(自動付与バッチのasOf再送パターンとは異なる)。祝日データは年1回程度しか
 * 更新されないため、プレビュー〜確定の間隔でずれるリスクは無視できる。
 * type = company_day_off の既存レコードは上書きせずスキップする(会社独自休日を優先)。
 */
export async function syncNationalHolidays(): Promise<NationalHolidaySyncResult> {
  const fetched = await fetchNationalHolidays();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.holiday.findMany({
      where: { date: { in: fetched.map((item) => item.date) } },
    });
    const existingByDate = new Map(existing.map((holiday) => [holiday.date.getTime(), holiday]));

    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const item of fetched) {
      const existingHoliday = existingByDate.get(item.date.getTime());
      if (!existingHoliday) {
        await tx.holiday.create({
          data: { date: item.date, name: item.name, type: HolidayType.national_holiday },
        });
        created += 1;
      } else if (existingHoliday.type === HolidayType.company_day_off) {
        skipped += 1;
      } else {
        await tx.holiday.update({ where: { id: existingHoliday.id }, data: { name: item.name } });
        updated += 1;
      }
    }
    return { created, updated, skipped };
  });
}

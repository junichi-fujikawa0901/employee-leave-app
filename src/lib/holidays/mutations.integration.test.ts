import { describe, it, expect, afterEach, vi } from "vitest";

import {
  createHoliday,
  deleteCompanyHoliday,
  DuplicateHolidayDateError,
  HolidayNotFoundError,
  previewNationalHolidaySync,
  syncNationalHolidays,
  updateCompanyHoliday,
} from "@/lib/holidays/mutations";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/holidays/national-holiday-source", async () => {
  const actual = await vi.importActual<typeof import("@/lib/holidays/national-holiday-source")>(
    "@/lib/holidays/national-holiday-source",
  );
  return { ...actual, fetchNationalHolidays: vi.fn() };
});

import { fetchNationalHolidays } from "@/lib/holidays/national-holiday-source";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const createdHolidayIds: string[] = [];

async function createTestHoliday(
  date: Date,
  type: "national_holiday" | "company_day_off" = "national_holiday",
): Promise<{ id: string }> {
  const holiday = await createHoliday({ date, name: "テスト休日", type });
  createdHolidayIds.push(holiday.id);
  return { id: holiday.id };
}

afterEach(async () => {
  vi.mocked(fetchNationalHolidays).mockReset();
  if (createdHolidayIds.length === 0) {
    return;
  }
  await prisma.holiday.deleteMany({ where: { id: { in: createdHolidayIds } } });
  createdHolidayIds.length = 0;
});

describe("createHoliday", () => {
  it("同一日付を2件登録しようとするとDuplicateHolidayDateErrorになる", async () => {
    await createTestHoliday(utc(2999, 8, 11));
    await expect(createTestHoliday(utc(2999, 8, 11))).rejects.toThrow(DuplicateHolidayDateError);
  });
});

describe("updateCompanyHoliday / deleteCompanyHoliday(カレンダーUI用、祝日保護)", () => {
  it("company_day_offの休日は更新できる", async () => {
    const holiday = await createTestHoliday(utc(2999, 8, 11), "company_day_off");
    const updated = await updateCompanyHoliday({ id: holiday.id, name: "更新後の名称" });
    expect(updated.name).toBe("更新後の名称");
  });

  it("national_holiday(祝日)のIDを渡すとHolidayNotFoundErrorになり、名称は変更されない(Codexレビューのmust-fix対応)", async () => {
    const holiday = await createTestHoliday(utc(2999, 8, 11), "national_holiday");
    await expect(
      updateCompanyHoliday({ id: holiday.id, name: "書き換えを試みる" }),
    ).rejects.toThrow(HolidayNotFoundError);

    const stillOriginal = await prisma.holiday.findUnique({ where: { id: holiday.id } });
    expect(stillOriginal?.name).toBe("テスト休日");
  });

  it("company_day_offの休日は削除できる", async () => {
    const holiday = await createTestHoliday(utc(2999, 8, 11), "company_day_off");
    await deleteCompanyHoliday(holiday.id);
    createdHolidayIds.length = 0;

    const found = await prisma.holiday.findUnique({ where: { id: holiday.id } });
    expect(found).toBeNull();
  });

  it("national_holiday(祝日)のIDを渡すとHolidayNotFoundErrorになり、削除されない(Codexレビューのmust-fix対応)", async () => {
    const holiday = await createTestHoliday(utc(2999, 8, 11), "national_holiday");
    await expect(deleteCompanyHoliday(holiday.id)).rejects.toThrow(HolidayNotFoundError);

    const stillExists = await prisma.holiday.findUnique({ where: { id: holiday.id } });
    expect(stillExists).not.toBeNull();
  });
});

describe("previewNationalHolidaySync / syncNationalHolidays", () => {
  it("新規・更新・スキップ(会社休日と重複)を正しく判定する", async () => {
    // 既存: 8/11は祝日として登録済み(名称更新の対象になる)、8/12は会社休日として登録済み(スキップ対象)
    await createTestHoliday(utc(2999, 8, 11), "national_holiday");
    await createTestHoliday(utc(2999, 8, 12), "company_day_off");

    vi.mocked(fetchNationalHolidays).mockResolvedValue([
      { date: utc(2999, 8, 11), name: "山の日(更新後名称)" },
      { date: utc(2999, 8, 12), name: "祝日データ由来の名称" },
      { date: utc(2999, 8, 13), name: "新規の祝日" },
    ]);

    const preview = await previewNationalHolidaySync();
    expect(preview.createCount).toBe(1);
    expect(preview.updateCount).toBe(1);
    expect(preview.skipCount).toBe(1);

    const outcome = await syncNationalHolidays();
    expect(outcome.created).toBe(1);
    expect(outcome.updated).toBe(1);
    expect(outcome.skipped).toBe(1);

    const updated = await prisma.holiday.findUnique({ where: { date: utc(2999, 8, 11) } });
    expect(updated?.name).toBe("山の日(更新後名称)");
    const skipped = await prisma.holiday.findUnique({ where: { date: utc(2999, 8, 12) } });
    expect(skipped?.name).toBe("テスト休日"); // 会社休日は上書きされない
    const created = await prisma.holiday.findUnique({ where: { date: utc(2999, 8, 13) } });
    expect(created?.name).toBe("新規の祝日");
    expect(created?.type).toBe("national_holiday");

    createdHolidayIds.push(created!.id);
  });
});

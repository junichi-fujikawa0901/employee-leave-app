import { describe, it, expect } from "vitest";

import { isValidExportFormat, parseExportDate } from "@/lib/leave/export-request";

describe("isValidExportFormat", () => {
  it("有効なformat値はtrueを返す", () => {
    expect(isValidExportFormat("excel")).toBe(true);
    expect(isValidExportFormat("csv-summary")).toBe(true);
    expect(isValidExportFormat("csv-grants")).toBe(true);
    expect(isValidExportFormat("csv-consumptions")).toBe(true);
  });

  it("不正な値・null・空文字はfalseを返す", () => {
    expect(isValidExportFormat("pdf")).toBe(false);
    expect(isValidExportFormat(null)).toBe(false);
    expect(isValidExportFormat("")).toBe(false);
  });
});

describe("parseExportDate", () => {
  it("YYYY-MM-DD形式を正しくパースする", () => {
    const date = parseExportDate("2026-07-23");
    expect(date).toEqual(new Date(Date.UTC(2026, 6, 23)));
  });

  it("nullや空文字はnullを返す", () => {
    expect(parseExportDate(null)).toBeNull();
    expect(parseExportDate("")).toBeNull();
  });

  it("YYYY-MM-DD以外の形式(スラッシュ区切り等)はnullを返す", () => {
    expect(parseExportDate("2026/07/23")).toBeNull();
    expect(parseExportDate("2026-7-23")).toBeNull();
  });

  it("存在しない暦日(2/31等)はDate.UTCの自動繰り上げを許さずnullを返す", () => {
    expect(parseExportDate("2026-02-31")).toBeNull();
  });

  it("うるう年でない年の2/29はnullを返す", () => {
    expect(parseExportDate("2026-02-29")).toBeNull();
  });

  it("うるう年の2/29は正しく受理する", () => {
    expect(parseExportDate("2028-02-29")).toEqual(new Date(Date.UTC(2028, 1, 29)));
  });
});

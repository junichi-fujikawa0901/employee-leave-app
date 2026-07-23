import { describe, it, expect } from "vitest";
import { NationalHolidayParseError, parseNationalHolidayCsv } from "@/lib/holidays/national-holiday-source";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("parseNationalHolidayCsv", () => {
  it("ヘッダー行をスキップし、日付・名称をパースする", () => {
    const csv = "国民の祝日・休日月日,国民の祝日・休日名称\n2026/1/1,元日\n2026/1/12,成人の日\n";
    const result = parseNationalHolidayCsv(csv);
    expect(result).toEqual([
      { date: utc(2026, 1, 1), name: "元日" },
      { date: utc(2026, 1, 12), name: "成人の日" },
    ]);
  });

  it("CRLF改行にも対応する", () => {
    const csv = "header1,header2\r\n2026/1/1,元日\r\n";
    const result = parseNationalHolidayCsv(csv);
    expect(result).toEqual([{ date: utc(2026, 1, 1), name: "元日" }]);
  });

  it("末尾の空行は無視する", () => {
    const csv = "header1,header2\n2026/1/1,元日\n\n";
    const result = parseNationalHolidayCsv(csv);
    expect(result).toEqual([{ date: utc(2026, 1, 1), name: "元日" }]);
  });

  it("データ行が1件もなければNationalHolidayParseErrorを投げる", () => {
    expect(() => parseNationalHolidayCsv("header1,header2\n")).toThrow(NationalHolidayParseError);
  });

  it("空文字列を渡した場合もNationalHolidayParseErrorを投げる", () => {
    expect(() => parseNationalHolidayCsv("")).toThrow(NationalHolidayParseError);
  });

  it("列数が不足する行があれば全体を拒否する", () => {
    const csv = "header1,header2\n2026/1/1,元日\n不正な行\n";
    expect(() => parseNationalHolidayCsv(csv)).toThrow(NationalHolidayParseError);
  });

  it("日付形式が不正な行があれば全体を拒否する", () => {
    const csv = "header1,header2\n2026-01-01,元日\n";
    expect(() => parseNationalHolidayCsv(csv)).toThrow(NationalHolidayParseError);
  });

  it("存在しない暦日(2/31等)はDate.UTCによる自動繰り上げを許さず拒否する", () => {
    const csv = "header1,header2\n2026/2/31,存在しない日\n";
    expect(() => parseNationalHolidayCsv(csv)).toThrow(NationalHolidayParseError);
  });

  it("うるう年の2/29は正しく受理する", () => {
    const csv = "header1,header2\n2028/2/29,うるう日\n";
    const result = parseNationalHolidayCsv(csv);
    expect(result).toEqual([{ date: utc(2028, 2, 29), name: "うるう日" }]);
  });

  it("うるう年でない年の2/29は拒否する", () => {
    const csv = "header1,header2\n2026/2/29,存在しない日\n";
    expect(() => parseNationalHolidayCsv(csv)).toThrow(NationalHolidayParseError);
  });

  it("2018年より前の行は不正データではなく対象外として除外する(エラーにはならない)", () => {
    const csv =
      "header1,header2\n2017/12/31,対象外\n2018/1/1,元日\n2026/1/1,元日(2026)\n";
    const result = parseNationalHolidayCsv(csv);
    expect(result).toEqual([
      { date: utc(2018, 1, 1), name: "元日" },
      { date: utc(2026, 1, 1), name: "元日(2026)" },
    ]);
  });

  it("2018年より前の行のみの場合は空配列を返す", () => {
    const csv = "header1,header2\n1955/1/1,元日\n2017/12/31,対象外\n";
    expect(parseNationalHolidayCsv(csv)).toEqual([]);
  });
});

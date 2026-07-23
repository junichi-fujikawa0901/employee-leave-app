const NATIONAL_HOLIDAY_CSV_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
/** 祝日データは年間20件強×数十年分でも数百KB程度のため、想定外の巨大レスポンスを弾く安全側の上限 */
const MAX_CSV_BYTES = 1024 * 1024;
/** 内閣府CSVは1955年分から収録されているが、休日マスタで管理する対象は2018年以降のみとする */
const MIN_HOLIDAY_YEAR = 2018;

export class NationalHolidayFetchError extends Error {}
export class NationalHolidayParseError extends Error {}

export interface ParsedNationalHoliday {
  date: Date;
  name: string;
}

/**
 * 内閣府CSV(1列目: 国民の祝日・休日月日 "YYYY/M/D"、2列目: 国民の祝日・休日名称、ヘッダー行あり)
 * をパースする。列数不一致・日付形式不正の行が1件でもあれば全体を拒否する
 * (部分的に壊れたデータを取り込まないため)。MIN_HOLIDAY_YEAR(2018年)より前の行は
 * 不正データとしてではなく、対象外として結果から除外する(全体拒否の対象にはしない)。
 */
export function parseNationalHolidayCsv(csvText: string): ParsedNationalHoliday[] {
  const lines = csvText.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new NationalHolidayParseError("祝日データの形式が不正です(データ行がありません)");
  }

  const [, ...dataLines] = lines;
  const results: ParsedNationalHoliday[] = [];
  for (const line of dataLines) {
    const columns = line.split(",");
    if (columns.length < 2) {
      throw new NationalHolidayParseError(`祝日データの形式が不正です: ${line}`);
    }
    const [dateText, name] = columns;
    const match = dateText.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!match) {
      throw new NationalHolidayParseError(`祝日データの日付形式が不正です: ${dateText}`);
    }
    const [, year, month, day] = match;
    const yearNum = Number(year);
    const monthNum = Number(month);
    const dayNum = Number(day);
    const date = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
    // Date.UTCは2/31のような存在しない暦日を3/3等に自動繰り上げてしまうため、
    // 構成要素を読み戻して入力値と一致するかを確認する(単なるgetTime()のNaNチェックでは検出できない)
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() !== yearNum ||
      date.getUTCMonth() !== monthNum - 1 ||
      date.getUTCDate() !== dayNum
    ) {
      throw new NationalHolidayParseError(`祝日データの日付が不正です: ${dateText}`);
    }
    if (yearNum < MIN_HOLIDAY_YEAR) {
      continue;
    }
    results.push({ date, name: name.trim() });
  }
  return results;
}

/** 内閣府サイトから祝日CSV(Shift_JIS)を取得しパースする */
export async function fetchNationalHolidays(): Promise<ParsedNationalHoliday[]> {
  let response: Response;
  try {
    response = await fetch(NATIONAL_HOLIDAY_CSV_URL);
  } catch {
    throw new NationalHolidayFetchError("祝日データの取得に失敗しました(通信エラー)");
  }
  if (!response.ok) {
    throw new NationalHolidayFetchError(`祝日データの取得に失敗しました(status: ${response.status})`);
  }
  // Content-Lengthが返る場合は全読み込み前に弾く(巨大レスポンスのメモリ消費を避ける)。
  // ヘッダーが無い/偽装されている場合の最終防御は読み込み後のbyteLengthチェックに委ねる
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CSV_BYTES) {
    throw new NationalHolidayFetchError("祝日データのサイズが想定を超えています");
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_CSV_BYTES) {
    throw new NationalHolidayFetchError("祝日データのサイズが想定を超えています");
  }
  const csvText = new TextDecoder("shift_jis").decode(buffer);
  return parseNationalHolidayCsv(csvText);
}

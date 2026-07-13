import { describe, it, expect } from "vitest";
import {
  isGrantActive,
  sortFefo,
  sumRemaining,
  planFefoConsumption,
  InsufficientBalanceError,
  type GrantBalanceInput,
} from "@/lib/leave/balance";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("isGrantActive", () => {
  it("expireDateとasOfがUTC 0時同士で一致する場合は有効(境界:含む。時刻付きの値だと単純な同日判定にはならない点に注意)", () => {
    expect(isGrantActive(utc(2025, 6, 30), utc(2025, 6, 30))).toBe(true);
  });

  it("expireDateがasOfの前日なら無効", () => {
    expect(isGrantActive(utc(2025, 6, 29), utc(2025, 6, 30))).toBe(false);
  });
});

describe("sortFefo", () => {
  it("失効日が異なる場合は失効日昇順になる", () => {
    const grants = [
      { id: "b", grantedDate: utc(2023, 1, 1), expireDate: utc(2025, 12, 31) },
      { id: "a", grantedDate: utc(2023, 1, 1), expireDate: utc(2024, 12, 31) },
    ];
    expect(sortFefo(grants).map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("失効日が同じ場合は付与日昇順になる", () => {
    const grants = [
      { id: "y", grantedDate: utc(2023, 6, 1), expireDate: utc(2025, 12, 31) },
      { id: "x", grantedDate: utc(2023, 1, 1), expireDate: utc(2025, 12, 31) },
    ];
    expect(sortFefo(grants).map((g) => g.id)).toEqual(["x", "y"]);
  });

  it("失効日・付与日が同じ場合はID昇順(localeCompare)になる", () => {
    const grants = [
      { id: "b", grantedDate: utc(2023, 1, 1), expireDate: utc(2025, 12, 31) },
      { id: "a", grantedDate: utc(2023, 1, 1), expireDate: utc(2025, 12, 31) },
    ];
    expect(sortFefo(grants).map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("元の配列を破壊しない", () => {
    const grants = [
      { id: "b", grantedDate: utc(2023, 1, 1), expireDate: utc(2025, 12, 31) },
      { id: "a", grantedDate: utc(2023, 1, 1), expireDate: utc(2024, 12, 31) },
    ];
    const original = [...grants];
    sortFefo(grants);
    expect(grants).toEqual(original);
  });
});

describe("sumRemaining", () => {
  it("残日数の単純合計を返す", () => {
    const grants: GrantBalanceInput[] = [
      { id: "a", grantedDate: utc(2023, 1, 1), expireDate: utc(2025, 1, 1), remainingDays: 3 },
      { id: "b", grantedDate: utc(2023, 1, 1), expireDate: utc(2025, 1, 1), remainingDays: 5.5 },
    ];
    expect(sumRemaining(grants)).toBe(8.5);
  });

  it("空配列なら0を返す", () => {
    expect(sumRemaining([])).toBe(0);
  });
});

describe("planFefoConsumption", () => {
  const grants: GrantBalanceInput[] = [
    { id: "g2", grantedDate: utc(2023, 7, 1), expireDate: utc(2025, 7, 1), remainingDays: 5 },
    { id: "g1", grantedDate: utc(2023, 1, 1), expireDate: utc(2024, 12, 31), remainingDays: 3 },
  ];

  it("複数枠にまたがって按分消化する(FEFO順=失効日が早いg1から)", () => {
    const plan = planFefoConsumption(grants, 6);
    expect(plan).toEqual([
      { grantId: "g1", consumedDays: 3 },
      { grantId: "g2", consumedDays: 3 },
    ]);
  });

  it("必要日数が1枠に収まる場合は先頭枠のみ消化する", () => {
    const plan = planFefoConsumption(grants, 2);
    expect(plan).toEqual([{ grantId: "g1", consumedDays: 2 }]);
  });

  it("remainingDaysが0以下の枠はスキップする", () => {
    const withZero: GrantBalanceInput[] = [
      { id: "zero", grantedDate: utc(2023, 1, 1), expireDate: utc(2024, 1, 1), remainingDays: 0 },
      { id: "live", grantedDate: utc(2023, 6, 1), expireDate: utc(2025, 1, 1), remainingDays: 5 },
    ];
    const plan = planFefoConsumption(withZero, 2);
    expect(plan).toEqual([{ grantId: "live", consumedDays: 2 }]);
  });

  it("残高不足の場合はInsufficientBalanceErrorをthrowする", () => {
    expect(() => planFefoConsumption(grants, 9)).toThrow(InsufficientBalanceError);
  });

  it("必要日数がちょうど合計残高と一致する場合は例外を投げず全枠を使い切る", () => {
    const plan = planFefoConsumption(grants, 8);
    expect(plan).toEqual([
      { grantId: "g1", consumedDays: 3 },
      { grantId: "g2", consumedDays: 5 },
    ]);
  });

  it("半休(0.5日)がFEFO順に複数枠へまたがって按分される", () => {
    const halfDayGrants: GrantBalanceInput[] = [
      { id: "g1", grantedDate: utc(2023, 1, 1), expireDate: utc(2024, 12, 31), remainingDays: 0.5 },
      { id: "g2", grantedDate: utc(2023, 7, 1), expireDate: utc(2025, 7, 1), remainingDays: 5 },
    ];
    const plan = planFefoConsumption(halfDayGrants, 1);
    expect(plan).toEqual([
      { grantId: "g1", consumedDays: 0.5 },
      { grantId: "g2", consumedDays: 0.5 },
    ]);
  });
});

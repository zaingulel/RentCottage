import { describe, expect, it } from "vitest";

import { fromPriceIqd } from "./from-price";
import type { PublicCottageInventoryUnit } from "./supabase-cottage-discovery";

function shift(
  serviceDay: string,
  position: number,
  priceIqd: number | null,
  available: boolean,
): PublicCottageInventoryUnit {
  return {
    serviceDay,
    kind: "shift",
    position,
    name: `Shift ${position}`,
    startTime: "09:00",
    endTime: "15:00",
    priceIqd,
    available,
  };
}

function fullDay(
  serviceDay: string,
  priceIqd: number | null,
  available: boolean,
): PublicCottageInventoryUnit {
  return {
    serviceDay,
    kind: "full-day",
    name: "Full day",
    startTime: "09:00",
    endTime: "23:00",
    priceIqd,
    available,
  };
}

describe("fromPriceIqd", () => {
  it("returns the lowest available shift price across every searched Service Day", () => {
    expect(
      fromPriceIqd([
        shift("2026-09-22", 1, 60000, true),
        shift("2026-09-22", 2, 45000, true),
        shift("2026-09-23", 1, 50000, true),
      ]),
    ).toBe(45000);
  });

  it("ignores a cheaper Full-Day Bundle, a cheaper unavailable shift and an unpriced shift", () => {
    expect(
      fromPriceIqd([
        fullDay("2026-09-22", 20000, true),
        shift("2026-09-22", 1, 30000, false),
        shift("2026-09-22", 2, null, true),
        shift("2026-09-23", 1, 70000, true),
        shift("2026-09-23", 2, 55000, true),
      ]),
    ).toBe(55000);
  });

  it("returns null when no available shift has a price", () => {
    expect(
      fromPriceIqd([
        fullDay("2026-09-22", 90000, true),
        shift("2026-09-22", 1, 40000, false),
        shift("2026-09-22", 2, null, true),
      ]),
    ).toBeNull();
  });
});

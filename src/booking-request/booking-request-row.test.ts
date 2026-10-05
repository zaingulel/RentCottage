import { describe, expect, it } from "vitest";

import {
  cloneBookingPeriod,
  isOffsetTimestamp,
  isTimestamp,
  rowObject,
} from "./booking-request-row";

describe("Booking Request row reader", () => {
  it("narrows a plain object and returns undefined for anything else", () => {
    const row = { a: 1 };

    expect(rowObject(row)).toBe(row);
    for (const value of [null, undefined, [], "text", 0, false]) {
      expect(rowObject(value)).toBeUndefined();
    }
  });

  it("accepts any timestamp Date.parse can read, with or without an offset", () => {
    for (const value of [
      "2099-08-24T18:00:00Z",
      "2099-08-24T18:00:00+03:00",
      "2099-08-24T18:00:00",
    ]) {
      expect(isTimestamp(value)).toBe(true);
    }
    for (const value of ["invalid", "", 0, null, undefined]) {
      expect(isTimestamp(value)).toBe(false);
    }
  });

  it("requires a time zone offset where the caller asks for one", () => {
    for (const value of ["2099-08-24T18:00:00Z", "2099-08-24T18:00:00+03:00"]) {
      expect(isOffsetTimestamp(value)).toBe(true);
    }
    for (const value of [
      "2099-08-24T18:00:00",
      "invalid",
      "invalidZ",
      0,
      null,
    ]) {
      expect(isOffsetTimestamp(value)).toBe(false);
    }
  });

  it("copies Booking Period items field by field and drops unknown fields", () => {
    const shift = {
      serviceDay: "2099-08-24",
      displayName: "Evening",
      startsAt: "2099-08-24T18:00:00+03:00",
      endsAt: "2099-08-25T02:00:00+03:00",
      crossesMidnight: true,
      priceIqd: 150_000,
      kind: "shift" as const,
      position: 3 as const,
      privateUnitId: "unit-shift",
    };
    const fullDay = {
      serviceDay: "2099-08-26",
      displayName: "Full day",
      startsAt: "2099-08-26T10:00:00+03:00",
      endsAt: "2099-08-26T22:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 250_000,
      kind: "full-day" as const,
      privateUnitId: "unit-full-day",
    };

    const cloned = cloneBookingPeriod([shift, fullDay]);

    expect(cloned).toEqual([
      {
        serviceDay: "2099-08-24",
        displayName: "Evening",
        startsAt: "2099-08-24T18:00:00+03:00",
        endsAt: "2099-08-25T02:00:00+03:00",
        crossesMidnight: true,
        priceIqd: 150_000,
        kind: "shift",
        position: 3,
      },
      {
        serviceDay: "2099-08-26",
        displayName: "Full day",
        startsAt: "2099-08-26T10:00:00+03:00",
        endsAt: "2099-08-26T22:00:00+03:00",
        crossesMidnight: false,
        priceIqd: 250_000,
        kind: "full-day",
      },
    ]);
    expect(cloned[0]).not.toBe(shift);
    expect(cloned[1]).not.toBe(fullDay);
  });
});

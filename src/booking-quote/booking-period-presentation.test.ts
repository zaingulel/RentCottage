import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicCottageInventoryUnit } from "@/cottage-discovery/supabase-cottage-discovery";

import type { BookingQuoteItem } from "./booking-quote";
import {
  bookingPeriodPresentationFrom,
  inventoryDayPresentation,
  inventoryAccessBounds,
  bookingPeriodAccessGaps,
} from "./booking-period-presentation";

const morning: BookingQuoteItem = {
  serviceDay: "2026-08-21",
  kind: "shift",
  position: 1,
  displayName: "Owner morning",
  startsAt: "2026-08-21T09:00:00+03:00",
  endsAt: "2026-08-21T15:00:00+03:00",
  crossesMidnight: false,
  priceIqd: 100_003,
};

const inventory: PublicCottageInventoryUnit[] = [
  {
    serviceDay: "2026-08-21",
    kind: "shift",
    position: 1,
    name: "Owner morning",
    startTime: "09:00",
    endTime: "15:00",
    priceIqd: 100_003,
    available: true,
  },
  {
    serviceDay: "2026-08-21",
    kind: "shift",
    position: 2,
    name: "Owner evening",
    startTime: "17:00",
    endTime: "23:00",
    priceIqd: 120_003,
    available: false,
  },
  {
    serviceDay: "2026-08-21",
    kind: "full-day",
    name: "Owner bundle",
    startTime: "09:00",
    endTime: "23:00",
    priceIqd: 200_000,
    available: false,
  },
];

afterEach(() => vi.unstubAllEnvs());

describe("Customer period presentation", () => {
  it("normalizes only supported retained markers", () => {
    const items = [morning];
    for (const marker of [undefined, null, "original-names"]) {
      expect(bookingPeriodPresentationFrom(marker, items)).toBe(
        "original-names",
      );
    }
    expect(bookingPeriodPresentationFrom("morning-evening-v1", items)).toBe(
      "morning-evening-v1",
    );
    for (const marker of [
      "",
      "morning-evening-v2",
      1,
      true,
      false,
      {},
      [],
      { periodPresentation: "original-names" },
    ]) {
      expect(bookingPeriodPresentationFrom(marker, items)).toBeUndefined();
    }
    const historicalItems: BookingQuoteItem[] = [
      { ...morning, position: 3, displayName: "Original third shift" },
    ];
    expect(
      bookingPeriodPresentationFrom("morning-evening-v1", historicalItems),
    ).toBeUndefined();
    expect(bookingPeriodPresentationFrom(null, historicalItems)).toBe(
      "original-names",
    );
    expect(
      bookingPeriodPresentationFrom("original-names", historicalItems),
    ).toBe("original-names");
    expect(items).toEqual([morning]);
  });

  it("recognizes only complete current two-shift inventory", () => {
    expect(inventoryDayPresentation(inventory)).toBe("morning-evening-v1");
    expect(inventoryDayPresentation([...inventory].reverse())).toBe(
      "morning-evening-v1",
    );
    for (const incomplete of [
      [],
      inventory.slice(0, 1),
      inventory.slice(0, 2),
      inventory.slice(1),
      [inventory[0], inventory[0], inventory[2]],
      [
        inventory[0],
        { ...inventory[1], serviceDay: "2026-08-22" },
        inventory[2],
      ],
    ]) {
      expect(inventoryDayPresentation(incomplete)).toBe("original-names");
    }
    expect(
      inventoryDayPresentation([
        inventory[0],
        inventory[1],
        {
          ...inventory[1],
          position: 3,
          name: "Original night",
          startTime: "23:00",
          endTime: "02:00",
        },
        { ...inventory[2], endTime: "02:00" },
      ]),
    ).toBe("original-names");
  });

  it("dates overnight and equal-endpoint bundle access in Iraq", () => {
    for (const timezone of ["UTC", "Pacific/Honolulu", "Pacific/Kiritimati"]) {
      vi.stubEnv("TZ", timezone);
      expect(inventoryAccessBounds(inventory[0])).toEqual({
        startsAt: "2026-08-21T09:00:00+03:00",
        endsAt: "2026-08-21T15:00:00+03:00",
        crossesMidnight: false,
      });
      expect(
        inventoryAccessBounds({
          ...inventory[1],
          startTime: "20:00",
          endTime: "02:00",
        }),
      ).toEqual({
        startsAt: "2026-08-21T20:00:00+03:00",
        endsAt: "2026-08-22T02:00:00+03:00",
        crossesMidnight: true,
      });
      expect(
        inventoryAccessBounds({
          ...inventory[2],
          startTime: "09:00",
          endTime: "09:00",
        }),
      ).toEqual({
        startsAt: "2026-08-21T09:00:00+03:00",
        endsAt: "2026-08-22T09:00:00+03:00",
        crossesMidnight: true,
      });
      expect(
        inventoryAccessBounds({
          ...inventory[2],
          serviceDay: "2026-12-31",
          startTime: "09:00",
          endTime: "09:00",
        }),
      ).toEqual({
        startsAt: "2026-12-31T09:00:00+03:00",
        endsAt: "2027-01-01T09:00:00+03:00",
        crossesMidnight: true,
      });
      expect(
        inventoryAccessBounds({
          ...inventory[1],
          serviceDay: "2028-02-29",
          startTime: "20:00",
          endTime: "02:00",
        }),
      ).toEqual({
        startsAt: "2028-02-29T20:00:00+03:00",
        endsAt: "2028-03-01T02:00:00+03:00",
        crossesMidnight: true,
      });
    }
  });

  it("shows only uncovered gaps between purchased access ranges", () => {
    const evening: BookingQuoteItem = {
      ...morning,
      position: 2,
      displayName: "Owner evening",
      startsAt: "2026-08-21T17:00:00+03:00",
      endsAt: "2026-08-21T23:00:00+03:00",
    };
    const bundle: BookingQuoteItem = {
      serviceDay: "2026-08-21",
      kind: "full-day",
      displayName: "Owner bundle",
      startsAt: "2026-08-21T08:00:00+03:00",
      endsAt: "2026-08-21T23:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 200_000,
    };
    const nextBundle: BookingQuoteItem = {
      ...bundle,
      serviceDay: "2026-08-22",
      startsAt: "2026-08-22T08:00:00+03:00",
      endsAt: "2026-08-22T23:00:00+03:00",
    };
    expect(bookingPeriodAccessGaps([evening, morning])).toEqual([
      {
        startsAt: "2026-08-21T15:00:00+03:00",
        endsAt: "2026-08-21T17:00:00+03:00",
      },
    ]);
    expect(
      bookingPeriodAccessGaps([
        morning,
        { ...evening, startsAt: "2026-08-21T15:00:00+03:00" },
      ]),
    ).toEqual([]);
    expect(
      bookingPeriodAccessGaps([
        morning,
        { ...evening, startsAt: "2026-08-21T14:00:00+03:00" },
      ]),
    ).toEqual([]);
    expect(bookingPeriodAccessGaps([morning])).toEqual([]);
    expect(bookingPeriodAccessGaps([])).toEqual([]);
    expect(bookingPeriodAccessGaps([nextBundle, bundle])).toEqual([]);
    expect(
      bookingPeriodAccessGaps([
        bundle,
        {
          ...nextBundle,
          serviceDay: "2026-08-23",
          startsAt: "2026-08-23T08:00:00+03:00",
          endsAt: "2026-08-23T23:00:00+03:00",
        },
      ]),
    ).toEqual([
      {
        startsAt: "2026-08-21T23:00:00+03:00",
        endsAt: "2026-08-23T08:00:00+03:00",
      },
    ]);
    const mixed: BookingQuoteItem[] = [
      {
        ...evening,
        startsAt: "2026-08-21T20:00:00+03:00",
        endsAt: "2026-08-22T02:00:00+03:00",
        crossesMidnight: true,
      },
      {
        ...morning,
        serviceDay: "2026-08-22",
        startsAt: "2026-08-22T09:00:00+03:00",
        endsAt: "2026-08-22T15:00:00+03:00",
      },
    ];
    expect(bookingPeriodAccessGaps(mixed)).toEqual([
      {
        startsAt: "2026-08-22T02:00:00+03:00",
        endsAt: "2026-08-22T09:00:00+03:00",
      },
    ]);
    expect(
      bookingPeriodAccessGaps([bundle, morning, evening, nextBundle]),
    ).toEqual([]);
    expect(mixed[0].endsAt).toBe("2026-08-22T02:00:00+03:00");
    expect(nextBundle.startsAt).toBe("2026-08-22T08:00:00+03:00");
  });
});

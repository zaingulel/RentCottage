import { describe, expect, it } from "vitest";

import {
  hasCompleteCottageBookingSelection,
  parseCottageDiscoveryQuery,
  parseCottageResultsQuery,
  preserveRawCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
  serializeCottageResultsQuery,
} from "./discovery-query";

describe("Cottage discovery query", () => {
  it("parses and canonically serializes consecutive Service Days with multiple shifts", () => {
    const parsed = parseCottageDiscoveryQuery({
      from: "2026-08-21",
      to: "2026-08-22",
      selection: [
        "2026-08-21:shift:1",
        "2026-08-21:shift:3",
        "2026-08-22:full-day",
      ],
      guests: "6",
      governorate: "Baghdad",
      area: "Abu Ghraib",
      amenity: ["pool", "wifi"],
    });

    expect(parsed).toEqual({
      status: "loaded",
      query: {
        from: "2026-08-21",
        to: "2026-08-22",
        selections: [
          { serviceDay: "2026-08-21", kind: "shift", position: 1 },
          { serviceDay: "2026-08-21", kind: "shift", position: 3 },
          { serviceDay: "2026-08-22", kind: "full-day" },
        ],
        guests: 6,
        governorate: "Baghdad",
        area: "Abu Ghraib",
        amenities: ["pool", "wifi"],
      },
    });
    if (parsed.status !== "loaded") throw new Error("expected loaded query");

    expect(serializeCottageDiscoveryQuery(parsed.query)).toBe(
      "from=2026-08-21&to=2026-08-22&selection=2026-08-21%3Ashift%3A1&selection=2026-08-21%3Ashift%3A3&selection=2026-08-22%3Afull-day&guests=6&governorate=Baghdad&area=Abu+Ghraib&amenity=pool&amenity=wifi",
    );
  });

  it("accepts empty and partial discovery selections while requiring complete booking selections", () => {
    const base = { from: "2030-01-12", to: "2030-01-13", guests: "4" };
    for (const selection of [undefined, [], ["2030-01-12:shift:1"]]) {
      const parsed = parseCottageDiscoveryQuery({ ...base, selection });
      expect(parsed.status).toBe("loaded");
      if (parsed.status !== "loaded") throw new Error("expected loaded query");
      expect(parsed.query.selections).toEqual(
        selection?.length
          ? [{ serviceDay: "2030-01-12", kind: "shift", position: 1 }]
          : [],
      );
      expect(hasCompleteCottageBookingSelection(parsed.query)).toBe(false);
    }
    const complete = parseCottageDiscoveryQuery({
      ...base,
      selection: ["2030-01-12:shift:1", "2030-01-13:full-day"],
    });
    if (complete.status !== "loaded")
      throw new Error("expected complete query");
    expect(hasCompleteCottageBookingSelection(complete.query)).toBe(true);
    for (const key of ["from", "to", "guests", "governorate", "area"]) {
      expect(
        parseCottageDiscoveryQuery({ ...base, [key]: ["first", "second"] }),
      ).toEqual({ status: "invalid" });
    }
  });

  it.each([
    {
      from: "2026-08-21",
      to: "2026-08-22",
      selection: ["2026-08-21:shift:1", "2026-08-23:shift:1"],
    },
    {
      from: "2026-08-21",
      to: "2026-08-21",
      selection: ["2026-08-21:shift:1", "2026-08-21:shift:1"],
    },
    {
      from: "2026-08-21",
      to: "2026-08-21",
      selection: ["2026-08-21:full-day", "2026-08-21:shift:2"],
    },
    {
      from: "2026-08-21",
      to: "2026-08-21",
      selection: ["2026-08-21:shift:4"],
    },
    {
      from: "2026-08-21",
      to: "2026-08-21",
      selection: ["2026-08-21:shift:1"],
      amenity: ["hot_tub"],
    },
    {
      from: "2026-08-21",
      to: "2027-09-26",
      selection: ["2026-08-21:shift:1", "2027-09-26:shift:1"],
    },
  ])("rejects malformed or internally inconsistent input %#", (input) => {
    expect(parseCottageDiscoveryQuery({ ...input, guests: "2" })).toEqual({
      status: "invalid",
    });
  });

  it("rejects unknown query keys instead of silently changing their meaning", () => {
    expect(
      parseCottageDiscoveryQuery({
        from: "2026-08-21",
        to: "2026-08-21",
        selection: "2026-08-21:shift:1",
        guests: "2",
        exactAddress: "private",
      }),
    ).toEqual({ status: "invalid" });
  });

  it("uses the approved governorate and approximate-location field contracts", () => {
    const base = {
      from: "2026-08-21",
      to: "2026-08-21",
      selection: "2026-08-21:shift:1",
      guests: "2",
    };
    const ordinaryApprovedArea = "ناحية/قرب النهر: القسم #2";
    expect(
      parseCottageDiscoveryQuery({
        ...base,
        governorate: "  بغداد  ",
        area: ordinaryApprovedArea,
      }),
    ).toEqual({
      status: "loaded",
      query: expect.objectContaining({
        governorate: "بغداد",
        area: ordinaryApprovedArea,
      }),
    });
    expect(
      parseCottageDiscoveryQuery({ ...base, governorate: "g".repeat(121) }),
    ).toEqual({ status: "invalid" });
    expect(
      parseCottageDiscoveryQuery({ ...base, area: "a".repeat(240) }),
    ).toEqual({
      status: "loaded",
      query: expect.objectContaining({ area: "a".repeat(240) }),
    });
    expect(
      parseCottageDiscoveryQuery({ ...base, area: "a".repeat(241) }),
    ).toEqual({ status: "invalid" });
  });

  it("preserves repeated raw values for localized invalid-query links", () => {
    expect(
      preserveRawCottageDiscoveryQuery({
        selection: ["2026-08-21:shift:1", "2026-08-21:shift:2"],
        ignored: undefined,
      }),
    ).toBe("selection=2026-08-21%3Ashift%3A1&selection=2026-08-21%3Ashift%3A2");
  });

  it("accepts a continuation on the results query only and serializes it after the search", () => {
    const after = "cottage-0123456789abcdef0123456789abcdef";
    const search = {
      from: "2026-08-21",
      to: "2026-08-21",
      selection: "2026-08-21:shift:2",
      guests: "4",
      amenity: "wifi",
    };
    const continued = parseCottageResultsQuery({ ...search, after });
    expect(continued).toEqual({
      status: "loaded",
      query: {
        from: "2026-08-21",
        to: "2026-08-21",
        selections: [{ serviceDay: "2026-08-21", kind: "shift", position: 2 }],
        guests: 4,
        amenities: ["wifi"],
      },
      after,
    });
    expect(parseCottageResultsQuery(search)).toEqual({
      status: "loaded",
      query: expect.objectContaining({ guests: 4 }),
      after: null,
    });
    expect(parseCottageDiscoveryQuery({ ...search, after })).toEqual({
      status: "invalid",
    });
    if (continued.status !== "loaded") throw new Error("expected loaded query");

    expect(serializeCottageResultsQuery(continued.query, after)).toBe(
      "from=2026-08-21&to=2026-08-21&selection=2026-08-21%3Ashift%3A2&guests=4&amenity=wifi&after=cottage-0123456789abcdef0123456789abcdef",
    );
    expect(serializeCottageResultsQuery(continued.query, null)).toBe(
      "from=2026-08-21&to=2026-08-21&selection=2026-08-21%3Ashift%3A2&guests=4&amenity=wifi",
    );
  });

  it("rejects a malformed, empty or repeated continuation", () => {
    const search = {
      from: "2026-08-21",
      to: "2026-08-21",
      selection: "2026-08-21:shift:2",
      guests: "4",
    };
    const valid = "cottage-0123456789abcdef0123456789abcdef";
    for (const after of [
      "",
      "cottage-0123456789abcdef0123456789abcde",
      "cottage-0123456789abcdef0123456789abcdef0",
      "cottage-0123456789ABCDEF0123456789ABCDEF",
      "cottage-0123456789abcdef0123456789abcdeg",
      "river-house",
      ` ${valid}`,
      [valid],
      [valid, valid],
      [valid, "cottage-fedcba9876543210fedcba9876543210"],
    ]) {
      expect(parseCottageResultsQuery({ ...search, after })).toEqual({
        status: "invalid",
      });
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  parseCottageDiscoveryQuery,
  preserveRawCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
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

  it.each([
    { from: "2026-08-21", to: "2026-08-21", selection: [] },
    {
      from: "2026-08-21",
      to: "2026-08-22",
      selection: ["2026-08-21:shift:1"],
    },
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
});

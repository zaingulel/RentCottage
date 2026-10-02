import { describe, expect, it } from "vitest";

import {
  readExactPoint,
  readsAsCoordinatePair,
  type ExactPointReading,
} from "./exact-point";

const shaqlawa = { latitude: 36.408333, longitude: 44.385834 };
const unreadable = { kind: "unreadable" } as const;
const outsideBounds = { kind: "outside-bounds" } as const;

const readings: [string, string, string, ExactPointReading][] = [
  ["two empty boxes", "", "  ", { kind: "empty" }],
  [
    "a pair in two boxes",
    "36.408333",
    "44.385834",
    { kind: "valid", point: shaqlawa },
  ],
  [
    "a comma-separated pair pasted into the latitude box",
    "36.408333, 44.385834",
    "",
    { kind: "valid", point: shaqlawa },
  ],
  [
    "a space-separated pair pasted into the latitude box",
    " 36.408333 44.385834 ",
    "",
    { kind: "valid", point: shaqlawa },
  ],
  [
    "Arabic-Indic digits",
    "٣٦.٤٠٨٣٣٣",
    "٤٤.٣٨٥٨٣٤",
    { kind: "valid", point: shaqlawa },
  ],
  [
    "Persian digits",
    "۳۶.۴۰۸۳۳۳",
    "۴۴.۳۸۵۸۳۴",
    { kind: "valid", point: shaqlawa },
  ],
  [
    "the Arabic decimal mark and the Arabic comma",
    "٣٦٫٤٠٨٣٣٣، ٤٤٫٣٨٥٨٣٤",
    "",
    { kind: "valid", point: shaqlawa },
  ],
  [
    "more than six decimals",
    "36.4083334",
    "44.3858336",
    { kind: "valid", point: shaqlawa },
  ],
  [
    "the lowest supported corner",
    "29.0",
    "38.7",
    { kind: "valid", point: { latitude: 29.0, longitude: 38.7 } },
  ],
  [
    "the highest supported corner",
    "37.4",
    "49.2",
    { kind: "valid", point: { latitude: 37.4, longitude: 49.2 } },
  ],
  [
    "a reversed pair in two boxes",
    "44.385834",
    "36.408333",
    { kind: "swapped", corrected: shaqlawa },
  ],
  [
    "a reversed pair pasted into the latitude box",
    "44.385834, 36.408333",
    "",
    { kind: "swapped", corrected: shaqlawa },
  ],
  ["a point far outside the bounds", "51.507351", "-0.127758", outsideBounds],
  ["a latitude just below the bounds", "28.999999", "38.7", outsideBounds],
  ["a latitude just above the bounds", "37.400001", "49.2", outsideBounds],
  ["a longitude just below the bounds", "29.0", "38.699999", outsideBounds],
  ["a longitude just above the bounds", "37.4", "49.200001", outsideBounds],
  ["only a latitude", "36.408333", "", { kind: "incomplete" }],
  ["only a longitude", "", "44.385834", { kind: "incomplete" }],
  [
    "degrees, minutes and seconds",
    "36°24'30.0\"N 44°23'09.0\"E",
    "",
    unreadable,
  ],
  [
    "a map link",
    "https://maps.google.com/?q=36.408333,44.385834",
    "",
    unreadable,
  ],
  ["a Plus Code", "8H8MC95P+8H", "", unreadable],
  ["NaN", "NaN", "NaN", unreadable],
  ["exponent notation", "1e3", "44.385834", unreadable],
  ["an over-long number", `36.${"4".repeat(400)}`, "44.385834", unreadable],
  ["a pair and a longitude", "36.408333, 44.385834", "44.385834", unreadable],
];

describe("readExactPoint", () => {
  it.each(readings)(
    "reads %s",
    (_name, latitudeText, longitudeText, reading) => {
      expect(readExactPoint(latitudeText, longitudeText)).toEqual(reading);
    },
  );
});

describe("readsAsCoordinatePair", () => {
  it.each(["36.408333, 44.385834", "٣٦.٤٠٨٣٣٣, ٤٤.٣٨٥٨٣٤"])(
    "reads %s as a coordinate pair",
    (text) => {
      expect(readsAsCoordinatePair(text)).toBe(true);
    },
  );

  it.each(["Shaqlawa countryside", "44"])(
    "does not read %s as a coordinate pair",
    (text) => {
      expect(readsAsCoordinatePair(text)).toBe(false);
    },
  );
});

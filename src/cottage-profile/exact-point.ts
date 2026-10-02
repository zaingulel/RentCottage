export type ExactPoint = { latitude: number; longitude: number };

export const supportedCoordinateBounds = {
  latitude: { minimum: 29.0, maximum: 37.4 },
  longitude: { minimum: 38.7, maximum: 49.2 },
} as const;

export type ExactPointReading =
  | { kind: "empty" }
  | { kind: "valid"; point: ExactPoint }
  | { kind: "swapped"; corrected: ExactPoint }
  | { kind: "outside-bounds" }
  | { kind: "incomplete" }
  | { kind: "unreadable" };

// One decimal-degrees number, or two separated by a comma or whitespace.
const coordinatePattern =
  /^([+-]?\d{1,3}(?:\.\d{1,15})?)(?:(?:\s*[,،]\s*|\s+)([+-]?\d{1,3}(?:\.\d{1,15})?))?$/;

// A whole text that is two decimal numbers, whatever their values, punctuation or precision.
const bareCoordinatePairPattern =
  /^(?:[([]\s*)?[+-]?\d+(?:\.\d+)?(?:\s*°)?(?:\s*[,،;/|]\s*|\s+)[+-]?\d+(?:\.\d+)?(?:\s*°)?(?:\s*[)\]])?(?:\s*\.)?$/;

function normalised(text: string): string {
  return text
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replaceAll("٫", ".")
    .trim();
}

function sixDecimals(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function within(
  value: number,
  range: { minimum: number; maximum: number },
): boolean {
  return value >= range.minimum && value <= range.maximum;
}

export function readExactPoint(
  latitudeText: string,
  longitudeText: string,
): ExactPointReading {
  const latitudeBox = normalised(latitudeText);
  const longitudeBox = normalised(longitudeText);
  if (latitudeBox === "" && longitudeBox === "") return { kind: "empty" };

  const latitudeMatch = coordinatePattern.exec(latitudeBox);
  const longitudeMatch = coordinatePattern.exec(longitudeBox);
  let pair: [string, string];
  if (longitudeBox === "") {
    if (!latitudeMatch) return { kind: "unreadable" };
    if (latitudeMatch[2] === undefined) return { kind: "incomplete" };
    pair = [latitudeMatch[1], latitudeMatch[2]];
  } else if (latitudeBox === "") {
    return longitudeMatch && longitudeMatch[2] === undefined
      ? { kind: "incomplete" }
      : { kind: "unreadable" };
  } else {
    if (
      !latitudeMatch ||
      !longitudeMatch ||
      latitudeMatch[2] !== undefined ||
      longitudeMatch[2] !== undefined
    ) {
      return { kind: "unreadable" };
    }
    pair = [latitudeMatch[1], longitudeMatch[1]];
  }

  // The bounds judge the number as entered: rounding first would pull a value just outside inward.
  const first = Number(pair[0]);
  const second = Number(pair[1]);
  const { latitude, longitude } = supportedCoordinateBounds;
  if (within(first, latitude) && within(second, longitude)) {
    return {
      kind: "valid",
      point: { latitude: sixDecimals(first), longitude: sixDecimals(second) },
    };
  }
  if (within(first, longitude) && within(second, latitude)) {
    return {
      kind: "swapped",
      corrected: {
        latitude: sixDecimals(second),
        longitude: sixDecimals(first),
      },
    };
  }
  return { kind: "outside-bounds" };
}

export function readsAsCoordinatePair(text: string): boolean {
  return bareCoordinatePairPattern.test(normalised(text));
}

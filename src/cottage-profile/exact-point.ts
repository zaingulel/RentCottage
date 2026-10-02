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

function normalised(text: string): string {
  return text
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replaceAll("٫", ".")
    .trim();
}

function sixDecimals(value: string): number {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
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

  const first = sixDecimals(pair[0]);
  const second = sixDecimals(pair[1]);
  const { latitude, longitude } = supportedCoordinateBounds;
  if (within(first, latitude) && within(second, longitude)) {
    return { kind: "valid", point: { latitude: first, longitude: second } };
  }
  if (within(first, longitude) && within(second, latitude)) {
    return {
      kind: "swapped",
      corrected: { latitude: second, longitude: first },
    };
  }
  return { kind: "outside-bounds" };
}

export function readsAsCoordinatePair(text: string): boolean {
  const { kind } = readExactPoint(text, "");
  return kind === "valid" || kind === "swapped" || kind === "outside-bounds";
}

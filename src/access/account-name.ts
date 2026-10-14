import { isContactProtectedTextSafe } from "@/content/contact-protection";

const maximumCodePoints = 50;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function parseAccountName(
  value: unknown,
): { firstName: string; initial: string } | undefined {
  if (typeof value !== "string") return undefined;
  const firstName = value.trim();
  const length = Array.from(firstName).length;
  if (
    length === 0 ||
    length > maximumCodePoints ||
    /\p{Cc}/u.test(firstName) ||
    !isContactProtectedTextSafe(firstName)
  )
    return undefined;
  for (const { segment } of graphemes.segment(firstName)) {
    if (/\p{L}/u.test(segment))
      return { firstName, initial: segment.toUpperCase() };
  }
  return undefined;
}

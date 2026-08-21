const digitCharacters = /[0-9\u0660-\u0669\u06f0-\u06f9]/gu;
const defaultIgnorableCharacters = /\p{Default_Ignorable_Code_Point}/gu;
const phoneSeparators = /^[\s()[\]{}+./\-\p{Dash_Punctuation}\u2212]*$/u;
const email = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;
const link =
  /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|me|io|co|iq)\b)/iu;
const socialHandle =
  /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_][\p{L}\p{N}_.-]{1,31}\b/iu;
const socialPlatform =
  /\b(?:whats?app|telegram|instagram|facebook|snapchat|tiktok)\b/iu;

const numberWords = new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "صفر",
  "واحد",
  "اثنان",
  "اثنين",
  "ثلاثة",
  "اربعة",
  "أربعة",
  "خمسة",
  "ستة",
  "سبعة",
  "ثمانية",
  "تسعة",
  "سفر",
  "یەک",
  "یەك",
  "دوو",
  "سێ",
  "چوار",
  "پێنج",
  "شەش",
  "حەوت",
  "هەشت",
  "نۆ",
]);
const atWords = new Set(["at", "ات", "آت", "ئەت"]);
const dotWords = new Set(["dot", "دوت", "نقطة", "دۆت"]);
const recognizedTopLevelDomains = new Set(["com", "net", "org", "iq"]);

function words(value: string): string[] {
  return (
    normalizeContactText(value)
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}_-]+/gu) ?? []
  );
}

function normalizeContactText(value: string): string {
  return value.normalize("NFKC").replace(defaultIgnorableCharacters, "");
}

function containsWordObfuscatedNumber(value: string): boolean {
  let consecutiveNumberWords = 0;
  for (const word of words(value)) {
    consecutiveNumberWords = numberWords.has(word)
      ? consecutiveNumberWords + 1
      : 0;
    if (consecutiveNumberWords >= 7) return true;
  }
  return false;
}

function containsWordObfuscatedEmail(value: string): boolean {
  const tokens = words(value);
  for (let index = 1; index + 3 < tokens.length; index += 1) {
    if (
      atWords.has(tokens[index] ?? "") &&
      dotWords.has(tokens[index + 2] ?? "") &&
      recognizedTopLevelDomains.has(tokens[index + 3] ?? "") &&
      (tokens[index - 1]?.length ?? 0) > 0 &&
      (tokens[index + 1]?.length ?? 0) > 0
    ) {
      return true;
    }
  }
  return false;
}

function containsPhoneLikeNumber(value: string): boolean {
  const matches = [...value.matchAll(digitCharacters)];
  for (let start = 0; start < matches.length; start += 1) {
    for (let end = start + 6; end < matches.length; end += 1) {
      const left = matches[start];
      const right = matches[end];
      if (
        !left ||
        !right ||
        left.index === undefined ||
        right.index === undefined
      )
        continue;
      const candidate = value.slice(left.index, right.index + right[0].length);
      if (phoneSeparators.test(candidate.replace(digitCharacters, ""))) {
        return true;
      }
    }
  }
  return false;
}

export function isContactSafeBookingRequestText(value: string): boolean {
  const normalizedValue = normalizeContactText(value);
  return !(
    containsPhoneLikeNumber(normalizedValue) ||
    containsWordObfuscatedNumber(normalizedValue) ||
    containsWordObfuscatedEmail(normalizedValue) ||
    email.test(normalizedValue) ||
    link.test(normalizedValue) ||
    socialHandle.test(normalizedValue) ||
    socialPlatform.test(normalizedValue)
  );
}

const defaultIgnorableCharacters = /\p{Default_Ignorable_Code_Point}/gu;
const email = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;
const spacedSymbolEmail = /[^\s@.]+\s*@\s*[^\s@.]+\s*\.\s*\p{L}{2,63}\b/iu;
const link =
  /(?:https?:\/\/|www\.|\b[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.\p{L}{2,63}\b)/iu;
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
const domainLabel = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;
const topLevelDomain = /^\p{L}{2,63}$/u;

function words(value: string): string[] {
  return (
    normalizeContactText(value)
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}_-]+/gu) ?? []
  );
}

function collapsedLetterRuns(value: string): string[] {
  const tokens = words(value);
  const collapsed: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!/^\p{L}$/u.test(token)) {
      collapsed.push(token);
      continue;
    }
    let run = token;
    while (/^\p{L}$/u.test(tokens[index + 1] ?? "")) {
      run += tokens[index + 1];
      index += 1;
    }
    collapsed.push(run);
  }
  return collapsed;
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
  const tokens = collapsedLetterRuns(value);
  for (let index = 1; index + 3 < tokens.length; index += 1) {
    if (
      atWords.has(tokens[index] ?? "") &&
      dotWords.has(tokens[index + 2] ?? "") &&
      topLevelDomain.test(tokens[index + 3] ?? "") &&
      domainLabel.test(tokens[index - 1] ?? "") &&
      domainLabel.test(tokens[index + 1] ?? "")
    ) {
      return true;
    }
  }
  return false;
}

function containsWordObfuscatedLink(value: string): boolean {
  const tokens = collapsedLetterRuns(value);
  for (let index = 1; index + 1 < tokens.length; index += 1) {
    if (
      dotWords.has(tokens[index] ?? "") &&
      domainLabel.test(tokens[index - 1] ?? "") &&
      topLevelDomain.test(tokens[index + 1] ?? "")
    ) {
      return true;
    }
  }
  return false;
}

function containsPhoneLikeNumber(value: string): boolean {
  return (value.match(/\p{Decimal_Number}/gu)?.length ?? 0) >= 7;
}

export function isContactSafeBookingRequestText(value: string): boolean {
  const normalizedValue = normalizeContactText(value);
  return !(
    containsPhoneLikeNumber(normalizedValue) ||
    containsWordObfuscatedNumber(normalizedValue) ||
    containsWordObfuscatedEmail(normalizedValue) ||
    containsWordObfuscatedLink(normalizedValue) ||
    email.test(normalizedValue) ||
    spacedSymbolEmail.test(normalizedValue) ||
    link.test(normalizedValue) ||
    socialHandle.test(normalizedValue) ||
    socialPlatform.test(normalizedValue)
  );
}

import type { Locale } from "./routing";

const iraqIntlLocales: Record<Exclude<Locale, "ckb">, string> = {
  ar: "ar-IQ-u-nu-latn",
  en: "en-IQ",
};

// Chromium and the Cloudflare Worker runtime carry no Sorani (ckb) locale data
// and silently fall back to another locale, so Sorani is built from en-US
// output and the CLDR ckb tables below. en-US is available in every runtime.
const soraniMonths = [
  "کانوونی دووەم",
  "شوبات",
  "ئازار",
  "نیسان",
  "ئایار",
  "حوزەیران",
  "تەمووز",
  "ئاب",
  "ئەیلوول",
  "تشرینی یەکەم",
  "تشرینی دووەم",
  "کانونی یەکەم",
];

const soraniWeekdays = [
  "یەکشەممە",
  "دووشەممە",
  "سێشەممە",
  "چوارشەممە",
  "پێنجشەممە",
  "ھەینی",
  "شەممە",
];

const soraniSymbols: Record<string, string> = {
  ",": "\u066c",
  ".": "\u066b",
};

function toSoraniNumerals(western: string): string {
  return western
    .replace(/^-/, "\u200f-")
    .replace(/[0-9,.]/g, (character) =>
      /[0-9]/.test(character)
        ? String.fromCharCode(0x0660 + Number(character))
        : soraniSymbols[character]!,
    );
}

export function formatIqd(amount: number, locale: Locale): string {
  return `IQD ${formatInteger(amount, locale)}`;
}

export function formatFilsAsIqd(amountFils: number, locale: Locale): string {
  if (!Number.isSafeInteger(amountFils))
    throw new Error("Money must be exact integer fils");
  const fils = BigInt(amountFils);
  const magnitude = fils < 0n ? -fils : fils;
  const whole = magnitude / 1000n;
  const fraction = (magnitude % 1000n)
    .toString()
    .padStart(3, "0")
    .replace(/0+$/, "");
  const formattedWhole = formatGroupedInteger(
    fils < 0n ? (whole === 0n ? -0 : -whole) : whole,
    locale,
  );
  if (!fraction) return `IQD ${formattedWhole}`;
  const decimal =
    locale === "ckb"
      ? toSoraniNumerals(".")
      : new Intl.NumberFormat(iraqIntlLocales[locale])
          .formatToParts(1.1)
          .find((part) => part.type === "decimal")!.value;
  const localizedFraction = [...fraction]
    .map((digit) => formatInteger(Number(digit), locale))
    .join("");
  return `IQD ${formattedWhole}${decimal}${localizedFraction}`;
}

function formatSoraniIraqDateTime(value: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Baghdad",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h12",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  const month = soraniMonths[Number(parts.month) - 1];
  const period = parts.dayPeriod === "AM" ? "ب.ن" : "د.ن";
  return `${toSoraniNumerals(parts.year)} ${month} ${toSoraniNumerals(parts.day)} ${toSoraniNumerals(parts.hour)}:${toSoraniNumerals(parts.minute)} ${period}`;
}

export function formatIraqDateTime(value: string, locale: Locale): string {
  if (locale === "ckb") return formatSoraniIraqDateTime(value);
  return new Intl.DateTimeFormat(iraqIntlLocales[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Baghdad",
  }).format(new Date(value));
}

export function formatServiceDay(
  serviceDay: string,
  locale: Locale,
  options: { weekday?: boolean } = {},
): string {
  const date = new Date(`${serviceDay}T00:00:00Z`);
  if (locale === "ckb") {
    const dayAndMonth = `${toSoraniNumerals(String(date.getUTCDate()))}ی ${soraniMonths[date.getUTCMonth()]}`;
    return options.weekday
      ? `${soraniWeekdays[date.getUTCDay()]}\u060c ${dayAndMonth}`
      : dayAndMonth;
  }
  return new Intl.DateTimeFormat(iraqIntlLocales[locale], {
    ...(options.weekday ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

export type CountForms = { readonly other: string } & {
  readonly [Category in "zero" | "one" | "two" | "few" | "many"]?: string;
};

function formatGroupedInteger(value: number | bigint, locale: Locale): string {
  if (locale === "ckb")
    return toSoraniNumerals(
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
        value,
      ),
    );
  return new Intl.NumberFormat(iraqIntlLocales[locale], {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatInteger(value: number, locale: Locale): string {
  return formatGroupedInteger(value, locale);
}

export function formatCount(
  count: number,
  locale: Locale,
  forms: CountForms,
): string {
  const category =
    locale === "ckb"
      ? count === 1
        ? "one"
        : "other"
      : new Intl.PluralRules(iraqIntlLocales[locale]).select(count);
  return (forms[category as keyof CountForms] ?? forms.other).replace(
    "{count}",
    formatInteger(count, locale),
  );
}

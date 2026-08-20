import type { Locale } from "./routing";

const iraqIntlLocales: Record<Locale, string> = {
  ar: "ar-IQ-u-nu-latn",
  ckb: "ckb-IQ",
  en: "en-IQ",
};

export function formatIqd(amount: number, locale: Locale): string {
  const formatted = new Intl.NumberFormat(iraqIntlLocales[locale], {
    maximumFractionDigits: 0,
  }).format(amount);

  return `IQD ${formatted}`;
}

export function formatIraqDateTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(iraqIntlLocales[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Baghdad",
  }).format(new Date(value));
}

import type { Locale } from "./routing";

const numberLocales: Record<Locale, string> = {
  ar: "ar-IQ",
  ckb: "ckb-IQ",
  en: "en-IQ",
};

export function formatIqd(amount: number, locale: Locale): string {
  const formatted = new Intl.NumberFormat(numberLocales[locale], {
    maximumFractionDigits: 0,
  }).format(amount);

  return `IQD ${formatted}`;
}

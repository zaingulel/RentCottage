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
  const integerFormat = new Intl.NumberFormat(iraqIntlLocales[locale], {
    maximumFractionDigits: 0,
  });
  const formattedWhole = integerFormat.format(
    fils < 0n ? (whole === 0n ? -0 : -whole) : whole,
  );
  if (!fraction) return `IQD ${formattedWhole}`;
  const decimal = new Intl.NumberFormat(iraqIntlLocales[locale])
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")!.value;
  const localizedFraction = [...fraction]
    .map((digit) => integerFormat.format(Number(digit)))
    .join("");
  return `IQD ${formattedWhole}${decimal}${localizedFraction}`;
}

export function formatIraqDateTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(iraqIntlLocales[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Baghdad",
  }).format(new Date(value));
}

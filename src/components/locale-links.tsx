import Link from "next/link";

import { messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/routing";

const selectorOrder = ["en", "ckb", "ar"] as const satisfies readonly Locale[];

export function LocaleLinks({
  locale,
  hrefFor,
}: {
  locale: Locale;
  hrefFor: (target: Locale) => string;
}) {
  return (
    <nav className="language-links" aria-label={messages[locale].languageLabel}>
      {selectorOrder.map((option) => (
        <Link
          key={option}
          aria-current={option === locale ? "page" : undefined}
          href={hrefFor(option)}
        >
          {messages[option].languageName}
        </Link>
      ))}
    </nav>
  );
}

import Link from "next/link";

import { messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/routing";

const selectorOrder = ["en", "ckb", "ar"] as const satisfies readonly Locale[];

export function LocaleLinks({
  id,
  locale,
  hrefFor,
}: {
  id: string;
  locale: Locale;
  hrefFor: (target: Locale) => string;
}) {
  return (
    <nav
      id={id}
      className="language-links site-header-panel"
      aria-label={messages[locale].languageLabel}
    >
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

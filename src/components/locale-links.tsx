import Link from "next/link";

import { messages } from "@/i18n/messages";
import { locales, type Locale } from "@/i18n/routing";

export function LocaleLinks({
  locale,
  path,
  queryString,
}: {
  locale: Locale;
  path: string;
  queryString: string;
}) {
  return (
    <nav
      className="results-languages"
      aria-label={messages[locale].languageLabel}
    >
      {locales.map((option) => (
        <Link
          key={option}
          aria-current={option === locale ? "page" : undefined}
          href={`/${option}${path}${queryString ? `?${queryString}` : ""}`}
        >
          {messages[option].languageName}
        </Link>
      ))}
    </nav>
  );
}

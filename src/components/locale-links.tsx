import Link from "next/link";

import { messages } from "@/i18n/messages";
import { locales, type Locale } from "@/i18n/routing";

export function LocaleLinkList({
  locale,
  path,
  queryString,
}: {
  locale: Locale;
  path: string;
  queryString: string;
}) {
  return locales.map((option) => (
    <Link
      key={option}
      aria-current={option === locale ? "page" : undefined}
      href={`/${option}${path}${queryString ? `?${queryString}` : ""}`}
    >
      {messages[option].languageName}
    </Link>
  ));
}

export function LocaleLinks(props: {
  locale: Locale;
  path: string;
  queryString: string;
}) {
  return (
    <nav
      className="language-links"
      aria-label={messages[props.locale].languageLabel}
    >
      <LocaleLinkList {...props} />
    </nav>
  );
}

import Link from "next/link";

import { accountAccessHref } from "@/access/return-destination";
import { accessMessages } from "@/i18n/access-messages";
import { messages } from "@/i18n/messages";
import { locales, type Locale } from "@/i18n/routing";
import { LocaleLinkList } from "./locale-links";

export function SiteFooter({
  locale,
  path,
  queryString,
}: {
  locale: Locale;
  path: string;
  queryString: string;
}) {
  const copy = messages[locale];
  const access = accessMessages[locale];
  const returnTo =
    path || queryString
      ? `/${locale}${path}${queryString ? `?${queryString}` : ""}`
      : `/${locale}/bookings`;
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand">
          <strong>{copy.brand}</strong>
          <span>{copy.tagline}</span>
          <p>{copy.footerDescription}</p>
        </div>
        <nav aria-label={copy.footerDiscover}>
          <p>{copy.footerDiscover}</p>
          <Link href={`/${locale}`}>{copy.footerSearch}</Link>
          <Link href={`/${locale}/bookings`}>{access.myBookings}</Link>
          <Link href={`/${locale}/messages`}>{access.messages}</Link>
        </nav>
        <nav aria-label={copy.footerOwners}>
          <p>{copy.footerOwners}</p>
          <Link
            href={accountAccessHref(locale, `/${locale}/owner/application`)}
          >
            {access.listCottage}
          </Link>
          <Link href={`/${locale}/owner/application`}>
            {copy.footerOwnerApplication}
          </Link>
          <Link href={accountAccessHref(locale, returnTo)}>
            {access.signInAccount}
          </Link>
        </nav>
        <div className="site-footer-language">
          <p>{copy.languageLabel}</p>
          <div className="language-links">
            <LocaleLinkList
              locale={locale}
              path={path}
              queryString={queryString}
            />
          </div>
        </div>
      </div>
      <div className="site-footer-bar">
        <span>
          {copy.footerCopyright.replace(
            "{year}",
            String(new Date().getFullYear()),
          )}
        </span>
        <span>
          {locales.map((option) => messages[option].languageName).join(" · ")}
        </span>
      </div>
    </footer>
  );
}

"use client";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { signOutAccount } from "@/access/actions";
import type { AccountContext } from "@/access/account-access";
import { accountAccessHref } from "@/access/return-destination";
import { accessMessages } from "@/i18n/access-messages";
import { messages } from "@/i18n/messages";
import { isLocale, type Locale } from "@/i18n/routing";
import { messagingMessages } from "@/i18n/messaging-messages";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { supportMessages } from "@/i18n/support-messages";
import { LocaleLinks } from "./locale-links";

export type NavigationAccount =
  | { status: "signed_out" }
  | { status: "unavailable" }
  | {
      status: "authenticated";
      context:
        | {
            role: AccountContext["role"];
            approvalState?:
              | "prospective"
              | "approved"
              | "expired"
              | "suspended";
          }
        | undefined;
    };

const condenseAfterScroll = 140;

export function SiteHeader({
  locale: initialLocale,
  account,
}: {
  locale: Locale;
  account: NavigationAccount;
}) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const pathLocale = pathname.split("/")[1];
  const locale = isLocale(pathLocale) ? pathLocale : initialLocale;
  const landing = pathname === `/${locale}`;
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    if (!landing) return;
    const update = () => setCondensed(window.scrollY > condenseAfterScroll);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [landing]);
  const copy = accessMessages[locale];
  const returnTo =
    landing && !query
      ? `/${locale}/bookings`
      : `${pathname}${query ? `?${query}` : ""}`;
  const enrollHref = accountAccessHref(locale, `/${locale}/owner/application`);
  return (
    <header
      className={`site-header${landing ? " site-header-landing" : ""}${
        !landing || condensed ? " site-header-solid" : ""
      }`}
    >
      <div className="site-header-row">
        <Link className="site-brand" href={`/${locale}`}>
          <strong>{messages[locale].brand}</strong>
          <span>{messages[locale].tagline}</span>
        </Link>
        <div className="site-header-controls">
          <LocaleLinks
            locale={locale}
            path={pathname.slice(locale.length + 1)}
            queryString={query}
          />
          <span className="site-header-rule" aria-hidden="true" />
          <nav aria-label={copy.account} className="account-navigation">
            {account.status === "unavailable" ? (
              <span role="status">{copy.sessionUnavailable}</span>
            ) : account.status === "signed_out" ? (
              <>
                <Link href={accountAccessHref(locale, returnTo)}>
                  {copy.signInAccount}
                </Link>
                <Link href={enrollHref}>{copy.listCottage}</Link>
              </>
            ) : (
              <details
                onClick={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest("a")
                  )
                    event.currentTarget.open = false;
                }}
              >
                <summary>{copy.account}</summary>
                <div>
                  {account.context?.role === "platform_administrator" ? (
                    <>
                      <Link href={`/${locale}/administrator/access`}>
                        {copy.administratorTitle}
                      </Link>
                      <Link href={`/${locale}/administrator/messages`}>
                        {messagingMessages[locale].moderation}
                      </Link>
                      <Link href={`/${locale}/administrator/reviews`}>
                        {customerReviewMessages[locale].administratorLink}
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link href={`/${locale}/bookings`}>
                        {copy.myBookings}
                      </Link>
                      <Link href={`/${locale}/messages`}>{copy.messages}</Link>
                      {account.context?.role === "cottage_owner" ? (
                        <Link
                          href={`/${locale}/owner/${account.context.approvalState === "prospective" ? "application" : "cottages"}`}
                        >
                          {account.context.approvalState === "prospective"
                            ? copy.ownerApplicationCta
                            : copy.manageCottages}
                        </Link>
                      ) : (
                        <Link href={enrollHref}>{copy.listCottage}</Link>
                      )}
                    </>
                  )}
                  <form action={signOutAccount.bind(null, locale)}>
                    <button type="submit">{copy.signOut}</button>
                  </form>
                </div>
              </details>
            )}
            <Link href={`/${locale}/support`}>
              {supportMessages[locale].title}
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}

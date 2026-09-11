"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { signOutAccount } from "@/access/actions";
import type { AccountContext } from "@/access/account-access";
import { accountAccessHref } from "@/access/return-destination";
import { accessMessages } from "@/i18n/access-messages";
import { isLocale, type Locale } from "@/i18n/routing";

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
export function AccountNavigation({
  locale: initialLocale,
  account,
}: {
  locale: Locale;
  account: NavigationAccount;
}) {
  const pathLocale = usePathname().split("/")[1];
  const locale = isLocale(pathLocale) ? pathLocale : initialLocale;
  const copy = accessMessages[locale];
  const enrollHref = accountAccessHref(locale, `/${locale}/owner/application`);
  return (
    <nav aria-label={copy.account} className="account-navigation">
      <Link href={`/${locale}`}>RentCottage</Link>
      {account.status === "unavailable" ? (
        <span role="status">{copy.sessionUnavailable}</span>
      ) : account.status === "signed_out" ? (
        <div>
          <Link href={accountAccessHref(locale, `/${locale}/bookings`)}>
            {copy.signInAccount}
          </Link>
          <Link href={enrollHref}>{copy.listCottage}</Link>
        </div>
      ) : (
        <details
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a"))
              event.currentTarget.open = false;
          }}
        >
          <summary>{copy.account}</summary>
          <div>
            {account.context?.role === "platform_administrator" ? (
              <Link href={`/${locale}/administrator/access`}>
                {copy.administratorTitle}
              </Link>
            ) : (
              <>
                <Link href={`/${locale}/bookings`}>{copy.myBookings}</Link>
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
    </nav>
  );
}

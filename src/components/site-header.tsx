"use client";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { signOutAccount } from "@/access/actions";
import type { AccountContext } from "@/access/account-access";
import {
  accessLanguageHref,
  accountAccessHref,
  administratorAccessLanguageHref,
} from "@/access/return-destination";
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

type HeaderPanel = "language" | "menu";

function PanelToggle({
  label,
  controls,
  open,
  onToggle,
  children,
}: {
  label: string;
  controls: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="site-header-toggle"
      aria-label={label}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        {children}
      </svg>
    </button>
  );
}

export function SiteHeader({
  locale: initialLocale,
  account,
}: {
  locale: Locale;
  account: NavigationAccount;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const pathLocale = pathname.split("/")[1];
  const locale = isLocale(pathLocale) ? pathLocale : initialLocale;
  const landing = pathname === `/${locale}`;
  const accessPage = pathname === `/${locale}/access`;
  const administratorAccessPage =
    pathname === `/${locale}/administrator/access`;
  const returnToValues = searchParams.getAll("returnTo");
  const returnToParameter =
    returnToValues.length === 1 ? returnToValues[0] : returnToValues;
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    if (!landing) return;
    const update = () => setCondensed(window.scrollY > condenseAfterScroll);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [landing]);
  const [openPanel, setOpenPanel] = useState<HeaderPanel | null>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    if (openPanel === null) return;
    const closeOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !header.current?.contains(event.target)
      )
        setOpenPanel(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenPanel(null);
      [
        ...(header.current?.querySelectorAll<HTMLButtonElement>(
          'button[aria-expanded="true"]',
        ) ?? []),
      ]
        .find((button) => getComputedStyle(button).display !== "none")
        ?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openPanel]);
  const toggle = (panel: HeaderPanel) => {
    setOpenPanel((current) => (current === panel ? null : panel));
  };
  const closeOnChoice = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("a, form"))
      setOpenPanel(null);
  };
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
      ref={header}
      onClick={closeOnChoice}
    >
      <div className="site-header-row">
        <Link className="site-brand" href={`/${locale}`}>
          <strong>{messages[locale].brand}</strong>
          <span>{messages[locale].tagline}</span>
        </Link>
        <div className="site-header-controls">
          <PanelToggle
            label={messages[locale].languageLabel}
            controls="site-header-language"
            open={openPanel === "language"}
            onToggle={() => toggle("language")}
          >
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="4" ry="9" />
            <path d="M3 12h18" />
          </PanelToggle>
          <LocaleLinks
            id="site-header-language"
            locale={locale}
            hrefFor={(target) =>
              accessPage
                ? accessLanguageHref(locale, target, returnToParameter)
                : administratorAccessPage
                  ? administratorAccessLanguageHref(
                      locale,
                      target,
                      returnToParameter,
                    )
                  : isLocale(pathLocale)
                    ? `/${target}${pathname.slice(locale.length + 1)}${query ? `?${query}` : ""}`
                    : `/${target}`
            }
          />
          <span className="site-header-rule" aria-hidden="true" />
          <PanelToggle
            label={copy.menu}
            controls="site-header-account"
            open={openPanel === "menu"}
            onToggle={() => toggle("menu")}
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </PanelToggle>
          <nav
            id="site-header-account"
            aria-label={copy.accountNavigation}
            className="account-navigation site-header-panel"
          >
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
              <div className="account-menu">
                <button
                  type="button"
                  className="account-menu-toggle"
                  aria-expanded={openPanel === "menu"}
                  aria-controls="site-header-account-menu"
                  onClick={() => toggle("menu")}
                >
                  {copy.account}
                </button>
                <div
                  id="site-header-account-menu"
                  className="account-menu-panel"
                  hidden={openPanel !== "menu"}
                >
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
              </div>
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

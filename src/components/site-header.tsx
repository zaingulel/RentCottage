"use client";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
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

const menuItem = { role: "menuitem", tabIndex: -1 } as const;

function menuItems(menu: HTMLElement | null) {
  return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
}

function nextMenuIndex(key: string, index: number, count: number) {
  switch (key) {
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

function Icon({ children }: { children: ReactNode }) {
  return (
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
  );
}

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
      <Icon>{children}</Icon>
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
  const accountMenu = useRef<HTMLDivElement>(null);
  const menuEntry = useRef<"first" | "last">("first");
  useEffect(() => {
    if (openPanel !== "menu") return;
    const items = menuItems(accountMenu.current);
    (menuEntry.current === "last" ? items.at(-1) : items[0])?.focus();
  }, [openPanel]);
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
  const openMenuByKey = (event: ReactKeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    menuEntry.current = event.key === "ArrowUp" ? "last" : "first";
    setOpenPanel("menu");
  };
  const navigateMenu = (event: ReactKeyboardEvent) => {
    if (event.key === "Tab") {
      setOpenPanel(null);
      return;
    }
    if (event.key === " " && event.target instanceof HTMLAnchorElement) {
      event.preventDefault();
      event.target.click();
      return;
    }
    const items = menuItems(accountMenu.current);
    const next = nextMenuIndex(
      event.key,
      items.findIndex((item) => item === event.target),
      items.length,
    );
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
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
          <div className="site-header-language">
            <button
              type="button"
              className="site-header-language-toggle"
              aria-expanded={openPanel === "language"}
              aria-controls="site-header-language"
              onClick={() => toggle("language")}
            >
              <Icon>
                <circle cx="12" cy="12" r="9" />
                <ellipse cx="12" cy="12" rx="4" ry="9" />
                <path d="M3 12h18" />
              </Icon>
              <span className="visually-hidden">
                {messages[locale].languageLabel}
              </span>{" "}
              <span>{messages[locale].languageName}</span>
            </button>
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
          </div>
          <span className="site-header-rule" aria-hidden="true" />
          {account.status !== "authenticated" && (
            <PanelToggle
              label={copy.menu}
              controls="site-header-account"
              open={openPanel === "menu"}
              onToggle={() => toggle("menu")}
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </PanelToggle>
          )}
          <nav
            id="site-header-account"
            aria-label={copy.accountNavigation}
            className="account-navigation site-header-panel"
          >
            {account.status === "authenticated" ? (
              <div className="account-menu">
                <button
                  type="button"
                  id="site-header-account-button"
                  className="account-menu-toggle"
                  aria-haspopup="menu"
                  aria-expanded={openPanel === "menu"}
                  aria-controls="site-header-account-menu"
                  onClick={() => {
                    menuEntry.current = "first";
                    toggle("menu");
                  }}
                  onKeyDown={openMenuByKey}
                >
                  <span className="visually-hidden">{copy.account}</span>
                  <span className="account-avatar" aria-hidden="true">
                    <Icon>
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4.5 21c0-4.2 3.4-6.5 7.5-6.5s7.5 2.3 7.5 6.5" />
                    </Icon>
                  </span>
                </button>
                <div
                  id="site-header-account-menu"
                  className="account-menu-panel"
                  role="menu"
                  aria-labelledby="site-header-account-button"
                  hidden={openPanel !== "menu"}
                  ref={accountMenu}
                  onKeyDown={navigateMenu}
                >
                  <div role="group" aria-label={copy.account}>
                    {account.context?.role === "platform_administrator" ? (
                      <>
                        <Link
                          {...menuItem}
                          href={`/${locale}/administrator/access`}
                        >
                          {copy.administratorTitle}
                        </Link>
                        <Link
                          {...menuItem}
                          href={`/${locale}/administrator/messages`}
                        >
                          {messagingMessages[locale].moderation}
                        </Link>
                        <Link
                          {...menuItem}
                          href={`/${locale}/administrator/reviews`}
                        >
                          {customerReviewMessages[locale].administratorLink}
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link {...menuItem} href={`/${locale}/bookings`}>
                          {copy.myBookings}
                        </Link>
                        <Link {...menuItem} href={`/${locale}/messages`}>
                          {copy.messages}
                        </Link>
                        {account.context?.role === "cottage_owner" ? (
                          <Link
                            {...menuItem}
                            href={`/${locale}/owner/${account.context.approvalState === "prospective" ? "application" : "cottages"}`}
                          >
                            {account.context.approvalState === "prospective"
                              ? copy.ownerApplicationCta
                              : copy.manageCottages}
                          </Link>
                        ) : (
                          <Link {...menuItem} href={enrollHref}>
                            {copy.listCottage}
                          </Link>
                        )}
                      </>
                    )}
                  </div>
                  <hr />
                  <Link {...menuItem} href={`/${locale}/support`}>
                    {supportMessages[locale].title}
                  </Link>
                  <form role="none" action={signOutAccount.bind(null, locale)}>
                    <button type="submit" {...menuItem}>
                      {copy.signOut}
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <>
                {account.status === "unavailable" ? (
                  <span role="status">{copy.sessionUnavailable}</span>
                ) : (
                  <>
                    <Link href={accountAccessHref(locale, returnTo)}>
                      {copy.signInAccount}
                    </Link>
                    <Link href={enrollHref}>{copy.listCottage}</Link>
                  </>
                )}
                <Link href={`/${locale}/support`}>
                  {supportMessages[locale].title}
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

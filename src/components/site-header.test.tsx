import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
const { location, router } = vi.hoisted(() => ({
  location: { pathname: "/en", query: "" },
  router: { refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.query),
  useRouter: () => router,
  notFound: vi.fn(),
  unstable_rethrow: vi.fn(),
}));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
import { SiteHeader } from "./site-header";

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  act(() => {
    fireEvent.scroll(window);
  });
}

describe("shared site header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    location.pathname = "/en";
    location.query = "";
    scrollTo(0);
  });
  it.each(["en", "ar", "ckb"] as const)(
    "keeps permitted search and booking context in %s sign-in",
    (locale) => {
      location.pathname = `/${locale}/quote/river-house`;
      location.query =
        "from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1";
      render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
      const signIn = screen.getByRole("link", {
        name: { en: "Sign in", ar: "تسجيل الدخول", ckb: "چوونەژوورەوە" }[
          locale
        ],
      });
      expect(signIn).toHaveAttribute(
        "href",
        `/${locale}/access?returnTo=${encodeURIComponent(`${location.pathname}?${location.query}`)}`,
      );
    },
  );
  it("rejects private or unrecognized fields from navigation return context", () => {
    location.pathname = "/en/results";
    location.query =
      "from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1&token=private";
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/en/access?returnTo=%2Fen%2Fbookings",
    );
  });
  it("offers shared authentication separately from owner enrollment", () => {
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/en/access?returnTo=%2Fen%2Fbookings",
    );
    expect(
      screen.getByRole("link", { name: "List your cottage" }),
    ).toHaveAttribute(
      "href",
      "/en/access?returnTo=%2Fen%2Fowner%2Fapplication",
    );
  });
  it("switches language through links that keep the current page and query", () => {
    location.pathname = "/ar/results";
    location.query = "from=2101-01-01&to=2101-01-01&guests=4";
    render(<SiteHeader locale="ar" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("navigation", { name: "اللغة" })).toBeVisible();
    const current = screen.getByRole("link", { name: "العربية" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "کوردی" })).toHaveAttribute(
      "href",
      "/ckb/results?from=2101-01-01&to=2101-01-01&guests=4",
    );
    expect(screen.getByRole("link", { name: "English" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: /ريف كوتج/ })).toHaveAttribute(
      "href",
      "/ar",
    );
  });
  it("links each language to its home page when the address has no language", () => {
    location.pathname = "/no-such-language/deeper";
    render(<SiteHeader locale="ar" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "العربية" })).toHaveAttribute(
      "href",
      "/ar",
    );
    expect(screen.getByRole("link", { name: "کوردی" })).toHaveAttribute(
      "href",
      "/ckb",
    );
    expect(screen.getByRole("link", { name: "English" })).toHaveAttribute(
      "href",
      "/en",
    );
  });
  it("translates the access page return destination in each language link", () => {
    location.pathname = "/en/access";
    location.query =
      "returnTo=%2Fen%2Frequest%2Friver-house%3Ffrom%3D2101-01-01%26to%3D2101-01-01%26guests%3D4%26selection%3D2101-01-01%253Ashift%253A1";
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "العربية" })).toHaveAttribute(
      "href",
      "/ar/access?returnTo=%2Far%2Frequest%2Friver-house%3Ffrom%3D2101-01-01%26to%3D2101-01-01%26guests%3D4%26selection%3D2101-01-01%253Ashift%253A1",
    );
    expect(screen.getByRole("link", { name: "کوردی" })).toHaveAttribute(
      "href",
      "/ckb/access?returnTo=%2Fckb%2Frequest%2Friver-house%3Ffrom%3D2101-01-01%26to%3D2101-01-01%26guests%3D4%26selection%3D2101-01-01%253Ashift%253A1",
    );
  });
  it("falls back to bookings in access page language links for an unsafe destination", () => {
    location.pathname = "/en/access";
    location.query = "returnTo=https%3A%2F%2Fevil.test%2Fen%2Fbookings";
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "العربية" })).toHaveAttribute(
      "href",
      "/ar/access?returnTo=%2Far%2Fbookings",
    );
  });
  it("translates the return destination in administrator access language links", () => {
    location.pathname = "/en/administrator/access";
    location.query = "returnTo=%2Fen%2Fadministrator%2Freviews";
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "العربية" })).toHaveAttribute(
      "href",
      "/ar/administrator/access?returnTo=%2Far%2Fadministrator%2Freviews",
    );
    expect(screen.getByRole("link", { name: "کوردی" })).toHaveAttribute(
      "href",
      "/ckb/administrator/access?returnTo=%2Fckb%2Fadministrator%2Freviews",
    );
    expect(screen.getByRole("link", { name: "English" })).toHaveAttribute(
      "href",
      "/en/administrator/access?returnTo=%2Fen%2Fadministrator%2Freviews",
    );
  });
  it.each([
    [
      "an external address",
      "returnTo=https%3A%2F%2Fevil.test%2Fen%2Fadministrator%2Freviews",
      "/ar/administrator/access",
    ],
    [
      "a repeated destination",
      "returnTo=%2Fen%2Fadministrator%2Freviews&returnTo=%2Fen%2Fadministrator%2Freviews",
      "/ar/administrator/access",
    ],
    ["no destination", "", "/ar/administrator/access"],
    [
      "another query field",
      "returnTo=%2Fen%2Fadministrator%2Freviews&token=private",
      "/ar/administrator/access?returnTo=%2Far%2Fadministrator%2Freviews",
    ],
  ])(
    "carries only a safe return destination in administrator access language links: %s",
    (_case, query, href) => {
      location.pathname = "/en/administrator/access";
      location.query = query;
      render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
      expect(screen.getByRole("link", { name: "العربية" })).toHaveAttribute(
        "href",
        href,
      );
    },
  );
  it("renders the landing header transparent and condenses it after scrolling", () => {
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("site-header-landing");
    expect(header).not.toHaveClass("site-header-solid");
    scrollTo(141);
    expect(header).toHaveClass("site-header-solid");
    scrollTo(140);
    expect(header).not.toHaveClass("site-header-solid");
  });
  it("renders a restored mid-page landing visit condensed on mount", () => {
    scrollTo(500);
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("banner")).toHaveClass("site-header-solid");
  });
  it("renders every other page with the static solid header", () => {
    location.pathname = "/en/results";
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("site-header-solid");
    expect(header).not.toHaveClass("site-header-landing");
    scrollTo(500);
    expect(header).toHaveClass("site-header-solid");
  });
  it("uses the solid in-flow header on the landing page while the first-name step shows", () => {
    const customer = { role: "customer" } as const;
    const { rerender } = render(
      <SiteHeader
        locale="en"
        account={{
          status: "authenticated",
          context: customer,
          name: { status: "missing" },
        }}
      />,
    );
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("site-header-solid");
    expect(header).not.toHaveClass("site-header-landing");

    rerender(
      <SiteHeader
        locale="en"
        account={{
          status: "authenticated",
          context: customer,
          name: { status: "named", initial: "Z" },
        }}
      />,
    );
    expect(header).toHaveClass("site-header-landing");
    expect(header).not.toHaveClass("site-header-solid");
  });
  it("reports an unavailable session in the account slot", () => {
    render(<SiteHeader locale="en" account={{ status: "unavailable" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Account access is unavailable. Please try again.",
    );
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
      "href",
      "/en/support",
    );
  });
  it("support link discards private source context", () => {
    location.pathname = "/en/booking-requests/RC-REQ-0123456789ABCDEF";
    location.query = "token=private-support-sentinel";
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
      "href",
      "/en/support",
    );
  });
  it.each(["en", "ar", "ckb"] as const)(
    "shows localized support when signed out in %s",
    (locale) => {
      location.pathname = `/${locale}`;
      render(<SiteHeader locale={locale} account={{ status: "signed_out" }} />);
      expect(
        screen.getByRole("link", {
          name: { en: "Support", ar: "الدعم", ckb: "پشتیوانی" }[locale],
        }),
      ).toHaveAttribute("href", `/${locale}/support`);
      expect(
        screen.getByRole("navigation", {
          name: {
            en: "Account and support",
            ar: "الحساب والدعم",
            ckb: "هەژمار و پشتیوانی",
          }[locale],
        }),
      ).toContainElement(
        screen.getByRole("link", {
          name: { en: "Support", ar: "الدعم", ckb: "پشتیوانی" }[locale],
        }),
      );
    },
  );
  it("shows support to a customer inside the account menu", () => {
    render(
      <SiteHeader
        locale="en"
        account={{ status: "authenticated", context: { role: "customer" } }}
      />,
    );
    const account = screen.getByRole("button", { name: "Account" });
    const menu = document.getElementById(
      account.getAttribute("aria-controls") ?? "",
    );
    fireEvent.click(account);
    const support = screen.getByRole("menuitem", { name: "Support" });
    expect(support).toHaveAttribute("href", "/en/support");
    expect(menu).toContainElement(support);
    expect(screen.queryByRole("link", { name: "Support" })).toBeNull();
  });
  it.each([
    ["customer", { role: "customer" }],
    ["cottage owner", { role: "cottage_owner", approvalState: "approved" }],
    ["platform administrator", { role: "platform_administrator" }],
  ] as const)(
    "announces the %s avatar as a menu button with its open state",
    (_kind, context) => {
      render(
        <SiteHeader
          locale="en"
          account={{ status: "authenticated", context }}
        />,
      );
      const avatar = screen.getByRole("button", { name: "Account" });
      expect(avatar).toHaveAttribute("aria-haspopup", "menu");
      expect(avatar).toHaveAttribute("aria-expanded", "false");
      expect(avatar).toHaveTextContent(/^Account$/);
      const shape = avatar.querySelector(".account-avatar");
      expect(shape).toHaveAttribute("aria-hidden", "true");
      expect(shape?.querySelector("svg")).not.toBeNull();
      expect(shape?.textContent).toBe("");
      expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
      const menu = document.getElementById(
        avatar.getAttribute("aria-controls") ?? "",
      );
      expect(menu).toHaveAttribute("role", "menu");
      expect(menu).toHaveAttribute("aria-labelledby", avatar.id);
      expect(menu).not.toBeVisible();
      fireEvent.click(avatar);
      expect(avatar).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("menu", { name: "Account" })).toBe(menu);
      expect(
        screen.getByRole("group", { name: "Account" }).querySelectorAll("a")
          .length,
      ).toBeGreaterThan(0);
      for (const item of within(menu!).getAllByRole("menuitem"))
        expect(item).toHaveAttribute("tabindex", "-1");
      expect(
        within(menu!)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(expect.arrayContaining(["Support", "Sign out"]));
      fireEvent.click(avatar);
      expect(avatar).toHaveAttribute("aria-expanded", "false");
    },
  );
  it.each([
    ["en", "Z", "Account"],
    ["ar", "ز", "الحساب"],
  ] as const)(
    "shows the first letter on the %s avatar",
    (locale, initial, label) => {
      location.pathname = `/${locale}`;
      render(
        <SiteHeader
          locale={locale}
          account={{
            status: "authenticated",
            context: { role: "customer" },
            name: { status: "named", initial },
          }}
        />,
      );
      const avatar = screen.getByRole("button", { name: label });
      const shape = avatar.querySelector(".account-avatar");
      expect(shape).toHaveAttribute("aria-hidden", "true");
      expect(shape?.textContent).toBe(initial);
      expect(shape?.querySelector("svg")).toBeNull();
    },
  );
  it.each([
    ["no name", undefined],
    ["a missing name", { status: "missing" }],
  ] as const)(
    "shows the person shape when there is no letter (%s)",
    (_kind, name) => {
      render(
        <SiteHeader
          locale="en"
          account={{
            status: "authenticated",
            context: { role: "customer" },
            name,
          }}
        />,
      );
      const shape = screen
        .getByRole("button", { name: "Account" })
        .querySelector(".account-avatar");
      expect(shape?.querySelector("svg")).not.toBeNull();
      expect(shape?.textContent).toBe("");
    },
  );
  it("shows a signed-out visitor no avatar", () => {
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
    expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
    expect(document.querySelector(".account-avatar")).toBeNull();
    expect(screen.getByRole("button", { name: "Menu" })).toBeVisible();
  });
  it("moves through the avatar menu by keyboard", () => {
    render(
      <SiteHeader
        locale="en"
        account={{ status: "authenticated", context: { role: "customer" } }}
      />,
    );
    const avatar = screen.getByRole("button", { name: "Account" });
    fireEvent.keyDown(avatar, { key: "ArrowDown" });
    expect(avatar).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem");
    const first = items[0]!;
    const last = items.at(-1)!;
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1]!, { key: "ArrowUp" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    expect(avatar).toHaveFocus();
    fireEvent.keyDown(avatar, { key: "ArrowUp" });
    expect(avatar).toHaveAttribute("aria-expanded", "true");
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(avatar);
    expect(first).toHaveFocus();
    const activated = vi.fn((event: Event) => event.preventDefault());
    first.addEventListener("click", activated);
    expect(fireEvent.keyDown(first, { key: " " })).toBe(false);
    expect(activated).toHaveBeenCalledTimes(1);
    expect(avatar).toHaveAttribute("aria-expanded", "false");
  });
  it.each([
    ["en", "Language English"],
    ["ar", "اللغة العربية"],
    ["ckb", "زمان کوردی"],
  ] as const)(
    "shows the current language in its own name for %s",
    (locale, name) => {
      location.pathname = `/${locale}/results`;
      render(<SiteHeader locale={locale} account={{ status: "signed_out" }} />);
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).not.toHaveAttribute("aria-label");
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(
        screen
          .getByRole("navigation", { name: name.split(" ")[0] })
          .querySelectorAll("a"),
      ).toHaveLength(3);
    },
  );
  it.each([
    ["en", "Language English", "Menu", "Account and support"],
    ["ar", "اللغة العربية", "القائمة", "الحساب والدعم"],
    ["ckb", "زمان کوردی", "پێڕست", "هەژمار و پشتیوانی"],
  ] as const)(
    "names the %s phone header buttons and ties each to its panel",
    (locale, language, menu, account) => {
      location.pathname = `/${locale}`;
      render(<SiteHeader locale={locale} account={{ status: "signed_out" }} />);
      for (const [name, panel] of [
        [language, language.split(" ")[0]!],
        [menu, account],
      ]) {
        const button = screen.getByRole("button", { name });
        expect(button).toHaveAttribute("aria-expanded", "false");
        expect(
          document.getElementById(button.getAttribute("aria-controls") ?? ""),
        ).toBe(screen.getByRole("navigation", { name: panel }));
      }
    },
  );
  it("opens one header panel at a time", () => {
    const { unmount } = render(
      <SiteHeader locale="en" account={{ status: "signed_out" }} />,
    );
    const language = screen.getByRole("button", { name: "Language English" });
    const menu = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(language);
    expect(language).toHaveAttribute("aria-expanded", "true");
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menu);
    expect(language).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(menu);
    expect(language).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveAttribute("aria-expanded", "false");
    unmount();
    render(
      <SiteHeader
        locale="en"
        account={{ status: "authenticated", context: { role: "customer" } }}
      />,
    );
    const avatar = screen.getByRole("button", { name: "Account" });
    const signedInLanguage = screen.getByRole("button", {
      name: "Language English",
    });
    fireEvent.click(signedInLanguage);
    fireEvent.click(avatar);
    expect(signedInLanguage).toHaveAttribute("aria-expanded", "false");
    expect(avatar).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(signedInLanguage);
    expect(signedInLanguage).toHaveAttribute("aria-expanded", "true");
    expect(avatar).toHaveAttribute("aria-expanded", "false");
  });
  it("closes the open panel on Escape and returns focus to its visible button", () => {
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    const menu = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(menu);
    const link = screen.getByRole("link", { name: "Sign in" });
    act(() => link.focus());
    fireEvent.keyDown(link, { key: "Escape" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });
  it.each(["pointerDown", "focusIn"] as const)(
    "closes the open panel on %s outside the header",
    (event) => {
      render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
      const menu = screen.getByRole("button", { name: "Menu" });
      fireEvent.click(menu);
      fireEvent[event](menu);
      expect(menu).toHaveAttribute("aria-expanded", "true");
      fireEvent[event](document.body);
      expect(menu).toHaveAttribute("aria-expanded", "false");
    },
  );
  it.each(["prospective", "approved", "expired", "suspended"] as const)(
    "keeps customer booking access for %s owners",
    (approvalState) => {
      render(
        <SiteHeader
          locale="en"
          account={{
            status: "authenticated",
            context: { role: "cottage_owner", approvalState },
          }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Account" }));
      expect(
        screen.getByRole("menuitem", { name: "My bookings" }),
      ).toHaveAttribute("href", "/en/bookings");
      expect(
        screen.getByRole("menuitem", { name: "Messages" }),
      ).toHaveAttribute("href", "/en/messages");
      expect(
        screen.getByRole("menuitem", {
          name:
            approvalState === "prospective"
              ? "Continue to Owner Application"
              : "Manage my cottages",
        }),
      ).toHaveAttribute(
        "href",
        approvalState === "prospective"
          ? "/en/owner/application"
          : "/en/owner/cottages",
      );
      expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
      expect(screen.getByRole("menuitem", { name: "Support" })).toHaveAttribute(
        "href",
        "/en/support",
      );
    },
  );
  it("closes the open panel when a destination or Sign out is chosen", () => {
    render(
      <SiteHeader
        locale="en"
        account={{ status: "authenticated", context: { role: "customer" } }}
      />,
    );
    const account = screen.getByRole("button", { name: "Account" });
    fireEvent.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "List your cottage" }),
    );
    expect(account).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(account).toHaveAttribute("aria-expanded", "false");
  });
  it.each([
    ["customer", { role: "customer" }],
    ["cottage owner", { role: "cottage_owner", approvalState: "approved" }],
    ["platform administrator", { role: "platform_administrator" }],
  ] as const)(
    "puts Personal information first in the account menu of a %s",
    (_kind, context) => {
      render(
        <SiteHeader
          locale="en"
          account={{ status: "authenticated", context }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Account" }));
      const first = screen.getAllByRole("menuitem")[0]!;
      expect(first).toHaveTextContent("Personal information");
      expect(first).toHaveAttribute("href", "/en/account");
    },
  );
  it("keeps administrator access separate", () => {
    render(
      <SiteHeader
        locale="en"
        account={{
          status: "authenticated",
          context: { role: "platform_administrator" },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(
      screen.getByRole("menuitem", { name: "Platform Administrator access" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Review moderation" }),
    ).toHaveAttribute("href", "/en/administrator/reviews");
    expect(
      screen.queryByRole("menuitem", { name: "My bookings" }),
    ).not.toBeInTheDocument();
  });
});

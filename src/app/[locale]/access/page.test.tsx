import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { accessMessages } from "@/i18n/access-messages";

const { resolveRequestAccount, notFound, redirect, router } = vi.hoisted(
  () => ({
    resolveRequestAccount: vi.fn(),
    notFound: vi.fn(),
    redirect: vi.fn(),
    router: { refresh: vi.fn(), replace: vi.fn() },
  }),
);

vi.mock("@/access/request-account-context", () => ({ resolveRequestAccount }));
vi.mock("@/access/actions", () => ({
  enrollOwner: vi.fn(),
  signOutAccount: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound,
  redirect,
  useRouter: () => router,
}));

import AccountAccessPage from "./page";

const reference = "RC-REQ-0123456789ABCDEF";
const profileId = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  resolveRequestAccount.mockResolvedValue({
    status: "authenticated",
    context: { userId: "customer", role: "customer" },
  });
});

async function renderCustomerAccess(
  locale: "en" | "ar" | "ckb",
  returnTo: string,
) {
  return render(
    await AccountAccessPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({ returnTo }),
    }),
  );
}

it.each(["en", "ar", "ckb"] as const)(
  "offers enrollment for %s owner-onboarding destinations",
  async (locale) => {
    const application = await renderCustomerAccess(
      locale,
      `/${locale}/owner/application`,
    );
    expect(
      screen.getByRole("heading", { name: accessMessages[locale].enrollTitle }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: accessMessages[locale].enroll }),
    ).toBeVisible();
    application.unmount();

    const cottages = await renderCustomerAccess(
      locale,
      `/${locale}/owner/cottages`,
    );
    expect(
      screen.getByRole("button", { name: accessMessages[locale].enroll }),
    ).toBeVisible();
    cottages.unmount();
  },
);

it.each(["en", "ar", "ckb"] as const)(
  "denies %s customer access to participant-only owner destinations without enrollment",
  async (locale) => {
    for (const returnTo of [
      `/${locale}/owner/booking-requests/${reference}`,
      `/${locale}/owner/cottages/${profileId}`,
    ]) {
      const view = await renderCustomerAccess(locale, returnTo);
      expect(screen.getByRole("alert")).toHaveTextContent(
        accessMessages[locale].denied,
      );
      expect(
        screen.getByRole("link", { name: accessMessages[locale].retry }),
      ).toHaveAttribute("href", returnTo);
      expect(
        screen.queryByRole("button", { name: accessMessages[locale].enroll }),
      ).not.toBeInTheDocument();
      view.unmount();
    }
  },
);

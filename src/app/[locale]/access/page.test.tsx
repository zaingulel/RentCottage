import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { accessMessages } from "@/i18n/access-messages";

const {
  getEnvironment,
  requestPhone,
  resolveRequestAccount,
  notFound,
  redirect,
  router,
} = vi.hoisted(() => ({
  getEnvironment: vi.fn(),
  requestPhone: vi.fn(),
  resolveRequestAccount: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  router: { refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("@/config/server-runtime", () => ({
  getServerEnvironment: getEnvironment,
}));
vi.mock("@/access/request-account-context", () => ({ resolveRequestAccount }));
vi.mock("@/access/actions", () => ({
  requestPhoneAccess: requestPhone,
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
  getEnvironment.mockReturnValue({});
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

it("hosted demo access page forwards simulation mode without signup claims", async () => {
  resolveRequestAccount.mockResolvedValue({ status: "signed_out" });
  getEnvironment.mockReturnValue({ hostedDemo: true });
  requestPhone.mockResolvedValue({ status: "demo_code_ready" });
  for (const [locale, title, intro, request, code] of [
    [
      "en",
      "Invited demo access",
      "Sign into your invited synthetic identity using a simulated phone code.",
      "Use simulated code",
      "Simulated invitation code",
    ],
    [
      "ar",
      "دخول العرض بالدعوة",
      "ادخل بهويتك الاصطناعية المدعوة باستخدام رمز هاتف محاكى.",
      "استخدم الرمز المحاكى",
      "رمز الدعوة المحاكى",
    ],
    [
      "ckb",
      "دەستگەیشتنی پیشاندان بە بانگهێشت",
      "بە کۆدی تەلەفۆنی هاوشێوەکراو بچۆ ناو ناسنامە دەستکردە بانگهێشتکراوەکەت.",
      "کۆدی هاوشێوەکراو بەکاربهێنە",
      "کۆدی بانگهێشتی هاوشێوەکراو",
    ],
  ] as const) {
    const view = await renderCustomerAccess(locale, `/${locale}/bookings`);
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText(intro)).toBeVisible();
    expect(view.container).not.toHaveTextContent(
      accessMessages[locale].accessIntro,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "+9647500000000" },
    });
    await userEvent.click(screen.getByRole("button", { name: request }));
    expect(screen.getByLabelText(code)).toBeVisible();
    view.unmount();
  }
  getEnvironment.mockReturnValue({});
  const standard = await renderCustomerAccess("en", "/en/bookings");
  expect(
    screen.getByRole("heading", { name: accessMessages.en.accessTitle }),
  ).toBeVisible();
  standard.unmount();
});

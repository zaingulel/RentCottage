import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const { location, getEnvironment, resolveAccount, resolveName, saveName } =
  vi.hoisted(() => ({
    location: { pathname: "/en" },
    getEnvironment: vi.fn(),
    resolveAccount: vi.fn(),
    resolveName: vi.fn(),
    saveName: vi.fn(),
  }));
vi.mock("@/config/server-runtime", () => ({
  getServerEnvironment: getEnvironment,
}));
vi.mock("@/access/request-account-context", () => ({
  resolveRequestAccount: resolveAccount,
}));
vi.mock("@/access/request-account-name", () => ({
  resolveRequestAccountName: resolveName,
}));
vi.mock("@/access/actions", () => ({
  saveAccountName: saveName,
  signOutAccount: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import LocaleLayout from "./layout";

it("hosted demo notice remains visible across personas and the name gate", async () => {
  getEnvironment.mockReturnValue({ hostedDemo: true });
  saveName.mockResolvedValue({ status: "saved" });
  for (const [locale, notice, firstName, save] of [
    [
      "en",
      "Invited synthetic demo. Phone identity and verification are simulated. Real suppliers are unavailable.",
      "First name",
      "Save and continue",
    ],
    [
      "ar",
      "عرض اصطناعي بالدعوة. هوية الهاتف والتحقق منه محاكاة. الموردون الحقيقيون غير متاحين.",
      "الاسم الأول",
      "احفظ وتابع",
    ],
    [
      "ckb",
      "پیشاندانی دەستکرد بە بانگهێشت. ناسنامە و پشتڕاستکردنەوەی تەلەفۆن هاوشێوەکراون. دابینکەرە ڕاستەقینەکان بەردەست نین.",
      "ناوی یەکەم",
      "پاشەکەوت بکە و بەردەوام بە",
    ],
  ] as const) {
    location.pathname = `/${locale}`;
    for (const context of [
      undefined,
      { role: "customer", userId: "customer" },
      { role: "cottage_owner", userId: "owner", approvalState: "approved" },
      { role: "platform_administrator", userId: "administrator" },
    ]) {
      resolveAccount.mockResolvedValue(
        context
          ? { status: "authenticated", context }
          : { status: "signed_out" },
      );
      resolveName.mockResolvedValue({ status: "missing" });
      const props = {
        params: Promise.resolve({ locale }),
        children: <main>Demo page content</main>,
      };
      const view = render(await LocaleLayout(props), { container: document });
      const disclosure = screen.getByRole("status");
      expect(disclosure).toHaveTextContent(notice);
      expect(disclosure).toBeVisible();
      expect(disclosure.tagName).toBe("ASIDE");
      expect(document.querySelector("header.site-header")).toHaveClass(
        "site-header-solid",
      );
      expect(document.querySelector("header.site-header")).not.toHaveClass(
        "site-header-landing",
      );
      expect(
        document.querySelector("header.site-header")?.nextElementSibling,
      ).toBe(disclosure);
      expect(document.documentElement).toHaveAttribute(
        "dir",
        locale === "en" ? "ltr" : "rtl",
      );
      if (context) {
        expect(screen.getByText("Demo page content")).not.toBeVisible();
        fireEvent.change(screen.getByLabelText(firstName), {
          target: { value: "Zana" },
        });
        await userEvent.click(screen.getByRole("button", { name: save }));
        resolveName.mockResolvedValue({
          status: "named",
          firstName: "Zana",
          initial: "Z",
        });
        view.rerender(await LocaleLayout(props));
        expect(screen.getByText("Demo page content")).toBeVisible();
        expect(screen.getByRole("status")).toBeVisible();
        expect(screen.getByRole("status")).toHaveTextContent(notice);
      }
      cleanup();
    }
  }
  location.pathname = "/en";
  getEnvironment.mockReturnValue({});
  resolveAccount.mockResolvedValue({ status: "signed_out" });
  const standard = render(
    await LocaleLayout({
      params: Promise.resolve({ locale: "en" }),
      children: <main>Ordinary page</main>,
    }),
    { container: document },
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(document.querySelector("header.site-header")).toHaveClass(
    "site-header-landing",
  );
  standard.unmount();
});

import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));
vi.mock("next/navigation", () => ({ notFound }));

import SupportPage from "./page";

it.each(["en", "ar", "ckb"] as const)(
  "shows the non-operative support route in %s",
  async (locale) => {
    render(await SupportPage({ params: Promise.resolve({ locale }) }));
    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(main).getAllByRole("heading", { level: 2 })).toHaveLength(5);
    expect(within(main).getByRole("status")).toHaveTextContent(
      {
        en: "You cannot send a complaint, contact a support team or open a case here.",
        ar: "لا يمكنك إرسال شكوى أو التواصل مع فريق دعم أو فتح قضية هنا.",
        ckb: "لێرە ناتوانیت سکاڵا بنێریت، پەیوەندی بە تیمی پشتیوانیەوە بکەیت یان دۆسیەیەک بکەیتەوە.",
      }[locale],
    );
    expect(main).toHaveTextContent(
      {
        en: "Cottage Owner replies are not available yet.",
        ar: "ردود مالكي الأكواخ غير متاحة بعد.",
        ckb: "وەڵامی خاوەن کۆتێج هێشتا بەردەست نییە.",
      }[locale],
    );
    expect(
      within(main)
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(
      {
        en: [
          "Support complaints",
          "Booking Incidents",
          "Payment Disputes",
          "Public reviews",
          "Existing records",
        ],
        ar: [
          "شكاوى الدعم",
          "حوادث الحجز",
          "نزاعات الدفع",
          "التقييمات العامة",
          "السجلات الحالية",
        ],
        ckb: [
          "سکاڵاکانی پشتیوانی",
          "ڕووداوەکانی حجز",
          "ناکۆکییەکانی پارەدان",
          "هەڵسەنگاندنە گشتییەکان",
          "تۆمارە هەبووەکان",
        ],
      }[locale],
    );
    const links = within(main).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/${locale}`,
      `/${locale}/bookings`,
      `/${locale}/bookings?workspace=owner`,
    ]);
    expect(within(main).queryByRole("form")).toBeNull();
    expect(within(main).queryByRole("textbox")).toBeNull();
    expect(within(main).queryByRole("button")).toBeNull();
  },
);

it.each([
  ["ar", "الشكوى لا تضمن استرداد المبلغ"],
  ["ckb", "سکاڵا گەڕاندنەوەی پارە مسۆگەر ناکات"],
] as const)(
  "keeps chargeback cases separate from refund promises in %s",
  async (locale, complaint) => {
    render(await SupportPage({ params: Promise.resolve({ locale }) }));
    const disputes = screen.getByText(/\(chargeback\)/);
    expect(disputes).toBeVisible();
    expect(disputes).toHaveTextContent(complaint);
  },
);

it("rejects an unsupported locale", async () => {
  await expect(
    SupportPage({ params: Promise.resolve({ locale: "xx" }) }),
  ).rejects.toThrow("not found");
  expect(notFound).toHaveBeenCalledOnce();
});

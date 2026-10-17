import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { accessMessages } from "@/i18n/access-messages";
import { ownerBookingRequestMessages } from "@/i18n/owner-booking-request-messages";

import { BackofficeNavigation } from "./backoffice-navigation";

function links(areaLabel: string) {
  return within(
    screen.getByRole("navigation", { name: areaLabel }),
  ).getAllByRole("link");
}

describe("BackofficeNavigation", () => {
  it.each([
    ["en", "Owner Backoffice", ["My cottages", "Bookings"]],
    ["ar", "مكتب مالك الكوخ", ["إدارة أكواخي", "حجوزات أكواخي"]],
    [
      "ckb",
      "بەشی بەڕێوەبردنی خاوەن کۆتێج",
      ["بەڕێوەبردنی کۆتێجەکانم", "حجزەکانی کۆتێجەکانم"],
    ],
  ] as const)(
    "lists the Owner Backoffice destinations in %s",
    (locale, areaLabel, labels) => {
      render(
        <BackofficeNavigation
          locale={locale}
          area="owner"
          current="cottages"
        />,
      );
      const destinations = links(areaLabel);
      expect(destinations.map((link) => link.textContent)).toEqual(labels);
      expect(destinations.map((link) => link.getAttribute("href"))).toEqual([
        `/${locale}/owner/cottages`,
        `/${locale}/bookings?workspace=owner`,
      ]);
    },
  );

  it.each([
    [
      "en",
      "Platform administration",
      [
        "Review submitted Owner Applications",
        "Manage Cottage Profiles",
        "Payment support history",
        "Booking queues",
        "Booking totals",
        "Records",
      ],
    ],
    [
      "ar",
      "إدارة المنصة",
      [
        "راجع طلبات المالك المرسلة",
        "إدارة ملفات الأكواخ",
        "سجل دعم الدفع",
        "طوابير الحجوزات",
        "إجماليات الحجوزات",
        "السجلات",
      ],
    ],
    [
      "ckb",
      "بەڕێوەبردنی پلاتفۆرم",
      [
        "داواکارییە نێردراوەکانی خاوەن بپشکنە",
        "پرۆفایلەکانی کۆتێج بەڕێوەببە",
        "مێژووی پشتگیری پارەدان",
        "ڕیزەکانی حجز",
        "کۆی حجزەکان",
        "تۆمارەکان",
      ],
    ],
  ] as const)(
    "lists the Platform administration destinations in %s",
    (locale, areaLabel, labels) => {
      render(
        <BackofficeNavigation
          locale={locale}
          area="administrator"
          current="payments"
        />,
      );
      const destinations = links(areaLabel);
      expect(destinations.map((link) => link.textContent)).toEqual(labels);
      expect(destinations.map((link) => link.getAttribute("href"))).toEqual([
        `/${locale}/administrator/owner-applications`,
        `/${locale}/administrator/cottages`,
        `/${locale}/administrator/payments`,
        `/${locale}/administrator/queues`,
        `/${locale}/administrator/totals`,
        `/${locale}/administrator/records`,
      ]);
    },
  );

  it("marks only the current destination, as the page on a list page and as its section on a nested page", () => {
    const { rerender } = render(
      <BackofficeNavigation
        locale="en"
        area="administrator"
        current="cottages"
      />,
    );
    const marks = () =>
      links("Platform administration").map((link) =>
        link.getAttribute("aria-current"),
      );
    expect(marks()).toEqual([null, "page", null, null, null, null]);

    rerender(
      <BackofficeNavigation
        locale="en"
        area="administrator"
        current="cottages"
        nested
      />,
    );
    expect(marks()).toEqual([null, "true", null, null, null, null]);
  });

  it("marks the booking queues destination as current on the queue page", () => {
    render(
      <BackofficeNavigation
        locale="en"
        area="administrator"
        current="queues"
      />,
    );
    expect(
      links("Platform administration").map((link) =>
        link.getAttribute("aria-current"),
      ),
    ).toEqual([null, null, null, "page", null, null]);
  });

  it("marks the booking totals destination as current on the totals page", () => {
    render(
      <BackofficeNavigation
        locale="en"
        area="administrator"
        current="totals"
      />,
    );
    expect(
      links("Platform administration").map((link) =>
        link.getAttribute("aria-current"),
      ),
    ).toEqual([null, null, null, null, "page", null]);
  });

  it("renders each destination as a tab under a visually hidden area label", () => {
    const { rerender } = render(
      <BackofficeNavigation locale="en" area="owner" current="cottages" />,
    );
    const expectTabs = (areaLabel: string) => {
      const navigation = screen.getByRole("navigation", { name: areaLabel });
      expect(
        within(navigation)
          .getByText(areaLabel)
          .classList.contains("visually-hidden"),
      ).toBe(true);
      for (const tab of within(navigation).getAllByRole("link")) {
        expect(tab.classList.contains("backoffice-navigation-tab")).toBe(true);
        expect(tab.classList.contains("action-secondary")).toBe(false);
      }
    };
    expectTabs("Owner Backoffice");

    rerender(
      <BackofficeNavigation
        locale="en"
        area="administrator"
        current="payments"
      />,
    );
    expectTabs("Platform administration");
  });

  it.each([
    ["en", "Owner Backoffice", "2"],
    ["ar", "مكتب مالك الكوخ", "2"],
    ["ckb", "بەشی بەڕێوەبردنی خاوەن کۆتێج", "٢"],
  ] as const)(
    "shows and announces the waiting Booking Request count on the owner's Bookings tab",
    (locale, areaLabel, number) => {
      render(
        <BackofficeNavigation
          locale={locale}
          area="owner"
          current="cottages"
          waitingBookingRequests={2}
        />,
      );
      const navigation = within(
        screen.getByRole("navigation", { name: areaLabel }),
      );
      const { ownerBookingsTab, ownerCottagesTab } = accessMessages[locale];
      expect(
        navigation.getByRole("link", {
          name: `${ownerBookingsTab} ${ownerBookingRequestMessages[locale].title}: ${number}`,
        }),
      ).toBeVisible();
      expect(
        navigation.getByRole("link", { name: ownerCottagesTab }),
      ).toBeVisible();
    },
  );

  it("shows no count on the Bookings tab when no Booking Request is waiting or the list is unavailable", () => {
    const { container, rerender } = render(
      <BackofficeNavigation
        locale="en"
        area="owner"
        current="cottages"
        waitingBookingRequests={0}
      />,
    );
    const expectNoCount = () => {
      expect(
        within(
          screen.getByRole("navigation", { name: "Owner Backoffice" }),
        ).getByRole("link", { name: "Bookings" }),
      ).toBeVisible();
      expect(
        container.querySelector(".backoffice-navigation-count"),
      ).toBeNull();
    };
    expectNoCount();

    rerender(
      <BackofficeNavigation locale="en" area="owner" current="cottages" />,
    );
    expectNoCount();
  });
});

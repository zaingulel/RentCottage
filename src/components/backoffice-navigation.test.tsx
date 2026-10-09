import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BackofficeNavigation } from "./backoffice-navigation";

function links(areaLabel: string) {
  return within(
    screen.getByRole("navigation", { name: areaLabel }),
  ).getAllByRole("link");
}

describe("BackofficeNavigation", () => {
  it.each([
    [
      "en",
      "Owner Backoffice",
      ["Manage my cottages", "Bookings for my cottages"],
    ],
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
    expect(marks()).toEqual([null, "page", null, null, null]);

    rerender(
      <BackofficeNavigation
        locale="en"
        area="administrator"
        current="cottages"
        nested
      />,
    );
    expect(marks()).toEqual([null, "true", null, null, null]);
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
    ).toEqual([null, null, null, "page", null]);
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
const retryAction = vi.hoisted(() => vi.fn());
vi.mock("@/notification/notification-actions", () => ({
  retryPaidConfirmationNotification: retryAction,
}));
import { ConfirmedBookingDetails } from "./confirmed-booking-details";
const base = {
  receiptId: "82000000-0000-4000-8000-000000003502",
  bookingRequestReference: "RC-REQ-0000000000003501",
  bookingReference: "CONFIRMED-BOOKING-35",
  confirmedAt: "2100-12-31T13:00:00Z",
  actorRole: "customer" as const,
  customerName: "Fictional Customer",
  cottageName: "Preserved Cottage",
  bookingPeriod: [
    {
      serviceDay: "2101-01-01",
      displayName: "Morning",
      startsAt: "2101-01-01T08:00:00+03:00",
      endsAt: "2101-01-01T12:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 110000,
      kind: "shift" as const,
      position: 1 as const,
    },
  ],
  partySize: 4,
  pricing: {
    bookingPriceIqd: 110000,
    serviceFeeIqd: 5000,
    customerTotalIqd: 115000,
  },
  houseRules: "Preserved House Rules",
  bookingTermsVersion: "terms-v1",
  bookingTermsBody: "Preserved readable booking terms.",
  cancellationPolicyVersion: "cancel-v1",
  exactAddress: "Current private address",
  privateDirections: "Turn after the fictional bridge",
  mapPin: { latitude: 33.315241, longitude: 44.366067 },
  customerPhone: "+9647500003502",
  ownerPhone: "+9647500003501",
};
const pending = {
  receiptId: base.receiptId,
  state: "pending" as const,
  lastOutcome: null,
  supplierDeliveryReference: null,
  deliveredAt: null,
  suppressedAt: null,
  historical: false,
};
describe("confirmed booking details", () => {
  it.each([
    ["en", "Jan 1, 2101, 8:00 AM", "Jan 1, 2101, 12:00 PM", "IQD 115,000"],
    [
      "ar",
      "01\u200f/01\u200f/2101، 8:00 ص",
      "01\u200f/01\u200f/2101، 12:00 م",
      "IQD 115,000",
    ],
    [
      "ckb",
      "٢١٠١ کانوونی دووەم ١ ٨:٠٠ ب.ن",
      "٢١٠١ کانوونی دووەم ١ ١٢:٠٠ د.ن",
      "IQD ١١٥٬٠٠٠",
    ],
  ] as const)(
    "isolates confirmed booking names and dates in %s",
    (locale, startsAt, endsAt, customerTotal) => {
      render(
        <div dir={locale === "en" ? "ltr" : "rtl"}>
          <ConfirmedBookingDetails
            locale={locale}
            access={{
              ...base,
              bookingPeriod: [
                ...base.bookingPeriod,
                {
                  serviceDay: "2101-01-01",
                  displayName: "Full-day",
                  startsAt: base.bookingPeriod[0].startsAt,
                  endsAt: base.bookingPeriod[0].endsAt,
                  crossesMidnight: false,
                  priceIqd: 110000,
                  kind: "full-day",
                },
              ],
            }}
            notification={pending}
            navigation={null}
          />
        </div>,
      );
      const periodLabel = {
        en: "Booking period",
        ar: "فترة الحجز",
        ckb: "ماوەی حجز",
      }[locale];
      const period = screen.getByText(periodLabel).nextElementSibling!;
      expect(Array.from(period.children, (item) => item.textContent)).toEqual([
        `Morning ${startsAt} – ${endsAt}`,
        `Full-day ${startsAt} – ${endsAt}`,
      ]);
      for (const [index, name] of ["Morning", "Full-day"].entries()) {
        const values = Array.from(
          period.children[index].querySelectorAll("bdi"),
        );
        expect(values.map((value) => value.textContent)).toEqual([
          name,
          startsAt,
          endsAt,
        ]);
        for (const value of values) {
          expect(value.getAttribute("dir") ?? "auto").toBe("auto");
        }
      }
      expect(screen.getByText(customerTotal)).toBeInTheDocument();
    },
  );
  it("renders preserved commercial facts and current private access for the paid customer", () => {
    render(
      <ConfirmedBookingDetails
        locale="en"
        access={base}
        notification={pending}
        navigation={null}
      />,
    );
    expect(screen.getByText("Preserved House Rules")).toBeInTheDocument();
    expect(screen.getByText("Current private address")).toBeInTheDocument();
    expect(screen.getByText("33.315241, 44.366067")).toBeInTheDocument();
    expect(screen.getByText("+9647500003502")).toBeInTheDocument();
    expect(screen.getByText("+9647500003501")).toBeInTheDocument();
    expect(
      screen.getByText(/no message was sent by a real supplier/i),
    ).toBeInTheDocument();
  });
  it("renders Sorani labels and a bounded retry only for known failure", () => {
    render(
      <ConfirmedBookingDetails
        locale="ckb"
        access={base}
        notification={{ ...pending, state: "retryable", lastOutcome: "failed" }}
        navigation={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "دووبارە هەوڵدانەوەی ئاگادارکردن" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "حجزەکانم" })).toHaveAttribute(
      "href",
      "/ckb/bookings",
    );
  });
  it("does not offer retry for uncertain delivery", () => {
    render(
      <ConfirmedBookingDetails
        locale="ar"
        access={base}
        notification={{
          ...pending,
          state: "uncertain",
          lastOutcome: "unknown",
        }}
        navigation={null}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("جارٍ التحقق من التسليم")).toBeInTheDocument();
  });
  it("keeps paid details visible when delivery status is unavailable", () => {
    render(
      <ConfirmedBookingDetails
        locale="en"
        access={base}
        notification={{
          receiptId: base.receiptId,
          state: "unavailable",
          lastOutcome: null,
          supplierDeliveryReference: null,
          deliveredAt: null,
          suppressedAt: null,
          historical: false,
        }}
        navigation={null}
      />,
    );
    expect(
      screen.getByText("Preserved readable booking terms."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Delivery status is temporarily unavailable",
    );
  });
  it("keeps the complete booking terms inside a collapsed disclosure after the facts", () => {
    render(
      <ConfirmedBookingDetails
        locale="en"
        access={base}
        notification={pending}
        navigation={null}
      />,
    );
    const terms = screen.getByText("Preserved readable booking terms.");
    const disclosure = terms.closest("details")!;
    const facts = screen.getByText("Booking period").closest("dl")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure.querySelector("summary")).toHaveTextContent(
      "Booking terms",
    );
    expect(facts).not.toContainElement(terms);
    expect(
      facts.compareDocumentPosition(disclosure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it.each([
    ["en", "Some practical access or contact details are unavailable."],
    ["ar", "بعض تفاصيل الوصول أو الاتصال غير متاحة."],
    ["ckb", "هەندێک وردەکاری گەیشتن یان پەیوەندی بەردەست نییە."],
  ] as const)(
    "truthfully identifies incomplete practical details in %s",
    (locale, incomplete) => {
      render(
        <ConfirmedBookingDetails
          locale={locale}
          access={{
            ...base,
            exactAddress: null,
            privateDirections: null,
            mapPin: null,
            customerPhone: null,
            ownerPhone: null,
          }}
          notification={pending}
          navigation={null}
        />,
      );
      expect(screen.getByRole("status", { name: incomplete })).toBeVisible();
      expect(
        screen.queryByText("Current private address"),
      ).not.toBeInTheDocument();
    },
  );
  it("does not mark practical details incomplete when only the address is absent", () => {
    render(
      <ConfirmedBookingDetails
        locale="en"
        access={{ ...base, exactAddress: null }}
        notification={pending}
        navigation={null}
      />,
    );
    expect(
      screen.queryByRole("status", {
        name: "Some practical access or contact details are unavailable.",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Turn after the fictional bridge")).toBeVisible();
  });
  it.each([
    [
      "en",
      "Map pin",
      "Simulated navigation: no map service is connected. Enter these numbers in your own maps app.",
    ],
    [
      "ar",
      "إحداثيات الخريطة",
      "ملاحة محاكاة: لا توجد خدمة خرائط متصلة. أدخل هذه الأرقام في تطبيق الخرائط لديك.",
    ],
    [
      "ckb",
      "خاڵی نەخشە",
      "ڕێنیشاندانی لاساییکراو: هیچ خزمەتگوزارییەکی نەخشە نەبەستراوەتەوە. ئەم ژمارانە لە ئەپی نەخشەکەی خۆتدا بنووسە.",
    ],
  ] as const)(
    "labels navigation as simulated and offers no link in %s",
    (locale, mapTerm, label) => {
      render(
        <ConfirmedBookingDetails
          locale={locale}
          access={base}
          notification={pending}
          navigation={{ kind: "simulated" }}
        />,
      );
      const mapRow = screen.getByText(mapTerm).parentElement!;
      expect(within(mapRow).getByText(label)).toBeVisible();
      expect(
        within(mapRow).getByText("33.315241, 44.366067"),
      ).toBeInTheDocument();
      expect(within(mapRow).queryByRole("link")).not.toBeInTheDocument();
    },
  );
  it("keeps paid details visible and explains a failed retry", async () => {
    retryAction.mockResolvedValue({ status: "failed" });
    render(
      <ConfirmedBookingDetails
        locale="en"
        access={base}
        notification={{ ...pending, state: "retryable", lastOutcome: "failed" }}
        navigation={null}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Retry confirmation notice" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The notice could not be retried",
    );
    expect(screen.getByText("Preserved House Rules")).toBeInTheDocument();
    expect(screen.getByText("Current private address")).toBeInTheDocument();
  });
});

it("shows the persisted lifecycle beside the retained booking reference", () => {
  render(
    <ConfirmedBookingDetails
      locale="en"
      access={base}
      notification={pending}
      navigation={null}
      lifecycleStatus="completed"
    />,
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Completed booking" }),
  ).toBeVisible();
  expect(screen.getByText("Preserved House Rules")).toBeInTheDocument();
});

it("confirmed headings return before the title", () => {
  for (const [locale, customerName, ownerName] of [
    ["en", "My bookings", "Bookings for my cottages"],
    ["ar", "حجوزاتي", "حجوزات أكواخي"],
    ["ckb", "حجزەکانم", "حجزەکانی کۆتێجەکانم"],
  ] as const) {
    for (const actorRole of ["customer", "cottage_owner"] as const) {
      for (const lifecycleStatus of ["confirmed", "completed"] as const) {
        const access =
          actorRole === "customer"
            ? base
            : {
                ...base,
                actorRole,
                pricing: {
                  bookingPriceIqd: 110000,
                  marketplaceCommissionFils: 11000000,
                  ownerNetFils: 99000000,
                },
              };
        const view = render(
          <ConfirmedBookingDetails
            locale={locale}
            access={access}
            notification={pending}
            navigation={null}
            lifecycleStatus={lifecycleStatus}
          />,
        );
        const titles = screen.getAllByRole("heading", { level: 1 });
        expect(titles).toHaveLength(1);
        const title = titles[0];
        const heading = title.closest("header")!;
        expect(heading).toHaveClass("page-heading");
        const links = within(heading).getAllByRole("link");
        expect(links).toHaveLength(1);
        const link = within(heading).getByRole("link", {
          name: actorRole === "customer" ? customerName : ownerName,
        });
        expect(link).toBeVisible();
        expect(link).toHaveAttribute(
          "href",
          actorRole === "customer"
            ? `/${locale}/bookings`
            : `/${locale}/bookings?workspace=owner`,
        );
        expect(
          link.compareDocumentPosition(title) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        const supportingText = within(heading)
          .getByText("Preserved Cottage")
          .closest("p")!;
        expect(supportingText.tagName).toBe("P");
        expect(
          within(supportingText)
            .getByText("CONFIRMED-BOOKING-35")
            .closest("strong")?.tagName,
        ).toBe("STRONG");
        expect(title).toHaveAttribute("id", "confirmed-booking-heading");
        expect(title).toHaveAttribute("tabindex", "-1");
        view.unmount();
      }
    }
  }
});

it("confirmed record composition preserves facts and escapes source text", () => {
  const cottageName =
    'Preserved کۆتێج Cottage with a long mixed-direction name <img src=x onerror="alert(1)">';
  const bookingReference = "CONFIRMED-BOOKING-35-حجز-کۆتێج-LONG-REFERENCE";
  const houseRules = '<script>alert("rules")</script> Keep the garden quiet.';
  const privateDirections =
    '<svg onload="alert(1)"> Turn after the fictional bridge.';
  const bookingTermsBody =
    '<a onclick="alert(1)">Preserved readable booking terms.</a>';
  const normalize = (text: string | null) => text?.replace(/\s+/g, " ").trim();
  for (const [
    locale,
    startsAt,
    endsAt,
    labels,
    amounts,
    notice,
    fictional,
    terms,
  ] of [
    [
      "en",
      "Jan 1, 2101, 8:00 AM",
      "Jan 1, 2101, 12:00 PM",
      [
        "Customer",
        "Booking period",
        "Party size",
        "Original booking price",
        "Service fee",
        "Customer total",
        "Original commission",
        "Original owner share",
        "House Rules",
        "Exact address",
        "Private directions",
        "Map pin",
        "Customer phone",
        "Cottage Owner phone",
        "Confirmation notice",
      ],
      ["IQD 110,000", "IQD 5,000", "IQD 115,000", "IQD 11,000", "IQD 99,000"],
      "Pending",
      "Local fictional delivery only — no message was sent by a real supplier.",
      "Booking terms",
    ],
    [
      "ar",
      "01\u200f/01\u200f/2101، 8:00 ص",
      "01\u200f/01\u200f/2101، 12:00 م",
      [
        "العميل",
        "فترة الحجز",
        "عدد أفراد المجموعة",
        "سعر الحجز الأصلي",
        "رسوم الخدمة",
        "إجمالي العميل",
        "العمولة الأصلية",
        "حصة المالك الأصلية",
        "قواعد البيت",
        "العنوان الدقيق",
        "إرشادات الوصول الخاصة",
        "إحداثيات الخريطة",
        "هاتف العميل",
        "هاتف مالك البيت",
        "إشعار التأكيد",
      ],
      ["IQD 110,000", "IQD 5,000", "IQD 115,000", "IQD 11,000", "IQD 99,000"],
      "قيد الانتظار",
      "تسليم تجريبي محلي فقط؛ لم يرسل مورد حقيقي أي رسالة.",
      "شروط الحجز",
    ],
    [
      "ckb",
      "٢١٠١ کانوونی دووەم ١ ٨:٠٠ ب.ن",
      "٢١٠١ کانوونی دووەم ١ ١٢:٠٠ د.ن",
      [
        "کڕیار",
        "ماوەی حجز",
        "ژمارەی کەسان",
        "نرخی سەرەتایی حجز",
        "کرێی خزمەتگوزاری",
        "کۆی گشتی کڕیار",
        "کۆمسیۆنی سەرەتایی",
        "بەشی سەرەتایی خاوەن",
        "یاساکانی کۆتێج",
        "ناونیشانی ورد",
        "ڕێنمایی تایبەتی گەیشتن",
        "خاڵی نەخشە",
        "تەلەفۆنی کڕیار",
        "تەلەفۆنی خاوەن کۆتێج",
        "ئاگادارکردنەوەی پشتڕاستکردن",
      ],
      ["IQD ١١٠٬٠٠٠", "IQD ٥٬٠٠٠", "IQD ١١٥٬٠٠٠", "IQD ١١٬٠٠٠", "IQD ٩٩٬٠٠٠"],
      "چاوەڕێ",
      "تەنها گەیاندنی تاقیکردنەوەی ناوخۆییە — هیچ دابینکەرێکی ڕاستەقینە پەیامی نەناردووە.",
      "مەرجەکانی حجز",
    ],
  ] as const) {
    for (const actorRole of ["customer", "cottage_owner"] as const) {
      for (const lifecycleStatus of ["confirmed", "completed"] as const) {
        const source = {
          ...base,
          cottageName,
          bookingReference,
          houseRules,
          privateDirections,
          bookingTermsBody,
        };
        const access =
          actorRole === "customer"
            ? source
            : {
                ...source,
                actorRole,
                pricing: {
                  bookingPriceIqd: 110000,
                  marketplaceCommissionFils: 11000000,
                  ownerNetFils: 99000000,
                },
              };
        const view = render(
          <ConfirmedBookingDetails
            locale={locale}
            access={access}
            notification={pending}
            navigation={null}
            lifecycleStatus={lifecycleStatus}
          />,
        );
        const region = screen.getByRole("region");
        const header = region.querySelector("header")!;
        const supporting = header.querySelector("p")!;
        expect(
          Array.from(supporting.children, (child) => child.textContent),
        ).toEqual([cottageName, bookingReference]);
        expect(supporting.children[1].tagName).toBe("STRONG");
        expect(supporting.children[1].querySelector("bdi")).toHaveTextContent(
          bookingReference,
        );
        const lists = Array.from(region.querySelectorAll("dl"));
        expect(lists).toHaveLength(4);
        const period = lists[0].querySelectorAll("dd")[1];
        expect(period.children).toHaveLength(1);
        const entry = period.children[0];
        expect(
          Array.from(entry.children, (child) => normalize(child.textContent)),
        ).toEqual(["Morning", `${startsAt} – ${endsAt}`]);
        expect(
          Array.from(
            entry.children[1].querySelectorAll("bdi"),
            (child) => child.textContent,
          ),
        ).toEqual([startsAt, endsAt]);
        expect(
          Array.from(
            entry.querySelectorAll("bdi"),
            (child) => child.textContent,
          ),
        ).toEqual(["Morning", startsAt, endsAt]);
        const moneyLabels =
          actorRole === "customer"
            ? [labels[3], labels[4], labels[5]]
            : [labels[3], labels[6], labels[7]];
        const moneyValues =
          actorRole === "customer"
            ? [amounts[0], amounts[1], amounts[2]]
            : [amounts[0], amounts[3], amounts[4]];
        expect(
          lists.map((list) =>
            Array.from(list.querySelectorAll("dt"), (term) => term.textContent),
          ),
        ).toEqual([
          labels.slice(0, 3),
          moneyLabels,
          labels.slice(8, 14),
          [labels[14]],
        ]);
        expect(
          lists.map((list) =>
            Array.from(list.querySelectorAll("dd"), (value) =>
              normalize(value.textContent),
            ),
          ),
        ).toEqual([
          ["Fictional Customer", `Morning ${startsAt} – ${endsAt}`, "4"],
          moneyValues,
          [
            houseRules,
            "Current private address",
            privateDirections,
            "33.315241, 44.366067",
            "+9647500003502",
            "+9647500003501",
          ],
          [`${notice}${fictional}`],
        ]);
        for (const literal of [
          cottageName,
          houseRules,
          privateDirections,
          bookingTermsBody,
        ])
          expect(within(region).getByText(literal)).toBeInTheDocument();
        expect(
          region.querySelector(
            "script, img, svg, [onerror], [onload], [onclick]",
          ),
        ).toBeNull();
        const disclosure = region.querySelector("details")!;
        expect(disclosure.querySelector("summary")).toHaveTextContent(terms);
        expect(disclosure).not.toHaveAttribute("open");
        expect(disclosure.parentElement).toBe(
          lists[0].parentElement!.parentElement,
        );
        expect(disclosure).toBe(disclosure.parentElement!.lastElementChild);
        expect(
          lists[3].compareDocumentPosition(disclosure) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
        view.unmount();
      }
    }
  }
});

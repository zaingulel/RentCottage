import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BookingQuoteItem } from "@/booking-quote/booking-quote";
import {
  BookingPeriodIdentity,
  BookingPeriodEndpoints,
  BookingPeriodAccessSummary,
} from "./booking-period-details";

const morning: BookingQuoteItem = {
  kind: "shift",
  position: 1,
  displayName: "Garden morning",
  serviceDay: "2099-08-21",
  startsAt: "2099-08-21T09:00:00+03:00",
  endsAt: "2099-08-21T15:00:00+03:00",
  crossesMidnight: false,
  priceIqd: 60000,
};
const evening: BookingQuoteItem = {
  ...morning,
  position: 2,
  displayName: "Garden evening",
  startsAt: "2099-08-21T17:00:00+03:00",
  endsAt: "2099-08-22T02:00:00+03:00",
  crossesMidnight: true,
  priceIqd: 80000,
};
const bundle: BookingQuoteItem = {
  kind: "full-day",
  displayName: "Recorded bundle",
  serviceDay: morning.serviceDay,
  startsAt: morning.startsAt,
  endsAt: evening.endsAt,
  crossesMidnight: true,
  priceIqd: 110000,
};

describe("Booking period details", () => {
  it("presents known identities beside escaped original names", () => {
    for (const [locale, morningLabel, eveningLabel] of [
      ["en", "Morning", "Evening"],
      ["ar", "الفترة الصباحية", "الفترة المسائية"],
      ["ckb", "ماوەی بەیانی", "ماوەی ئێوارە"],
    ] as const) {
      for (const [item, label] of [
        [morning, morningLabel],
        [evening, eveningLabel],
      ] as const) {
        const originalName = '<img src=x onerror="alert(1)"> ناوی خاوەن';
        const view = render(
          <BookingPeriodIdentity
            locale={locale}
            {...item}
            originalName={originalName}
            presentation="morning-evening-v1"
          />,
        );
        expect(screen.getByText(label)).toBeVisible();
        expect(screen.getByText(originalName)).toHaveAttribute("dir", "auto");
        expect(view.container.querySelector("img, script")).toBeNull();
        view.rerender(
          <BookingPeriodIdentity
            locale={locale}
            {...item}
            originalName={label}
            presentation="morning-evening-v1"
          />,
        );
        expect(screen.getAllByText(label)).toHaveLength(1);
        view.unmount();
      }
    }
  });

  it("shows only translated current Full-day identity in every locale while preserving historical names", () => {
    for (const [locale, label] of [
      ["en", "Full-day"],
      ["ar", "حجز اليوم الكامل"],
      ["ckb", "حجزکردنی تەواوی ڕۆژ"],
    ] as const) {
      const view = render(
        <BookingPeriodIdentity
          locale={locale}
          kind="full-day"
          originalName="Full-day bundle"
          presentation="morning-evening-v1"
        />,
      );
      expect(screen.getByText(label, { exact: true })).toBeVisible();
      expect(view.container.textContent).toBe(label);
      expect(screen.queryByText("Full-day bundle")).toBeNull();

      const originalName = '<img src=x onerror="alert(1)"> ناوی کۆن';
      for (const presentation of [undefined, "original-names"] as const) {
        view.rerender(
          <BookingPeriodIdentity
            locale={locale}
            kind="full-day"
            originalName={originalName}
            presentation={presentation}
          />,
        );
        expect(view.container.querySelector("bdi")?.textContent).toBe(
          originalName,
        );
        expect(screen.getByText(originalName)).toHaveAttribute("dir", "auto");
        expect(view.container.querySelector("img, script")).toBeNull();
      }
      view.unmount();
    }
  });

  it("preserves unversioned historical names and full-day boundaries", () => {
    for (const item of [
      morning,
      evening,
      { ...morning, position: 3 as const, displayName: "Old third" },
      bundle,
    ]) {
      const view = render(
        <BookingPeriodIdentity
          locale="ar"
          {...item}
          originalName={item.displayName}
        />,
      );
      expect(view.container).toHaveTextContent(item.displayName);
      expect(view.container).not.toHaveTextContent(
        /الفترة الصباحية|الفترة المسائية|حجز اليوم الكامل/,
      );
      expect(screen.getByText(item.displayName)).toHaveAttribute("dir", "auto");
      view.rerender(
        <BookingPeriodIdentity
          locale="ckb"
          {...item}
          originalName={item.displayName}
          presentation="original-names"
        />,
      );
      expect(view.container).toHaveTextContent(item.displayName);
      expect(view.container).not.toHaveTextContent(/ماوەی بەیانی|ماوەی ئێوارە/);
      view.unmount();
    }
    const view = render(<BookingPeriodEndpoints locale="en" {...bundle} />);
    expect(view.container).toHaveTextContent("Arrival: Aug 21, 2099, 09:00");
    expect(view.container).toHaveTextContent(
      "Departure: Aug 22, 2099, 02:00 (next day)",
    );
    expect(view.container.querySelectorAll("time")[1]).toHaveAttribute(
      "datetime",
      "2099-08-22T02:00:00+03:00",
    );
  });

  it("shows exact Iraq endpoints and purchased gap coverage in every locale", () => {
    for (const [
      locale,
      arrival,
      departure,
      first,
      last,
      zone,
      gap,
      continuous,
    ] of [
      [
        "en",
        "Arrival",
        "Departure",
        "Aug 21, 2099, 09:00",
        "Aug 22, 2099, 02:00",
        "All times are Iraq local time (UTC+3).",
        "No access between Aug 21, 2099, 15:00 and Aug 21, 2099, 17:00.",
        "Continuous access includes the overnight time between these Full-day dates.",
      ],
      [
        "ar",
        "الوصول",
        "المغادرة",
        "21‏/08‏/2099، 09:00",
        "22‏/08‏/2099، 02:00",
        "جميع الأوقات بتوقيت العراق (UTC+3).",
        "لا يحق لك الدخول أو البقاء بين 21‏/08‏/2099، 15:00 و21‏/08‏/2099، 17:00.",
        "يشمل الدخول والبقاء المتواصلان الوقت الليلي بين تواريخ حجز اليوم الكامل هذه.",
      ],
      [
        "ckb",
        "گەیشتن",
        "ڕۆیشتن",
        "٢٠٩٩ ئاب ٢١ ٠٩:٠٠",
        "٢٠٩٩ ئاب ٢٢ ٠٢:٠٠",
        "هەموو کاتەکان بە کاتی عێراقن (UTC+3).",
        "لە نێوان ٢٠٩٩ ئاب ٢١ ١٥:٠٠ و ٢٠٩٩ ئاب ٢١ ١٧:٠٠ مافی بەکارهێنان و مانەوەت نییە.",
        "بەکارهێنان و مانەوەی بەردەوام کاتی شەوی نێوان ئەم بەروارانەی حجزکردنی تەواوی ڕۆژیش دەگرێتەوە.",
      ],
    ] as const) {
      const view = render(
        <BookingPeriodAccessSummary
          locale={locale}
          items={[morning, evening]}
        />,
      );
      const rows = screen.getAllByRole("listitem");
      expect(rows[0]).toHaveTextContent(`${arrival}: ${first}`);
      expect(rows[1]).toHaveTextContent(`${departure}: ${last}`);
      expect(within(rows[1]).getByText(zone)).toBeVisible();
      expect(
        view.container.querySelector(".booking-period-gap")?.textContent,
      ).toBe(gap);
      for (const time of view.container.querySelectorAll("time"))
        expect(time.parentElement).toHaveAttribute("dir", "auto");
      expect(view.container).not.toHaveTextContent(/AM|PM|ب\.ن|د\.ن/);
      view.rerender(
        <BookingPeriodAccessSummary locale={locale} items={[bundle]} />,
      );
      expect(view.container.querySelector(".booking-period-gap")).toBeNull();
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      const secondBundle = {
        ...bundle,
        serviceDay: "2099-08-22",
        startsAt: "2099-08-22T09:00:00+03:00",
        endsAt: "2099-08-23T02:00:00+03:00",
      };
      view.rerender(
        <BookingPeriodAccessSummary
          locale={locale}
          items={[bundle, secondBundle]}
        />,
      );
      expect(screen.getByText(continuous)).toBeVisible();
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(view.container.querySelectorAll("time")[1]).toHaveAttribute(
        "datetime",
        "2099-08-23T02:00:00+03:00",
      );
      expect(view.container.querySelector(".booking-period-gap")).toBeNull();
      view.unmount();
    }
  });
});

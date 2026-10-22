import type { ReactNode } from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { completePhone, requestPhone, verifyPhone, submitBookingRequest } =
  vi.hoisted(() => ({
    completePhone: vi.fn(),
    requestPhone: vi.fn(),
    verifyPhone: vi.fn(),
    submitBookingRequest: vi.fn(),
  }));

vi.mock("@/booking-request/actions", () => ({ submitBookingRequest }));
vi.mock("@/access/actions", () => ({
  completePhoneAccess: completePhone,
  requestPhoneAccess: requestPhone,
  verifyPhoneAccess: verifyPhone,
}));

import RequestLayout from "@/app/[locale]/request/[slug]/layout";
import { messages } from "@/i18n/messages";
import { BookingQuoteView } from "./booking-quote";
import { NotFoundScreen } from "./not-found-screen";

import type { PublicBookingQuote } from "@/booking-quote/booking-quote";
import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";
import { bookingQuoteMessages } from "@/i18n/booking-quote-messages";
import { bookingRequestMessages } from "@/i18n/booking-request-messages";
import {
  bookingRequestAcceptanceEvidence,
  type BookingRequestUiPolicy,
} from "@/booking-request/booking-request-policy";
import type { Locale } from "@/i18n/routing";
import { BookingRequestForm } from "./booking-request-form";
import { bookingTermsFixture } from "@/booking-request/booking-terms-fixture";

const quote: PublicBookingQuote = {
  slug: "cottage-00000000000040008000000000000029",
  quoteFingerprint: "a".repeat(64),
  cottageName: "Quiet Garden",
  contentVersion: 2,
  houseRules: "No smoking",
  termsVersion: "fictional-local-test-2026-08-22-v1",
  marketplaceTerms: bookingTermsFixture("en"),
  items: [
    {
      serviceDay: "2099-08-21",
      kind: "shift",
      position: 2,
      displayName: "Evening",
      startsAt: "2099-08-21T20:00:00+03:00",
      endsAt: "2099-08-21T23:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 100_003,
    },
  ],
  bookingPriceIqd: 100_003,
  serviceFeeIqd: 5_000,
  customerTotalIqd: 105_003,
};

const uiPolicy: BookingRequestUiPolicy = {
  insideCutoff: false,
  requiresInside48HourNoRefundAcceptance: true,
};

function policyProps(locale: Locale) {
  return {
    uiPolicy,
    acceptanceEvidence: bookingRequestAcceptanceEvidence({
      locale,
      requiresInside48HourNoRefundAcceptance: true,
    }),
  };
}

const queryString =
  "from=2099-08-21&to=2099-08-21&guests=4&selection=2099-08-21%3Ashift%3A2";
const returnTo = `/en/request/${quote.slug}?${queryString}`;
const discoveryQuery: CottageDiscoveryQuery = {
  from: "2099-08-21",
  to: "2099-08-21",
  guests: 4,
  amenities: [],
  selections: [{ serviceDay: "2099-08-21", kind: "shift", position: 2 }],
};

function inlineForm(insideCutoff = false) {
  return (
    <BookingRequestForm
      customerReady={false}
      discoveryQuery={discoveryQuery}
      idempotencyKey="11111111-1111-4111-8111-111111111111"
      locale="en"
      quote={quote}
      returnTo={returnTo}
      {...policyProps("en")}
      uiPolicy={{ ...uiPolicy, insideCutoff }}
    />
  );
}

async function requestFrame(children: ReactNode) {
  return await RequestLayout({
    children,
    params: Promise.resolve({ locale: "en", slug: quote.slug }),
  });
}

async function enterAndVerify(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("Iraqi phone number"),
    "+9647500000000",
  );
  await user.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
  await user.type(screen.getByLabelText("Verification code"), "123456");
  const verify = screen.getByRole("button", { name: "Verify" });
  act(() => verify.focus());
  await user.keyboard("{Enter}");
  return verify;
}

describe("Booking Request form", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hosted demo inline access keeps simulation wording and errors", async () => {
    requestPhone.mockResolvedValue({ status: "demo_code_ready" });
    completePhone.mockResolvedValue({ status: "completed" });
    submitBookingRequest.mockResolvedValue({ status: "access-required" });
    for (const [
      locale,
      title,
      intro,
      request,
      code,
      verify,
      invalid,
      required,
    ] of [
      [
        "en",
        "Continue with your invited demo identity",
        "Phone access is simulated for invited synthetic identities. Real payment suppliers are unavailable.",
        "Use simulated code",
        "Simulated invitation code",
        "Continue demo",
        "The simulated invitation code is invalid.",
        "Use your invited synthetic demo identity before continuing. Phone verification is simulated.",
      ],
      [
        "ar",
        "تابع بهوية العرض المدعوة",
        "دخول الهاتف محاكاة للهويات الاصطناعية المدعوة. موردو الدفع الحقيقيون غير متاحين.",
        "استخدم الرمز المحاكى",
        "رمز الدعوة المحاكى",
        "تابع العرض",
        "رمز الدعوة المحاكى غير صحيح.",
        "استخدم هوية العرض الاصطناعية المدعوة قبل المتابعة. التحقق من الهاتف محاكاة.",
      ],
      [
        "ckb",
        "بە ناسنامەی بانگهێشتی پیشاندان بەردەوام بە",
        "دەستگەیشتنی تەلەفۆن بۆ ناسنامە دەستکردە بانگهێشتکراوەکان هاوشێوەکراوە. دابینکەرە ڕاستەقینەکانی پارەدان بەردەست نین.",
        "کۆدی هاوشێوەکراو بەکاربهێنە",
        "کۆدی بانگهێشتی هاوشێوەکراو",
        "پیشاندان بەردەوام بکە",
        "کۆدی بانگهێشتی هاوشێوەکراو نادروستە.",
        "پێش بەردەوامبوون ناسنامەی دەستکردی بانگهێشتی پیشاندان بەکاربهێنە. پشتڕاستکردنەوەی تەلەفۆن هاوشێوەکراوە.",
      ],
    ] as const) {
      const view = render(
        <BookingRequestForm
          locale={locale}
          phoneAccessMode="hosted-demo"
          customerReady={false}
          discoveryQuery={discoveryQuery}
          idempotencyKey="11111111-1111-4111-8111-111111111111"
          quote={quote}
          {...policyProps(locale)}
        />,
      );
      expect(screen.getByRole("heading", { name: title })).toBeVisible();
      expect(screen.getByText(intro)).toBeVisible();
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "+9647500000000" },
      });
      await userEvent.click(screen.getByRole("button", { name: request }));
      fireEvent.change(screen.getByLabelText(code), {
        target: { value: "654321" },
      });
      verifyPhone.mockResolvedValue({ status: "invalid_code" });
      await userEvent.click(screen.getByRole("button", { name: verify }));
      expect(screen.getByRole("alert")).toHaveTextContent(invalid);
      verifyPhone.mockResolvedValue({
        status: "authenticated",
        context: { userId: "demo-customer", role: "customer" },
      });
      await userEvent.click(screen.getByRole("button", { name: verify }));
      const form = screen.getByRole("form", {
        name: bookingRequestMessages[locale].formTitle,
      });
      await act(async () => fireEvent.submit(form));
      expect(screen.getByRole("alert")).toHaveTextContent(required);
      expect(view.container).not.toHaveTextContent(
        bookingRequestMessages[locale].errors["access-required"],
      );
      view.unmount();
    }
  });

  it.each([false, true])(
    "focuses the inline verification successor when insideCutoff is %s",
    async (insideCutoff) => {
      requestPhone.mockResolvedValue({ status: "code_sent" });
      let resolveCompletion!: (value: { status: "completed" }) => void;
      completePhone.mockReturnValue(
        new Promise((resolve) => {
          resolveCompletion = resolve;
        }),
      );
      let resolveVerification!: (value: { status: "authenticated" }) => void;
      verifyPhone.mockReturnValue(
        new Promise((resolve) => {
          resolveVerification = resolve;
        }),
      );
      const user = userEvent.setup();
      render(await requestFrame(inlineForm(insideCutoff)));
      const frame = screen.getByRole("region", {
        name: bookingRequestMessages.en.formTitle,
      });
      await user.type(
        screen.getByLabelText("Iraqi phone number"),
        "+9647500000000",
      );
      await user.click(
        screen.getByRole("button", { name: "Send verification code" }),
      );
      await user.type(screen.getByLabelText("Verification code"), "123456");
      const verify = screen.getByRole("button", { name: "Verify" });
      act(() => verify.focus());
      await user.keyboard("{Enter}");
      expect(verify).toBeDisabled();
      expect(frame).not.toHaveFocus();

      await act(async () => resolveVerification({ status: "authenticated" }));
      expect(completePhone).toHaveBeenCalledExactlyOnceWith(
        "en",
        returnTo,
        true,
      );
      await act(async () => resolveCompletion({ status: "completed" }));
      expect(
        screen.getByRole("region", {
          name: bookingRequestMessages.en.formTitle,
        }),
      ).toBe(frame);
      expect(frame.isConnected).toBe(true);
      expect(frame).toHaveFocus();

      expect(verify).not.toBeInTheDocument();
      if (insideCutoff) {
        expect(screen.getByRole("alert")).toHaveTextContent(
          bookingRequestMessages.en.cutoffPassed,
        );
        expect(
          screen.queryByLabelText("Customer name"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "Send Booking Request" }),
        ).not.toBeInTheDocument();
      } else {
        expect(screen.getByLabelText("Customer name")).toBeVisible();
        expect(
          screen.getByRole("button", { name: "Send Booking Request" }),
        ).toBeEnabled();
      }
      expect(submitBookingRequest).not.toHaveBeenCalled();
    },
  );

  it("retains the request region when cutoff changes before inline completion", async () => {
    requestPhone.mockResolvedValue({ status: "code_sent" });
    verifyPhone.mockResolvedValue({ status: "authenticated" });
    let resolveCompletion!: (value: { status: "completed" }) => void;
    completePhone.mockReturnValue(
      new Promise((resolve) => {
        resolveCompletion = resolve;
      }),
    );
    const user = userEvent.setup();
    const { rerender } = render(await requestFrame(inlineForm()));
    const frame = screen.getByRole("region", {
      name: bookingRequestMessages.en.formTitle,
    });
    await enterAndVerify(user);
    expect(completePhone).toHaveBeenCalledExactlyOnceWith("en", returnTo, true);
    await act(async () => rerender(await requestFrame(inlineForm(true))));
    await act(async () => resolveCompletion({ status: "completed" }));
    expect(
      screen.getByRole("region", { name: bookingRequestMessages.en.formTitle }),
    ).toBe(frame);
    expect(frame.isConnected).toBe(true);
    expect(frame).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(
      bookingRequestMessages.en.cutoffPassed,
    );
    expect(screen.queryByLabelText("Customer name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send Booking Request" }),
    ).not.toBeInTheDocument();
    expect(submitBookingRequest).not.toHaveBeenCalled();
  });

  it("retains completed region focus through a later cutoff without reclaiming departure", async () => {
    requestPhone.mockResolvedValue({ status: "code_sent" });
    verifyPhone.mockResolvedValue({ status: "authenticated" });
    let resolveCompletion!: (value: { status: "completed" }) => void;
    completePhone.mockReturnValue(
      new Promise((resolve) => {
        resolveCompletion = resolve;
      }),
    );
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        {await requestFrame(inlineForm())}
        <button>Outside</button>
      </>,
    );
    const frame = screen.getByRole("region", {
      name: bookingRequestMessages.en.formTitle,
    });
    await enterAndVerify(user);
    await act(async () => resolveCompletion({ status: "completed" }));
    expect(frame).toHaveFocus();
    expect(screen.getByLabelText("Customer name")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Send Booking Request" }),
    ).toBeEnabled();
    await act(async () =>
      rerender(
        <>
          {await requestFrame(inlineForm(true))}
          <button>Outside</button>
        </>,
      ),
    );
    expect(
      screen.getByRole("region", { name: bookingRequestMessages.en.formTitle }),
    ).toBe(frame);
    expect(frame.isConnected).toBe(true);
    expect(frame).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(
      bookingRequestMessages.en.cutoffPassed,
    );
    expect(screen.queryByLabelText("Customer name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send Booking Request" }),
    ).not.toBeInTheDocument();
    const outside = screen.getByRole("button", { name: "Outside" });
    act(() => outside.focus());
    await act(async () =>
      rerender(
        <>
          {await requestFrame(<NotFoundScreen locale="en" />)}
          <button>Outside</button>
        </>,
      ),
    );
    expect(
      screen.getByRole("region", { name: bookingRequestMessages.en.formTitle }),
    ).toBe(frame);
    expect(frame.isConnected).toBe(true);
    expect(outside).toHaveFocus();
    expect(
      screen.getByRole("heading", { name: messages.en.notFoundTitle }),
    ).toBeVisible();
    expect(submitBookingRequest).not.toHaveBeenCalled();
  });

  it.each(["quote unavailable", "not found"] as const)(
    "keeps the same request region through %s replacement and stale completion",
    async (replacement) => {
      requestPhone.mockResolvedValue({ status: "code_sent" });
      verifyPhone.mockResolvedValue({ status: "authenticated" });
      let resolveCompletion!: (value: { status: "completed" }) => void;
      completePhone.mockReturnValue(
        new Promise((resolve) => {
          resolveCompletion = resolve;
        }),
      );
      const user = userEvent.setup();
      const { rerender } = render(await requestFrame(inlineForm()));
      const frame = screen.getByRole("region", {
        name: bookingRequestMessages.en.formTitle,
      });
      const verify = await enterAndVerify(user);
      expect(completePhone).toHaveBeenCalledExactlyOnceWith(
        "en",
        returnTo,
        true,
      );
      const fallback =
        replacement === "quote unavailable" ? (
          <BookingQuoteView
            locale="en"
            slug={quote.slug}
            queryString={queryString}
            result={{ status: "unavailable" }}
            discoveryQuery={discoveryQuery}
            idempotencyKey="11111111-1111-4111-8111-111111111111"
            customerReady
            bookingRequestUiPolicy={null}
            bookingRequestAcceptanceEvidence={null}
          />
        ) : (
          <NotFoundScreen locale="en" />
        );
      await act(async () => rerender(await requestFrame(fallback)));
      expect(verify).not.toBeInTheDocument();
      expect(
        screen.getByRole("region", {
          name: bookingRequestMessages.en.formTitle,
        }),
      ).toBe(frame);
      expect(frame.isConnected).toBe(true);
      expect(frame).toHaveFocus();
      await act(async () => resolveCompletion({ status: "completed" }));
      expect(
        screen.getByRole("region", {
          name: bookingRequestMessages.en.formTitle,
        }),
      ).toBe(frame);
      expect(frame.isConnected).toBe(true);
      expect(frame).toHaveFocus();
      if (replacement === "quote unavailable")
        expect(screen.getByRole("alert")).toHaveTextContent(
          bookingQuoteMessages.en.unavailable,
        );
      else
        expect(
          screen.getByRole("heading", { name: messages.en.notFoundTitle }),
        ).toBeVisible();
      expect(submitBookingRequest).not.toHaveBeenCalled();
    },
  );

  it("submits the accepted immutable intent and shows the Pending receipt", async () => {
    submitBookingRequest.mockResolvedValue({
      status: "pending",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    });
    const user = userEvent.setup();
    render(
      <BookingRequestForm
        customerReady
        discoveryQuery={{
          from: "2099-08-21",
          to: "2099-08-21",
          guests: 4,
          amenities: [],
          selections: [
            { serviceDay: "2099-08-21", kind: "shift", position: 2 },
          ],
        }}
        idempotencyKey="11111111-1111-4111-8111-111111111111"
        locale="en"
        quote={quote}
        {...policyProps("en")}
      />,
    );

    await user.type(screen.getByLabelText("Customer name"), "Ava Hassan");
    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "5");
    await user.type(
      screen.getByLabelText(/Booking Note \(optional\)/),
      "Garden seating, please.",
    );
    await user.click(
      screen.getByLabelText(/accept the preserved House Rules/i),
    );
    await user.click(screen.getByLabelText(/accept the cancellation policy/i));
    await user.click(
      screen.getByLabelText(/accept the marketplace booking terms/i),
    );
    await user.click(screen.getByLabelText(/inside-48-hours no-refund rule/i));
    const form = screen
      .getByRole("button", { name: "Send Booking Request" })
      .closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(submitBookingRequest).toHaveBeenCalledTimes(1);
    await screen.findByRole("heading", { name: "Booking Request pending" });

    expect(submitBookingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        customerName: "Ava Hassan",
        partySize: 5,
        bookingNote: "Garden seating, please.",
        discoveryQuery: expect.objectContaining({ guests: 5 }),
        displayedQuote: expect.objectContaining({
          fingerprint: "a".repeat(64),
          customerTotalIqd: 105_003,
        }),
        acceptanceEvidence: policyProps("en").acceptanceEvidence,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Booking Request pending" }),
    ).toBeInTheDocument();
    expect(screen.getByText("RC-REQ-AAAAAAAAAAAAAAAA")).toBeInTheDocument();
  });

  it("submits the enquiry the customer explicitly selected", async () => {
    submitBookingRequest.mockResolvedValue({ status: "invalid" });
    const user = userEvent.setup();
    const { container } = render(
      <BookingRequestForm
        customerReady
        discoveryQuery={{
          from: "2099-08-21",
          to: "2099-08-21",
          guests: 4,
          amenities: [],
          selections: [
            { serviceDay: "2099-08-21", kind: "shift", position: 2 },
          ],
        }}
        idempotencyKey="11111111-1111-4111-8111-111111111111"
        locale="en"
        quote={quote}
        enquiryOptions={[
          {
            conversationId: "22222222-2222-4222-8222-222222222222",
            label: "Existing garden enquiry",
          },
        ]}
        {...policyProps("en")}
      />,
    );
    await user.click(screen.getByLabelText(/Existing garden enquiry/));
    fireEvent.submit(container.querySelector("form")!);
    await vi.waitFor(() =>
      expect(submitBookingRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "22222222-2222-4222-8222-222222222222",
        }),
      ),
    );
  });

  it("preserves the validated enquiry selected before the booking form opens", async () => {
    submitBookingRequest.mockResolvedValue({ status: "invalid" });
    const selectedConversationId = "22222222-2222-4222-8222-222222222222";
    const { container } = render(
      <BookingRequestForm
        customerReady
        discoveryQuery={{
          from: "2099-08-21",
          to: "2099-08-21",
          guests: 4,
          amenities: [],
          selections: [
            { serviceDay: "2099-08-21", kind: "shift", position: 2 },
          ],
        }}
        idempotencyKey="11111111-1111-4111-8111-111111111111"
        locale="en"
        quote={quote}
        enquiryOptions={[
          {
            conversationId: selectedConversationId,
            label: "Existing garden enquiry",
          },
        ]}
        selectedConversationId={selectedConversationId}
        {...policyProps("en")}
      />,
    );

    expect(screen.getByLabelText(/Existing garden enquiry/)).toBeChecked();
    fireEvent.submit(container.querySelector("form")!);
    await vi.waitFor(() =>
      expect(submitBookingRequest).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: selectedConversationId }),
      ),
    );
  });

  it("shows inline phone verification instead of an unauthenticated submit button", () => {
    render(
      <BookingRequestForm
        customerReady={false}
        discoveryQuery={{
          from: "2099-08-21",
          to: "2099-08-21",
          guests: 4,
          amenities: [],
          selections: [
            { serviceDay: "2099-08-21", kind: "shift", position: 2 },
          ],
        }}
        idempotencyKey="11111111-1111-4111-8111-111111111111"
        locale="en"
        quote={quote}
        {...policyProps("en")}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Verify your phone to continue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send Booking Request" }),
    ).not.toBeInTheDocument();
  });

  it.each(["en", "ar", "ckb"] satisfies Locale[])(
    "shows the %s non-reservation warning only before Pending",
    async (locale) => {
      submitBookingRequest.mockResolvedValue({
        status: "pending",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
        responseDeadline: "2099-08-21T21:00:00.000Z",
      });
      const { container } = render(
        <BookingRequestForm
          customerReady
          discoveryQuery={{
            from: "2099-08-21",
            to: "2099-08-21",
            guests: 4,
            amenities: [],
            selections: [
              { serviceDay: "2099-08-21", kind: "shift", position: 2 },
            ],
          }}
          idempotencyKey="11111111-1111-4111-8111-111111111111"
          locale={locale}
          quote={quote}
          {...policyProps(locale)}
        />,
      );

      expect(
        screen.getByText(bookingQuoteMessages[locale].notice),
      ).toBeInTheDocument();
      const form = container.querySelector("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form!);
      expect(
        await screen.findByRole("heading", {
          name: bookingRequestMessages[locale].pendingTitle,
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(bookingQuoteMessages[locale].notice),
      ).not.toBeInTheDocument();
    },
  );

  it.each(["en", "ar", "ckb"] satisfies Locale[])(
    "renders its enquiry choice and acceptances through the shared controls in %s",
    (locale) => {
      render(
        <BookingRequestForm
          customerReady
          discoveryQuery={{
            from: "2099-08-21",
            to: "2099-08-21",
            guests: 4,
            amenities: [],
            selections: [
              { serviceDay: "2099-08-21", kind: "shift", position: 2 },
            ],
          }}
          idempotencyKey="11111111-1111-4111-8111-111111111111"
          locale={locale}
          quote={quote}
          {...policyProps(locale)}
        />,
      );

      const radios = screen.getAllByRole("radio");
      const checkboxes = screen.getAllByRole("checkbox");
      expect(radios).toHaveLength(1);
      expect(checkboxes).toHaveLength(4);
      for (const radio of radios) {
        expect(radio.parentElement).toBe(radio.closest("label.choice-control"));
        expect(radio.closest("fieldset.option-group-stack")).not.toBeNull();
      }
      for (const checkbox of checkboxes) {
        expect(checkbox.parentElement).toBe(
          checkbox.closest("label.choice-control"),
        );
        expect(checkbox).toBeRequired();
      }
    },
  );
});

it("BookingRequestForm displays Sorani booking terms with Eastern digits without changing acceptance evidence", async () => {
  submitBookingRequest.mockResolvedValue({ status: "invalid" });
  for (const [
    locale,
    cancellationPolicy,
    inside48Warning,
    inside48Acceptance,
  ] of [
    [
      "ckb",
      "هەڵوەشاندنەوە لانیکەم 48 کاتژمێر پێش شەفت پارەکە بە تەواوی دەگەڕێنێتەوە. لە ناو 48 کاتژمێر یان نەهاتندا پارە ناگەڕێتەوە.",
      "ئەم داواکارییە لە ناو 48 کاتژمێردا دەست پێدەکات و دوای پەسەندکردن پارەکە ناگەڕێتەوە.",
      "یاسای نەگەڕاندنەوەی پارە لە ناو 48 کاتژمێردا قبوڵ دەکەم.",
    ],
    [
      "en",
      "Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.",
      "This request begins inside 48 hours and will be non-refundable immediately if accepted.",
      "I understand and accept the inside-48-hours no-refund rule.",
    ],
    [
      "ar",
      "الإلغاء قبل 48 ساعة على الأقل يعيد المبلغ كاملاً. لا استرداد عند الإلغاء خلال 48 ساعة أو عدم الحضور.",
      "يبدأ هذا الطلب خلال 48 ساعة وسيصبح غير قابل للاسترداد فور قبوله.",
      "أفهم وأوافق على عدم الاسترداد خلال 48 ساعة.",
    ],
  ] as const) {
    const evidence = Object.freeze({
      ...policyProps(locale).acceptanceEvidence,
      cancellationPolicy,
      inside48Warning,
      inside48Acceptance,
    });
    const { container, unmount } = render(
      <BookingRequestForm
        customerReady
        locale={locale}
        quote={quote}
        discoveryQuery={discoveryQuery}
        idempotencyKey="11111111-1111-4111-8111-111111111111"
        uiPolicy={uiPolicy}
        acceptanceEvidence={evidence}
      />,
    );
    const displayed =
      locale === "ckb"
        ? [
            "هەڵوەشاندنەوە لانیکەم ٤٨ کاتژمێر پێش شەفت پارەکە بە تەواوی دەگەڕێنێتەوە. لە ناو ٤٨ کاتژمێر یان نەهاتندا پارە ناگەڕێتەوە.",
            "ئەم داواکارییە لە ناو ٤٨ کاتژمێردا دەست پێدەکات و دوای پەسەندکردن پارەکە ناگەڕێتەوە.",
            "یاسای نەگەڕاندنەوەی پارە لە ناو ٤٨ کاتژمێردا قبوڵ دەکەم.",
          ]
        : [cancellationPolicy, inside48Warning, inside48Acceptance];
    for (const text of displayed) expect(screen.getByText(text)).toBeVisible();
    const checkbox = screen.getByRole("checkbox", { name: displayed[2] });
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.submit(container.querySelector("form")!);
    await vi.waitFor(() =>
      expect(
        submitBookingRequest.mock.calls.at(-1)?.[0].acceptanceEvidence,
      ).toBe(evidence),
    );
    expect(policyProps(locale).acceptanceEvidence).toEqual(evidence);
    expect(evidence).toMatchObject({
      cancellationPolicy,
      inside48Warning,
      inside48Acceptance,
    });
    unmount();
  }
});

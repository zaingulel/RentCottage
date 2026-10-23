import { afterEach, expect, it, vi } from "vitest";

const { requestClient, serviceClient, supplierTranslate, refresh, revalidate } =
  vi.hoisted(() => ({
    requestClient: vi.fn(),
    serviceClient: vi.fn(),
    supplierTranslate: vi.fn(),
    refresh: vi.fn(),
    revalidate: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: requestClient,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: serviceClient }));
vi.mock("next/cache", () => ({ refresh, revalidatePath: revalidate }));
vi.mock("@/messaging/deterministic-message-translation", () => ({
  createDeterministicMessageTranslationAdapter: () => ({
    translate: supplierTranslate,
  }),
}));

import RequestPage from "@/app/[locale]/request/[slug]/page";
import OwnerCottagesPage from "@/app/[locale]/owner/cottages/page";
import { createRequestCustomerReview } from "@/customer-review/request-customer-review";
import { createRequestReviewTranslation } from "@/customer-review/request-review-translation";
import { createRequestMessagingRuntime } from "@/messaging/request-messaging-runtime";
import { retryPaidConfirmationNotification } from "@/notification/notification-actions";
import { loadRequestNotificationStatus } from "@/notification/request-notification-status";
import { submitBookingRequest } from "./actions";
import { manageConfirmedBooking } from "./booking-management-actions";
import { loadBookingFinancialView } from "./request-booking-financial-view";
import { loadBookingHistory } from "./request-booking-history";
import { loadConfirmedBookingAccess } from "./request-confirmed-booking-access";
import { loadCustomerBookingRequest } from "./request-customer-booking-request";
import {
  loadOwnerBookingRequest,
  loadOwnerBookingRequestNotifications,
} from "./request-owner-booking-request-notifications";

const reference = "RC-REQ-AAAAAAAAAAAAAAAA";
const userId = "11111111-1111-4111-8111-111111111111";
const receiptId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const slug = "cottage-00000000000040008000000000000029";
const hostedEnvironment = {
  APP_ENVIRONMENT: "preview",
  HOSTED_DEMO: "true",
  SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
  SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
  SUPABASE_SECRET_KEY: "fixture-secret",
  PRIVILEGED_AUDIT_HMAC_KEY: "fixture-audit-key-with-at-least-32-characters",
  DEPLOYMENT_COMMIT: "cccccccccccccccccccccccccccccccccccccccc",
};
const history = {
  bookingRequestId: userId,
  bookingRequestReference: reference,
  bookingReference: null,
  cottageName: "Fictional cottage",
  createdAt: "2099-08-20T10:00:00Z",
  firstStartsAt: "2099-08-21T10:00:00Z",
  lastEndsAt: "2099-08-21T16:00:00Z",
  status: "pending",
  actorRole: "customer",
};
const originalMessage = {
  messageId,
  senderRole: "customer",
  originalLanguage: "en",
  originalBody: "Is the garden available?",
  contactProtected: true,
  translations: [],
  sentAt: "2099-08-20T10:00:00Z",
};

function retryForm() {
  const form = new FormData();
  form.set("locale", "en");
  form.set("reference", reference);
  form.set("receiptId", receiptId);
  return form;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("hosted journeys preserve authenticated readers and original-text fallback", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(
      new Error("Composition must not contact a supplier or database"),
    );
  const responses: Record<string, { data: unknown; error: unknown }> = {
    list_booking_history: { data: [history], error: null },
    get_booking_financial_view: { data: null, error: { code: "42501" } },
    get_customer_booking_request_presentation: { data: null, error: null },
    list_owner_booking_request_notifications: { data: [], error: null },
    get_confirmed_booking_access_presentation: { data: null, error: null },
    list_booking_request_notification_status: { data: [], error: null },
    retry_booking_confirmation_notification: {
      data: { status: "queued" },
      error: null,
    },
    get_customer_review: { data: null, error: { code: "42501" } },
    list_owner_cottage_profiles: { data: [], error: null },
    get_messaging_conversation: {
      data: {
        conversationId,
        cottage: {
          profileId: userId,
          name: "Fictional cottage",
          publicSlug: slug,
        },
        actorRole: "customer",
        sendRestriction: null,
        createdAt: "2099-08-20T10:00:00Z",
        canContinueBookingRequest: true,
        booking: null,
        bookingHistory: [],
        messageCount: 1,
        messages: [originalMessage],
        nextMessageCursor: null,
      },
      error: null,
    },
  };
  const rpc = vi.fn((name: string) => {
    if (!Object.hasOwn(responses, name)) {
      throw new Error(`Unexpected authenticated RPC: ${name}`);
    }
    const result = Promise.resolve(responses[name]!);
    return Object.assign(result, { abortSignal: () => result });
  });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  const account = {
    user_id: userId,
    role: "cottage_owner",
    owner_approval_state: "approved",
  };
  const maybeSingle = vi.fn(async () => ({ data: account, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    expect(table).toBe("account_contexts");
    return { select };
  });
  const identity = { auth: { getUser }, rpc, from };
  const privilegedRpc = vi
    .fn()
    .mockRejectedValue(
      new Error("Participant reads must not use a service client"),
    );
  requestClient.mockResolvedValue(identity);
  serviceClient.mockReturnValue({ rpc: privilegedRpc });

  for (const patch of [
    {},
    { HOSTED_DEMO: undefined },
    { HOSTED_DEMO: "false" },
    { APP_ENVIRONMENT: "production" },
    { SUPABASE_PROJECT_REF: "other-project" },
    { SUPABASE_SECRET_KEY: undefined },
  ]) {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries({
      ...hostedEnvironment,
      ...patch,
    })) {
      vi.stubEnv(key, value);
    }
    const admitted = Object.keys(patch).length === 0;

    await expect(loadBookingHistory("customer")).resolves.toEqual(
      admitted ? [history] : undefined,
    );
    await expect(
      loadBookingFinancialView(reference, "customer"),
    ).resolves.toBeNull();
    await expect(loadCustomerBookingRequest(reference)).resolves.toBe(
      admitted ? null : undefined,
    );
    await expect(loadOwnerBookingRequestNotifications()).resolves.toEqual(
      admitted ? [] : undefined,
    );
    await expect(loadOwnerBookingRequest(reference)).resolves.toBe(
      admitted ? null : undefined,
    );
    await expect(loadConfirmedBookingAccess(reference)).resolves.toBe(
      admitted ? null : undefined,
    );
    await expect(
      loadRequestNotificationStatus(reference, "customer"),
    ).resolves.toEqual(
      admitted
        ? { status: "available", notices: [] }
        : { status: "unavailable" },
    );
    await expect(submitBookingRequest({})).resolves.toEqual({
      status: admitted ? "invalid" : "payment-unavailable",
    });
    await expect(
      manageConfirmedBooking({ status: "idle" }, new FormData()),
    ).resolves.toEqual({
      status: admitted ? "invalid" : "unavailable",
    });
    await expect(
      retryPaidConfirmationNotification({ status: "idle" }, retryForm()),
    ).resolves.toEqual({
      status: admitted ? "queued" : "unavailable",
    });
    const review = await createRequestCustomerReview();
    if (admitted) {
      expect(await review?.authenticatedUserId()).toBe(userId);
      expect(await review?.getOwn(reference)).toEqual({
        status: "access-required",
      });
      for (const [name, parameters] of [
        ["list_booking_history", { target_actor_role: "customer" }],
        [
          "get_booking_financial_view",
          { target_reference: reference, target_actor_role: "customer" },
        ],
        [
          "get_customer_booking_request_presentation",
          { target_reference: reference },
        ],
        [
          "get_confirmed_booking_access_presentation",
          { target_reference: reference },
        ],
        [
          "list_booking_request_notification_status",
          { target_reference: reference, target_actor_role: "customer" },
        ],
        [
          "retry_booking_confirmation_notification",
          { target_receipt_id: receiptId },
        ],
        ["get_customer_review", { target_reference: reference }],
      ]) {
        expect(rpc).toHaveBeenCalledWith(name, parameters);
      }
      expect(rpc).toHaveBeenCalledWith(
        "list_owner_booking_request_notifications",
      );
    } else {
      expect(review).toBeUndefined();
      expect(requestClient).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    }
    expect(createRequestReviewTranslation()).toBeUndefined();

    const runtime = await createRequestMessagingRuntime();
    expect(runtime.enabled).toBe(admitted);
    expect(await runtime.translation.translate(messageId, "ar")).toEqual({
      status: "unavailable",
    });
    expect(supplierTranslate).not.toHaveBeenCalled();
    expect(privilegedRpc).not.toHaveBeenCalled();
    if (admitted) {
      const conversation = await runtime.reader.getConversation({
        conversationId,
        limit: 50,
      });
      expect(conversation.messages).toEqual([originalMessage]);
    }

    const requestPage = await RequestPage({
      params: Promise.resolve({ locale: "en", slug }),
      searchParams: Promise.resolve({ from: "invalid" }),
    });
    expect(requestPage.type === "main").toBe(!admitted);

    rpc.mockClear();
    const ownerPage = await OwnerCottagesPage({
      params: Promise.resolve({ locale: "en" }),
    });
    expect(ownerPage).toMatchObject({
      props: {
        children: expect.arrayContaining([
          expect.objectContaining({
            props: expect.objectContaining({
              notifications: admitted ? [] : undefined,
            }),
          }),
        ]),
      },
    });
    if (admitted) {
      expect(rpc).toHaveBeenCalledWith(
        "list_owner_booking_request_notifications",
      );
    } else {
      expect(rpc).not.toHaveBeenCalledWith(
        "list_owner_booking_request_notifications",
      );
    }
    expect(rpc.mock.contexts.every((client) => client === identity)).toBe(true);
    expect(privilegedRpc).not.toHaveBeenCalled();
  }

  for (const [key, value] of Object.entries(hostedEnvironment))
    vi.stubEnv(key, value);
  responses.list_booking_history = {
    data: [{ ...history, actorRole: "platform_administrator" }],
    error: null,
  };
  await expect(loadBookingHistory("customer")).rejects.toThrow(
    "Booking History data is invalid",
  );
  responses.get_booking_financial_view = {
    data: { audit: "private" },
    error: null,
  };
  await expect(loadBookingFinancialView(reference, "customer")).rejects.toThrow(
    "Invalid financial view binding",
  );
  responses.get_customer_booking_request_presentation = {
    data: { private: "unprojected" },
    error: null,
  };
  await expect(loadCustomerBookingRequest(reference)).rejects.toThrow(
    "Booking Request status data is invalid",
  );
  responses.get_confirmed_booking_access_presentation = {
    data: { exactAddress: "unprojected" },
    error: null,
  };
  await expect(loadConfirmedBookingAccess(reference)).rejects.toThrow(
    "Confirmed Booking access data is invalid",
  );
  responses.list_owner_booking_request_notifications = {
    data: [{}],
    error: null,
  };
  await expect(loadOwnerBookingRequestNotifications()).rejects.toThrow(
    "Owner Booking Request notification data is invalid",
  );
  responses.list_booking_request_notification_status = {
    data: [{}],
    error: null,
  };
  await expect(
    loadRequestNotificationStatus(reference, "customer"),
  ).resolves.toEqual({ status: "unavailable" });
  responses.get_customer_review = {
    data: { private: "unprojected" },
    error: null,
  };
  expect(
    await (await createRequestCustomerReview())?.getOwn(reference),
  ).toEqual({ status: "unavailable" });
  expect(fetch).not.toHaveBeenCalled();
});

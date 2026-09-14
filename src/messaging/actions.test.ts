import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRuntime, start, open, send, translate, report } = vi.hoisted(
  () => ({
    createRuntime: vi.fn(),
    start: vi.fn(),
    open: vi.fn(),
    send: vi.fn(),
    translate: vi.fn(),
    report: vi.fn(),
  }),
);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./request-messaging-runtime", () => ({
  createRequestMessagingRuntime: createRuntime,
}));

import {
  openBookingMessagingConversation,
  reportMessagingTranslation,
  sendMessagingMessage,
  startMessagingConversation,
  translateMessagingMessage,
} from "./actions";

describe("messaging server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRuntime.mockResolvedValue({
      enabled: false,
      messaging: {
        createConversationForCottage: start,
        openBookingConversation: open,
        send,
      },
      translation: { translate, report },
    });
  });

  it("keeps every messaging mutation disconnected outside the permitted local-test runtime", async () => {
    const commandId = "11111111-1111-4111-8111-111111111111";
    const conversationId = "22222222-2222-4222-8222-222222222222";
    const messageId = "33333333-3333-4333-8333-333333333333";
    const translationId = "44444444-4444-4444-8444-444444444444";

    await expect(
      startMessagingConversation({
        publicSlug: "cottage-0123456789abcdef0123456789abcdef",
        commandId,
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      openBookingMessagingConversation({
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        commandId,
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      sendMessagingMessage({
        locale: "en",
        conversationId,
        commandId,
        originalLanguage: "ar",
        originalBody: "رسالة اختبارية",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      translateMessagingMessage({
        locale: "en",
        messageId,
        targetLanguage: "en",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      reportMessagingTranslation({
        translationId,
        commandId,
        category: "incorrect",
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(createRuntime).toHaveBeenCalledTimes(5);
    expect(start).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});

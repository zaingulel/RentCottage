import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push, refresh, send, translate, report } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  send: vi.fn(),
  translate: vi.fn(),
  report: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/messaging/actions", () => ({
  sendMessagingMessage: send,
  translateMessagingMessage: translate,
  reportMessagingTranslation: report,
}));

import type { MessagingConversation as Conversation } from "@/messaging/supabase-messaging-reader";
import { MessagingConversation } from "./messaging-conversation";

const conversation: Conversation = {
  conversationId: "33333333-3333-4333-8333-333333333333",
  cottage: {
    profileId: "22222222-2222-4222-8222-222222222222",
    name: "Fictional Garden Cottage",
    publicSlug: "cottage-0123456789abcdef0123456789abcdef",
  },
  actorRole: "customer",
  createdAt: "2099-08-20T12:00:00.000Z",
  canContinueBookingRequest: true,
  booking: null,
  bookingHistory: [],
  messageCount: 1,
  messages: [
    {
      messageId: "55555555-5555-4555-8555-555555555555",
      senderRole: "cottage_owner",
      originalLanguage: "ar",
      originalBody: "هل يمكننا استخدام الحديقة؟",
      contactProtected: true,
      translations: [
        {
          translationId: "66666666-6666-4666-8666-666666666666",
          targetLanguage: "en",
          translatedBody: "Could we use the garden?",
          provider: "fictional-local-test",
          model: "deterministic-pairs-v1",
          promptVersion: "message-pairs-v1",
        },
      ],
      sentAt: "2099-08-20T12:01:00.000Z",
    },
  ],
  nextMessageCursor: null,
};

describe("Messaging conversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("labels saved fictional translation and exposes the original", async () => {
    const user = userEvent.setup();
    render(<MessagingConversation locale="en" conversation={conversation} />);
    expect(screen.getByText("Could we use the garden?")).toBeInTheDocument();
    expect(
      screen.getByText(/Fictional local-test translation/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View original" }));
    expect(screen.getByText("هل يمكننا استخدام الحديقة؟")).toBeInTheDocument();
    expect(
      screen.queryByText(/Fictional local-test translation/),
    ).not.toBeInTheDocument();
  });

  it("keeps validated stay context through booking, inbox, paging, and language links", () => {
    const contextQuery =
      "from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1";
    render(
      <MessagingConversation
        locale="en"
        conversation={{ ...conversation, nextMessageCursor: 7 }}
        beforePosition={9}
        contextQuery={contextQuery}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Booking request" }),
    ).toHaveAttribute(
      "href",
      `/en/request/${conversation.cottage.publicSlug}?${contextQuery}&conversation=${conversation.conversationId}`,
    );
    expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute(
      "href",
      `/en/messages?cottage=${conversation.cottage.publicSlug}&${contextQuery}`,
    );
    expect(
      screen.getByRole("link", { name: "Older messages" }),
    ).toHaveAttribute(
      "href",
      `/en/messages/${conversation.conversationId}?before=7&${contextQuery}`,
    );
    expect(screen.getByRole("link", { name: "العربية" })).toHaveAttribute(
      "href",
      `/ar/messages/${conversation.conversationId}?before=9&${contextQuery}`,
    );
  });

  it("keeps the original visible when translation is unavailable", async () => {
    const user = userEvent.setup();
    translate.mockResolvedValue({ status: "unavailable" });
    render(
      <MessagingConversation
        locale="en"
        conversation={{
          ...conversation,
          messages: [{ ...conversation.messages[0], translations: [] }],
        }}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Automatic translation" }),
    );
    expect(screen.getByText("هل يمكننا استخدام الحديقة؟")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Translation is unavailable. Showing the original.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps one send key for unchanged retry and rotates it when intent changes", async () => {
    const user = userEvent.setup();
    send.mockResolvedValue({ status: "unavailable" });
    render(<MessagingConversation locale="en" conversation={conversation} />);
    const textbox = screen.getByRole("textbox", { name: "Message" });
    await user.type(textbox, "First draft");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(send.mock.calls[0]?.[0].commandId).toBe(
      send.mock.calls[1]?.[0].commandId,
    );
    await user.type(textbox, " changed");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(send.mock.calls[2]?.[0].commandId).not.toBe(
      send.mock.calls[1]?.[0].commandId,
    );
  });

  it("keeps the draft immutable while its send is pending", async () => {
    const user = userEvent.setup();
    let finish!: (value: { status: "sent"; messageId: string }) => void;
    send.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<MessagingConversation locale="en" conversation={conversation} />);
    const textbox = screen.getByRole("textbox", { name: "Message" });
    await user.type(textbox, "Protected pending draft");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(textbox).toBeDisabled();
    expect(textbox).toHaveValue("Protected pending draft");
    await act(async () =>
      finish({
        status: "sent",
        messageId: "77777777-7777-4777-8777-777777777777",
      }),
    );
    expect(textbox).toHaveValue("");
  });

  it("reuses a report command after failure and prevents a duplicate while pending", async () => {
    const user = userEvent.setup();
    report.mockResolvedValue({ status: "unavailable" });
    render(<MessagingConversation locale="en" conversation={conversation} />);
    const button = screen.getByRole("button", {
      name: "Report poor translation",
    });
    await user.click(button);
    await user.click(button);
    expect(report.mock.calls[0]?.[0].commandId).toBe(
      report.mock.calls[1]?.[0].commandId,
    );

    let finish!: (value: { status: "reported"; reportId: string }) => void;
    report.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(report).toHaveBeenCalledTimes(3);
    expect(report.mock.calls[2]?.[0].commandId).toBe(
      report.mock.calls[0]?.[0].commandId,
    );
    await act(async () =>
      finish({
        status: "reported",
        reportId: "88888888-8888-4888-8888-888888888888",
      }),
    );
    expect(button).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Translation reported.",
    );
  });

  it("keeps support and closed journeys read-only", () => {
    const { rerender } = render(
      <MessagingConversation
        locale="en"
        conversation={{ ...conversation, actorRole: "platform_administrator" }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Report poor translation" }),
    ).not.toBeInTheDocument();
    rerender(
      <MessagingConversation
        locale="en"
        conversation={{
          ...conversation,
          booking: {
            bookingRequestReference: "RC-REQ-0123456789ABCDEF",
            requestStatus: "accepted",
            paymentStatus: "paid-confirmed",
            responseDeadline: "2099-08-20T12:00:00.000Z",
            firstStartsAt: "2099-08-21T12:00:00.000Z",
            lastEndsAt: "2099-08-21T15:00:00.000Z",
            writingClosesAt: "2099-09-20T15:00:00.000Z",
            writingClosed: true,
            contactAllowed: true,
          },
        }}
      />,
    );
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).not.toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { push, start } = vi.hoisted(() => ({ push: vi.fn(), start: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/messaging/actions", () => ({ startMessagingConversation: start }));
import { MessagingStart } from "./messaging-start";

describe("Messaging start", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    [
      "en",
      "Start an independent new enquiry",
      "Your customer access is suspended. You can read existing conversations, but cannot start a conversation or send messages.",
    ],
    [
      "ar",
      "بدء استفسار جديد مستقل",
      "صلاحية العميل لديك معلقة. يمكنك قراءة المحادثات السابقة، لكن لا يمكنك بدء محادثة أو إرسال رسائل.",
    ],
    [
      "ckb",
      "دەستپێکردنی پرسیارێکی نوێ و سەربەخۆ",
      "دەسەڵاتی کڕیاریی تۆ ڕاگیراوە. دەتوانیت گفتوگۆکانی پێشوو بخوێنیتەوە، بەڵام ناتوانیت گفتوگۆیەک دەست پێ بکەیت یان نامە بنێریت.",
    ],
  ] as const)(
    "explains suspended customer entry in %s",
    async (locale, label, explanation) => {
      start.mockResolvedValue({ status: "suspended" });
      const user = userEvent.setup();
      render(
        <MessagingStart
          locale={locale}
          publicSlug="cottage-0123456789abcdef0123456789abcdef"
        />,
      );
      await user.click(screen.getByRole("button", { name: label }));
      expect(await screen.findByRole("alert")).toHaveTextContent(explanation);
      expect(push).not.toHaveBeenCalled();
    },
  );
});

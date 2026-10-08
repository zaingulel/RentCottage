import { describe, expect, it } from "vitest";

import {
  isCustomerReviewBodyWithinLimit,
  isSubmitCustomerReviewReplyInput,
} from "./customer-review";

describe("customer review body validation", () => {
  it("matches the database character limit for supplementary Unicode characters", () => {
    expect(isCustomerReviewBodyWithinLimit("🏡".repeat(2000))).toBe(true);
    expect(isCustomerReviewBodyWithinLimit("🏡".repeat(2001))).toBe(false);
  });

  it("stops examining an oversized body after the first disallowed code point", () => {
    const hostileBody = "🏡".repeat(1_000_000);
    const originalIterator = String.prototype[Symbol.iterator];
    let observedCodePoints = 0;
    let result: boolean | undefined;

    String.prototype[Symbol.iterator] = function* observedStringIterator() {
      for (const codePoint of originalIterator.call(this)) {
        observedCodePoints += 1;
        if (observedCodePoints > 2001) {
          throw new Error(
            "review validation examined beyond 2,001 code points",
          );
        }
        yield codePoint;
      }
      return undefined;
    };

    try {
      result = isCustomerReviewBodyWithinLimit(hostileBody);
    } finally {
      String.prototype[Symbol.iterator] = originalIterator;
    }

    expect(result).toBe(false);
    expect(observedCodePoints).toBe(2001);
  });
});

describe("customer review reply validation", () => {
  const validReply = {
    bookingRequestReference: "RC-REQ-0123456789ABCDEF",
    originalLanguage: "ar",
    originalBody: "شكراً لزيارتكم",
  };

  it("rejects a reply with unknown keys, a blank body or a body above the database limit", () => {
    expect(isSubmitCustomerReviewReplyInput(validReply)).toBe(true);
    expect(
      isSubmitCustomerReviewReplyInput({
        ...validReply,
        originalBody: "🏡".repeat(2000),
      }),
    ).toBe(true);

    for (const rejected of [
      { ...validReply, authorUserId: "77777777-7777-4777-8777-777777777777" },
      { ...validReply, rating: 5 },
      {
        bookingRequestReference: validReply.bookingRequestReference,
        originalLanguage: validReply.originalLanguage,
      },
      { ...validReply, originalBody: "" },
      { ...validReply, originalBody: "   \n\t " },
      { ...validReply, originalBody: null },
      { ...validReply, originalBody: "🏡".repeat(2001) },
      { ...validReply, originalLanguage: "fr" },
      { ...validReply, bookingRequestReference: "not-a-reference" },
    ]) {
      expect(isSubmitCustomerReviewReplyInput(rejected)).toBe(false);
    }
  });
});

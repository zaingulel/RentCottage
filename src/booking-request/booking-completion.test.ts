import { describe, expect, it, vi } from "vitest";

import {
  createBookingCompletion,
  type BookingCompletionCandidate,
} from "./booking-completion";

const candidate: BookingCompletionCandidate = {
  bookingRequestId: "60000000-0000-4000-8000-000000003901",
  action: "complete",
  revision: "a".repeat(32),
  effectivePeriodEnd: "2099-08-24T18:00:00.000Z",
  observedAt: "2099-08-24T18:00:00.000Z",
};

describe("booking completion application", () => {
  it("commits each database-admitted candidate with its exact revision", async () => {
    const complete = vi.fn().mockResolvedValue({
      status: "completed",
      bookingRequestId: candidate.bookingRequestId,
      effectivePeriodEnd: candidate.effectivePeriodEnd,
      completedAt: candidate.observedAt,
    });
    const application = createBookingCompletion({
      due: vi.fn().mockResolvedValue([candidate]),
      complete,
      assessMaturity: vi.fn(),
    });

    await expect(application.processDue(50)).resolves.toEqual([
      {
        status: "completed",
        bookingRequestId: candidate.bookingRequestId,
        effectivePeriodEnd: candidate.effectivePeriodEnd,
        completedAt: candidate.observedAt,
      },
    ]);
    expect(complete).toHaveBeenCalledExactlyOnceWith(candidate);
  });

  it("keeps database exclusions visible instead of reporting false completion", async () => {
    const application = createBookingCompletion({
      due: vi.fn().mockResolvedValue([candidate]),
      complete: vi.fn().mockResolvedValue({
        status: "ineligible",
        bookingRequestId: candidate.bookingRequestId,
      }),
      assessMaturity: vi.fn(),
    });

    await expect(application.processDue(50)).resolves.toEqual([
      { status: "ineligible", bookingRequestId: candidate.bookingRequestId },
    ]);
  });

  it("rejects an unbounded or invalid drain before reading candidates", async () => {
    const due = vi.fn();
    const application = createBookingCompletion({
      due,
      complete: vi.fn(),
      assessMaturity: vi.fn(),
    });

    await expect(application.processDue(0)).rejects.toThrow("between 1 and 50");
    await expect(application.processDue(51)).rejects.toThrow(
      "between 1 and 50",
    );
    expect(due).not.toHaveBeenCalled();
  });

  it("selects maturity assessment without rewriting a no-show as completed", async () => {
    const maturityCandidate = {
      ...candidate,
      action: "assess_maturity" as const,
    };
    const complete = vi.fn();
    const assessMaturity = vi.fn().mockResolvedValue({
      status: "matured",
      bookingRequestId: candidate.bookingRequestId,
      effectivePeriodEnd: candidate.effectivePeriodEnd,
      assessedAt: candidate.observedAt,
    });
    const application = createBookingCompletion({
      due: vi.fn().mockResolvedValue([maturityCandidate]),
      complete,
      assessMaturity,
    });

    await expect(application.processDue(50)).resolves.toMatchObject([
      { status: "matured" },
    ]);
    expect(assessMaturity).toHaveBeenCalledExactlyOnceWith(maturityCandidate);
    expect(complete).not.toHaveBeenCalled();
  });
});

export interface BookingCompletionCandidate {
  readonly bookingRequestId: string;
  readonly action: "complete" | "assess_maturity";
  readonly revision: string;
  readonly effectivePeriodEnd: string;
  readonly observedAt: string;
}

export type BookingCompletionResult =
  | {
      readonly status: "matured";
      readonly bookingRequestId: string;
      readonly effectivePeriodEnd: string;
      readonly assessedAt: string;
    }
  | {
      readonly status: "completed";
      readonly bookingRequestId: string;
      readonly effectivePeriodEnd: string;
      readonly completedAt: string;
    }
  | {
      readonly status: "ineligible";
      readonly bookingRequestId: string;
    };

export interface BookingCompletionRepository {
  due(limit: number): Promise<readonly BookingCompletionCandidate[]>;
  complete(
    candidate: BookingCompletionCandidate,
  ): Promise<BookingCompletionResult>;
  assessMaturity(
    candidate: BookingCompletionCandidate,
  ): Promise<BookingCompletionResult>;
}

export function createBookingCompletion(
  repository: BookingCompletionRepository,
) {
  return {
    async processDue(
      limit: number,
    ): Promise<readonly BookingCompletionResult[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        throw new RangeError(
          "Booking completion limit must be between 1 and 50.",
        );
      const candidates = await repository.due(limit);
      return Promise.all(
        candidates.map((candidate) =>
          candidate.action === "complete"
            ? repository.complete(candidate)
            : repository.assessMaturity(candidate),
        ),
      );
    },
  };
}

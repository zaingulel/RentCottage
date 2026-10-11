import { hasCustomerCapability } from "@/access/account-access";
import type { RequestAccount } from "@/access/request-account-context";
import type {
  LaunchLanguage,
  TranslationInput,
  TranslationOutcome,
} from "@/translation/translation";

export const reviewTranslationProvenance = {
  provider: "fictional-local-test",
  model: "deterministic-pairs-v1",
  promptVersion: "review-pairs-v1",
} as const;

export type ReviewTranslationSubject = "review" | "reply";

type TranslationRequest = Readonly<{
  reviewId: string;
  subject: ReviewTranslationSubject;
  targetLanguage: LaunchLanguage;
}>;

export type SavedReviewTranslation = Readonly<{
  status: "translated";
  translationId: string;
  translatedBody: string;
}>;

export type PreparedReviewTranslation = Readonly<{
  status: "prepared";
  originalLanguage: LaunchLanguage;
  originalBody: string;
}>;

export type ReviewTranslationFailure = Readonly<{
  status: "invalid" | "access-required" | "not-found" | "unavailable";
}>;

export type ReviewTranslationReportResult =
  | Readonly<{ status: "reported"; reportId: string }>
  | ReviewTranslationFailure;

export interface ReviewTranslationRepository {
  prepare(
    input: TranslationRequest & Readonly<{ actorUserId: string }>,
  ): Promise<
    | PreparedReviewTranslation
    | SavedReviewTranslation
    | ReviewTranslationFailure
  >;
  save(
    input: TranslationRequest &
      Readonly<{ actorUserId: string; translatedBody: string }>,
  ): Promise<
    | SavedReviewTranslation
    | ReviewTranslationFailure
    | Readonly<{ status: "blocked" }>
  >;
  report(
    input: Readonly<{ actorUserId: string; translationId: string }>,
  ): Promise<ReviewTranslationReportResult>;
}

export interface ReviewTranslationAdapter {
  translate(input: TranslationInput): Promise<TranslationOutcome>;
}

export function createReviewTranslation(input: {
  readonly repository: ReviewTranslationRepository;
  readonly adapter: ReviewTranslationAdapter;
  readonly account: () => Promise<RequestAccount>;
}) {
  // The actor is the signed-in account's own identifier; no caller supplies one.
  async function asSignedInReader<Result>(
    operation: (actorUserId: string) => Promise<Result>,
  ): Promise<Result | Readonly<{ status: "access-required" | "unavailable" }>> {
    try {
      const account = await input.account();
      if (account.status === "unavailable") return { status: "unavailable" };
      if (
        account.status !== "authenticated" ||
        !hasCustomerCapability(account.context)
      ) {
        return { status: "access-required" };
      }
      return await operation(account.context.userId);
    } catch {
      console.error("customer-review-translation-unavailable");
      return { status: "unavailable" };
    }
  }

  return {
    translate(request: TranslationRequest) {
      return asSignedInReader(
        async (
          actorUserId,
        ): Promise<
          | SavedReviewTranslation
          | ReviewTranslationFailure
          | Readonly<{ status: "blocked" }>
        > => {
          const { reviewId, subject, targetLanguage } = request;
          const prepared = await input.repository.prepare({
            actorUserId,
            reviewId,
            subject,
            targetLanguage,
          });
          if (prepared.status !== "prepared") return prepared;
          const outcome = await input.adapter.translate({
            sourceLanguage: prepared.originalLanguage,
            targetLanguage,
            segments: [
              { key: subject, kind: "review", text: prepared.originalBody },
            ],
          });
          if (outcome.status !== "completed") return { status: "unavailable" };
          const generated = outcome.segments[0];
          if (
            outcome.segments.length !== 1 ||
            generated?.key !== subject ||
            outcome.provenance.provider !==
              reviewTranslationProvenance.provider ||
            outcome.provenance.model !== reviewTranslationProvenance.model ||
            outcome.provenance.promptVersion !==
              reviewTranslationProvenance.promptVersion ||
            generated.text.trim().length < 1
          ) {
            return { status: "unavailable" };
          }
          return input.repository.save({
            actorUserId,
            reviewId,
            subject,
            targetLanguage,
            translatedBody: generated.text.trim(),
          });
        },
      );
    },
    report(request: Readonly<{ translationId: string }>) {
      return asSignedInReader((actorUserId) =>
        input.repository.report({
          actorUserId,
          translationId: request.translationId,
        }),
      );
    },
  };
}

import type { Locale } from "@/i18n/routing";
import type {
  TranslationInput,
  TranslationOutcome,
} from "@/translation/translation";

export const messageTranslationProvenance = {
  provider: "fictional-local-test",
  model: "deterministic-pairs-v1",
  promptVersion: "message-pairs-v1",
} as const;

export type SavedMessageTranslation = {
  readonly status: "translated";
  readonly translationId: string;
  readonly translatedBody: string;
  readonly targetLanguage: Locale;
  readonly provider: "fictional-local-test";
  readonly model: "deterministic-pairs-v1";
  readonly promptVersion: "message-pairs-v1";
};

export type PreparedMessageTranslation = {
  readonly status: "prepared";
  readonly messageId: string;
  readonly originalLanguage: Locale;
  readonly originalBody: string;
  readonly contactProtected: boolean;
};

export interface MessageTranslationRepository {
  prepare(input: {
    readonly actorUserId: string;
    readonly messageId: string;
    readonly targetLanguage: Locale;
  }): Promise<
    | PreparedMessageTranslation
    | SavedMessageTranslation
    | { status: "invalid" | "access-required" }
  >;
  save(input: {
    readonly actorUserId: string;
    readonly messageId: string;
    readonly targetLanguage: Locale;
    readonly translatedBody: string;
  }): Promise<
    | SavedMessageTranslation
    | { status: "invalid" | "access-required" | "blocked" }
  >;
  report(input: {
    readonly actorUserId: string;
    readonly translationId: string;
    readonly commandId: string;
    readonly category: "incorrect" | "unclear" | "inappropriate";
  }): Promise<
    | { readonly status: "reported"; readonly reportId: string }
    | { readonly status: "invalid" | "access-required" }
  >;
}

export interface MessageTranslationAdapter {
  translate(input: TranslationInput): Promise<TranslationOutcome>;
}

export function createMessageTranslation(input: {
  readonly repository: MessageTranslationRepository;
  readonly adapter: MessageTranslationAdapter;
  readonly enabled: boolean;
}) {
  return {
    async translate(request: {
      readonly actorUserId: string;
      readonly messageId: string;
      readonly targetLanguage: Locale;
    }): Promise<
      | SavedMessageTranslation
      | {
          readonly status:
            | "invalid"
            | "access-required"
            | "blocked"
            | "unavailable";
        }
    > {
      if (!input.enabled) return { status: "unavailable" };
      const prepared = await input.repository.prepare(request);
      if (prepared.status !== "prepared") return prepared;
      const segment = {
        key: "message",
        kind: "message" as const,
        text: prepared.originalBody,
      };
      const outcome = await input.adapter.translate({
        sourceLanguage: prepared.originalLanguage,
        targetLanguage: request.targetLanguage,
        segments: [segment],
      });
      if (outcome.status !== "completed") return { status: "unavailable" };
      const generated = outcome.segments[0];
      if (
        outcome.segments.length !== 1 ||
        generated?.key !== "message" ||
        outcome.provenance.provider !== messageTranslationProvenance.provider ||
        outcome.provenance.model !== messageTranslationProvenance.model ||
        outcome.provenance.promptVersion !==
          messageTranslationProvenance.promptVersion ||
        generated.text.trim().length < 1
      ) {
        return { status: "unavailable" };
      }
      return input.repository.save({
        ...request,
        translatedBody: generated.text.trim(),
      });
    },
  };
}

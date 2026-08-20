import type {
  CottageTranslator,
  CottageTranslationResult,
} from "@/cottage-publication/cottage-publication";
import {
  HumanReviewRequiredError,
  TranslationExecutionUnavailableError,
} from "@/cottage-publication/cottage-publication";

import type { TranslationInput, TranslationOutcome } from "./translation.ts";

interface TranslationService {
  translate(input: TranslationInput): Promise<TranslationOutcome>;
}

export function createCottagePublicationTranslator(
  service: TranslationService,
): CottageTranslator {
  return {
    async translate(input): Promise<CottageTranslationResult> {
      const outcome = await service.translate({
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        route: input.route,
        segments: [
          {
            key: "description",
            kind: "cottage_description",
            text: input.description,
          },
          {
            key: "houseRules",
            kind: "house_rules",
            text: input.houseRules,
          },
        ],
      });
      if (outcome.status === "human_review_required") {
        throw new HumanReviewRequiredError(outcome.reason);
      }
      if (outcome.status === "unavailable") {
        throw new TranslationExecutionUnavailableError(outcome.code);
      }
      const description = outcome.segments.find(
        (segment) => segment.key === "description",
      )?.text;
      const houseRules = outcome.segments.find(
        (segment) => segment.key === "houseRules",
      )?.text;
      if (!description || !houseRules) {
        throw new TranslationExecutionUnavailableError(
          "invalid_provider_response",
        );
      }
      return {
        description,
        houseRules,
        provenance: {
          provider: outcome.provenance.provider,
          model: outcome.provenance.model,
          effort: outcome.provenance.effort,
          promptVersion: outcome.provenance.promptVersion,
        },
      };
    },
  };
}

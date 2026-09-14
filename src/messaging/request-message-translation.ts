import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasCustomerCapability } from "@/access/account-access";
import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import type { Locale } from "@/i18n/routing";

import {
  createMessageTranslation,
  type MessageTranslationAdapter,
  type MessageTranslationRepository,
} from "./message-translation";

export function createRequestMessageTranslation(
  identityClient: SupabaseClient,
  repository: MessageTranslationRepository,
  adapter: MessageTranslationAdapter,
  enabled: boolean,
) {
  const translations = createMessageTranslation({
    repository,
    adapter,
    enabled,
  });
  const actorUserId = async () => {
    const { data, error } = await identityClient.auth.getUser();
    if (error || !data.user) return undefined;
    const context = await new SupabaseAccountContextStore(
      identityClient,
    ).resolve();
    if (!hasCustomerCapability(context) || context.userId !== data.user.id) {
      return undefined;
    }
    return data.user.id;
  };

  return {
    async translate(messageId: string, targetLanguage: Locale) {
      try {
        const actor = await actorUserId();
        if (!actor) return { status: "access-required" as const };
        return await translations.translate({
          actorUserId: actor,
          messageId,
          targetLanguage,
        });
      } catch {
        return { status: "unavailable" as const };
      }
    },
    async report(
      translationId: string,
      commandId: string,
      category: "incorrect" | "unclear" | "inappropriate",
    ) {
      try {
        const actor = await actorUserId();
        if (!actor) return { status: "access-required" as const };
        return await repository.report({
          actorUserId: actor,
          translationId,
          commandId,
          category,
        });
      } catch {
        return { status: "unavailable" as const };
      }
    },
  };
}

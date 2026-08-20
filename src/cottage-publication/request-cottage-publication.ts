import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { getServerEnvironment } from "@/config/server-runtime";
import { createCottagePublicationTranslator } from "@/translation/cottage-publication-translator";
import { readTranslationConfiguration } from "@/translation/configuration";
import { createOpenAIResponsesTranslationAdapter } from "@/translation/openai-responses";
import { SupabaseTranslationStore } from "@/translation/supabase-translation-store";
import { createTranslationService } from "@/translation/translation";

import { createCottagePublicationMediaService } from "./cottage-publication-media";
import {
  createCottagePublication,
  productionTranslationUnavailable,
  translationExecutionLeaseMilliseconds,
} from "./cottage-publication";
import { SupabaseCottagePublicationMediaAdapter } from "./supabase-cottage-publication-media";
import { SupabaseCottagePublicationRepository } from "./supabase-cottage-publication";

let privilegedClient: ReturnType<typeof createClient> | null = null;

function getCottagePublicationPrivilegedClient() {
  if (!privilegedClient) {
    const { supabase } = getServerEnvironment();
    privilegedClient = createClient(supabase.url, supabase.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return privilegedClient;
}

export function createRequestCottagePublicationMedia() {
  const environment = getServerEnvironment();
  return createCottagePublicationMediaService({
    adapter: new SupabaseCottagePublicationMediaAdapter(
      getCottagePublicationPrivilegedClient(),
    ),
    configuredSupabaseUrl: environment.supabase.url,
  });
}

export async function createRequestCottagePublication() {
  return new SupabaseCottagePublicationRepository(
    await createRequestSupabaseClient(),
    getCottagePublicationPrivilegedClient(),
  );
}

export async function createRequestCottageTranslation() {
  const repository = await createRequestCottagePublication();
  const configuration = readTranslationConfiguration(process.env);
  const translator = configuration.enabled
    ? createCottagePublicationTranslator(
        createTranslationService({
          configuration,
          adapter: createOpenAIResponsesTranslationAdapter({
            apiKey: configuration.apiKey,
            timeoutMilliseconds: configuration.limits.timeoutMilliseconds,
          }),
          store: new SupabaseTranslationStore(
            getCottagePublicationPrivilegedClient(),
            configuration,
          ),
        }),
      )
    : productionTranslationUnavailable;
  const leaseDurationMilliseconds = configuration.enabled
    ? translationExecutionLeaseMilliseconds(
        configuration.limits.maximumAttempts,
        configuration.limits.timeoutMilliseconds,
      )
    : translationExecutionLeaseMilliseconds(1, 1_000);
  const publication = createCottagePublication({
    repository,
    translator,
    leaseDurationMilliseconds,
  });
  return {
    assertTranslationAdministrator: () =>
      repository.assertTranslationAdministrator(),
    generateTranslation: publication.generateTranslation,
  };
}

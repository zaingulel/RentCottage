import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/booking-request-test-runtime";
import { getServerEnvironment } from "@/config/server-runtime";

import { createDeterministicMessageTranslationAdapter } from "./deterministic-message-translation";
import { createRequestMessageTranslation } from "./request-message-translation";
import { createRequestMessaging } from "./request-messaging";
import { SupabaseMessagingRepository } from "./supabase-messaging";
import { SupabaseMessagingReader } from "./supabase-messaging-reader";

let privilegedClient: ReturnType<typeof createClient> | undefined;

function messagingPrivilegedClient() {
  if (!privilegedClient) {
    const { supabase } = getServerEnvironment();
    privilegedClient = createClient(supabase.url, supabase.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return privilegedClient;
}

export async function createRequestMessagingRuntime() {
  const identityClient = await createRequestSupabaseClient();
  const repository = new SupabaseMessagingRepository(
    messagingPrivilegedClient(),
  );
  return {
    enabled: bookingRequestTestRuntimeIsEnabled(),
    messaging: createRequestMessaging(identityClient, repository),
    reader: new SupabaseMessagingReader(identityClient),
    translation: createRequestMessageTranslation(
      identityClient,
      repository,
      createDeterministicMessageTranslationAdapter(),
      bookingRequestTestRuntimeIsEnabled(),
    ),
  };
}

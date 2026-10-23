import "server-only";

import { createClient } from "@supabase/supabase-js";

import { resolveRequestAccount } from "@/access/request-account-context";
import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/fictional-supplier-environment";
import { getServerEnvironment } from "@/config/server-runtime";

import { createDeterministicReviewTranslationAdapter } from "./deterministic-review-translation";
import { createReviewTranslation } from "./review-translation";
import { SupabaseReviewTranslationRepository } from "./supabase-review-translation";

let privilegedClient: ReturnType<typeof createClient> | undefined;

function reviewTranslationPrivilegedClient() {
  if (!privilegedClient) {
    const { supabase } = getServerEnvironment();
    privilegedClient = createClient(supabase.url, supabase.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return privilegedClient;
}

export function createRequestReviewTranslation() {
  if (!bookingRequestTestRuntimeIsEnabled()) {
    return undefined;
  }

  return createReviewTranslation({
    repository: new SupabaseReviewTranslationRepository(
      reviewTranslationPrivilegedClient(),
    ),
    adapter: createDeterministicReviewTranslationAdapter(),
    account: resolveRequestAccount,
  });
}

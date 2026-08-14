import { createClient } from "@supabase/supabase-js";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { getServerEnvironment } from "@/config/server-runtime";

import { createOwnerApplication } from "./owner-application";
import {
  SupabaseOwnerApplicationRepository,
  SupabaseVerificationDocumentStorage,
} from "./supabase-owner-application";

let privilegedClient: ReturnType<typeof createClient> | null = null;

function getPrivilegedClient() {
  if (!privilegedClient) {
    const { supabase } = getServerEnvironment();
    privilegedClient = createClient(supabase.url, supabase.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return privilegedClient;
}

export async function createRequestOwnerApplication() {
  const client = await createRequestSupabaseClient();
  const privilegedClient = getPrivilegedClient();
  return createOwnerApplication({
    repository: new SupabaseOwnerApplicationRepository(
      client,
      privilegedClient,
    ),
    storage: new SupabaseVerificationDocumentStorage(privilegedClient),
  });
}

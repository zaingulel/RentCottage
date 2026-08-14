import { createClient } from "@supabase/supabase-js";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { getServerEnvironment } from "@/config/server-runtime";

import { createOwnerApplication } from "./owner-application";
import {
  SupabaseOwnerApplicationRepository,
  SupabaseVerificationDocumentStorage,
} from "./supabase-owner-application";

export async function createRequestOwnerApplication() {
  const client = await createRequestSupabaseClient();
  const { supabase } = getServerEnvironment();
  const privilegedClient = createClient(supabase.url, supabase.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createOwnerApplication({
    repository: new SupabaseOwnerApplicationRepository(
      client,
      privilegedClient,
    ),
    storage: new SupabaseVerificationDocumentStorage(privilegedClient),
  });
}

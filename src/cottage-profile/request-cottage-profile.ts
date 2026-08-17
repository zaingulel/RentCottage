import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { getServerEnvironment } from "@/config/server-runtime";
import { createCottageProfile } from "./cottage-profile";
import {
  SupabaseCottageProfileRepository,
  SupabaseCottageProfileStorage,
} from "./supabase-cottage-profile";

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

export async function createRequestCottageProfile() {
  const client = await createRequestSupabaseClient();
  const serviceClient = getPrivilegedClient();
  return createCottageProfile({
    repository: new SupabaseCottageProfileRepository(client, serviceClient),
    storage: new SupabaseCottageProfileStorage(serviceClient),
  });
}

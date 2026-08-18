import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { getServerEnvironment } from "@/config/server-runtime";
import { createCottagePublicationMediaService } from "./cottage-publication-media";
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

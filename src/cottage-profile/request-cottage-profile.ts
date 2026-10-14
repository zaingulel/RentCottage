import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { getServerEnvironment } from "@/config/server-runtime";
import { createCottagePublicationMediaService } from "@/cottage-publication/cottage-publication-media";
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

export async function createRequestCottageProfilePhotoMedia() {
  const serviceClient = getPrivilegedClient();
  const repository = new SupabaseCottageProfileRepository(
    await createRequestSupabaseClient(),
    serviceClient,
  );
  const storage = new SupabaseCottageProfileStorage(serviceClient);
  return createCottagePublicationMediaService({
    adapter: {
      resolveMedia: (photoId) => repository.preparePhotoPreview(photoId),
      signMedia: (objectPath) => storage.createSignedUrl(objectPath, 60),
    },
    configuredSupabaseUrl: getServerEnvironment().supabase.url,
  });
}

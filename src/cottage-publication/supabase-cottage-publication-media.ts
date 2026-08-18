import type { SupabaseClient } from "@supabase/supabase-js";

import { cottageProfilePhotoBucketName } from "@/cottage-profile/cottage-profile";
import type { CottagePublicationMediaAdapter } from "./cottage-publication-media";
import { SupabaseCottagePublicationRepository } from "./supabase-cottage-publication";

function assertSuccess(error: unknown): void {
  if (error)
    throw new Error("Cottage publication media provider is unavailable", {
      cause: error,
    });
}

export class SupabaseCottagePublicationMediaAdapter implements CottagePublicationMediaAdapter {
  private readonly repository: SupabaseCottagePublicationRepository;

  constructor(private readonly privilegedClient: SupabaseClient) {
    this.repository = new SupabaseCottagePublicationRepository(
      privilegedClient,
      privilegedClient,
    );
  }

  resolveMedia(opaqueId: string) {
    return this.repository.resolveMedia(opaqueId);
  }

  async signMedia(objectPath: string) {
    const { data, error } = await this.privilegedClient.storage
      .from(cottageProfilePhotoBucketName)
      .createSignedUrl(objectPath, 60);
    assertSuccess(error);
    if (!data?.signedUrl)
      throw new Error("Cottage publication media signature is unavailable");
    return data.signedUrl;
  }
}

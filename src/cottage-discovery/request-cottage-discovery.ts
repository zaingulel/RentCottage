import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import type { Locale } from "@/i18n/routing";

import type { CottageDiscoveryQuery } from "./discovery-query";
import { SupabaseCottageDiscovery } from "./supabase-cottage-discovery";

async function requestDiscovery() {
  return new SupabaseCottageDiscovery(await createRequestSupabaseClient());
}

export async function searchPublicCottages(
  locale: Locale,
  query: CottageDiscoveryQuery,
) {
  return (await requestDiscovery()).search(locale, query);
}

export async function loadPublicCottageFacets(locale: Locale) {
  return (await requestDiscovery()).facets(locale);
}

export async function loadDefaultPublicCottageQuery(slug: string) {
  return (await requestDiscovery()).defaultQuery(slug);
}

export async function loadPublicCottageProfile(
  locale: Locale,
  slug: string,
  query: CottageDiscoveryQuery,
) {
  return (await requestDiscovery()).profile(locale, slug, query);
}

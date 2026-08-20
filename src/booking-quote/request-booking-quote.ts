import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";
import type { Locale } from "@/i18n/routing";

import { SupabaseBookingQuote } from "./supabase-booking-quote";

export async function loadPublicBookingQuote(
  locale: Locale,
  publicSlug: string,
  discoveryQuery: CottageDiscoveryQuery,
) {
  const quote = new SupabaseBookingQuote(await createRequestSupabaseClient());
  return quote.load(locale, publicSlug, discoveryQuery);
}

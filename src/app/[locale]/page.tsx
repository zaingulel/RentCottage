import { notFound } from "next/navigation";

import { MarketplaceShell } from "@/components/marketplace-shell";
import { loadPublicCottageFacets } from "@/cottage-discovery/request-cottage-discovery";
import { isLocale } from "@/i18n/routing";

export default async function MarketplacePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const facets = await loadPublicCottageFacets(locale);
  return <MarketplaceShell initialLocale={locale} facets={facets} />;
}

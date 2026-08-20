import { notFound } from "next/navigation";

import { PublicCottageProfileView } from "@/components/public-cottage-profile";
import { InvalidCottageSearch } from "@/components/invalid-cottage-search";
import {
  parseCottageDiscoveryQuery,
  preserveRawCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";
import {
  loadDefaultPublicCottageQuery,
  loadPublicCottageProfile,
} from "@/cottage-discovery/request-cottage-discovery";
import { isLocale } from "@/i18n/routing";

export default async function CottagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const rawQuery = await searchParams;
  let parsed = parseCottageDiscoveryQuery(rawQuery);
  if (Object.keys(rawQuery).length === 0) {
    const defaultQuery = await loadDefaultPublicCottageQuery(slug);
    if (defaultQuery.status === "not-found") notFound();
    if (defaultQuery.status === "unavailable") {
      return (
        <PublicCottageProfileView
          locale={locale}
          slug={slug}
          result={{ status: "unavailable" }}
          queryString=""
        />
      );
    }
    parsed = { status: "loaded", query: defaultQuery.query };
  }
  if (parsed.status === "invalid") {
    return (
      <InvalidCottageSearch
        locale={locale}
        path={`/cottages/${slug}`}
        queryString={preserveRawCottageDiscoveryQuery(rawQuery)}
      />
    );
  }
  const result = await loadPublicCottageProfile(locale, slug, parsed.query);
  if (result.status === "not-found") notFound();
  return (
    <PublicCottageProfileView
      locale={locale}
      slug={slug}
      result={result}
      queryString={serializeCottageDiscoveryQuery(parsed.query)}
    />
  );
}

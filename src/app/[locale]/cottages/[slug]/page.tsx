import { notFound } from "next/navigation";

import { PublicCottageProfileView } from "@/components/public-cottage-profile";
import { InvalidCottageSearch } from "@/components/invalid-cottage-search";
import { SiteFooter } from "@/components/site-footer";
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
  const path = `/cottages/${slug}`;
  let parsed = parseCottageDiscoveryQuery(rawQuery);
  if (Object.keys(rawQuery).length === 0) {
    const defaultQuery = await loadDefaultPublicCottageQuery(slug);
    if (defaultQuery.status === "not-found") notFound();
    if (defaultQuery.status === "unavailable") {
      return (
        <>
          <PublicCottageProfileView
            locale={locale}
            result={{ status: "unavailable" }}
            queryString=""
          />
          <SiteFooter locale={locale} path={path} queryString="" />
        </>
      );
    }
    parsed = { status: "loaded", query: defaultQuery.query };
  }
  if (parsed.status === "invalid") {
    return (
      <>
        <InvalidCottageSearch locale={locale} />
        <SiteFooter
          locale={locale}
          path={path}
          queryString={preserveRawCottageDiscoveryQuery(rawQuery)}
        />
      </>
    );
  }
  const result = await loadPublicCottageProfile(locale, slug, parsed.query);
  if (result.status === "not-found") notFound();
  const queryString = serializeCottageDiscoveryQuery(parsed.query);
  return (
    <>
      <PublicCottageProfileView
        locale={locale}
        result={result}
        queryString={queryString}
      />
      <SiteFooter locale={locale} path={path} queryString={queryString} />
    </>
  );
}

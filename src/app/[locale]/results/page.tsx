import { notFound } from "next/navigation";

import { PublicCottageResults } from "@/components/public-cottage-results";
import { InvalidCottageSearch } from "@/components/invalid-cottage-search";
import { SiteFooter } from "@/components/site-footer";
import {
  parseCottageResultsQuery,
  preserveRawCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
  serializeCottageResultsQuery,
} from "@/cottage-discovery/discovery-query";
import { searchPublicCottages } from "@/cottage-discovery/request-cottage-discovery";
import { isLocale } from "@/i18n/routing";

export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) notFound();
  const parsed = parseCottageResultsQuery(query);
  if (parsed.status === "invalid") {
    const queryString = preserveRawCottageDiscoveryQuery(query);
    return (
      <>
        <InvalidCottageSearch locale={locale} />
        <SiteFooter locale={locale} path="/results" queryString={queryString} />
      </>
    );
  }
  const result = await searchPublicCottages(locale, parsed.query, parsed.after);
  const queryString = serializeCottageDiscoveryQuery(parsed.query);
  const resultsQueryString = serializeCottageResultsQuery(
    parsed.query,
    parsed.after,
  );
  return (
    <>
      <PublicCottageResults
        locale={locale}
        result={result}
        query={parsed.query}
        queryString={queryString}
        after={parsed.after}
      />
      <SiteFooter
        locale={locale}
        path="/results"
        queryString={resultsQueryString}
      />
    </>
  );
}

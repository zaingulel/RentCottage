import { notFound } from "next/navigation";

import { PublicCottageResults } from "@/components/public-cottage-results";
import { InvalidCottageSearch } from "@/components/invalid-cottage-search";
import {
  parseCottageDiscoveryQuery,
  preserveRawCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
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
  const parsed = parseCottageDiscoveryQuery(query);
  if (parsed.status === "invalid") {
    return (
      <InvalidCottageSearch
        locale={locale}
        path="/results"
        queryString={preserveRawCottageDiscoveryQuery(query)}
      />
    );
  }
  const result = await searchPublicCottages(locale, parsed.query);
  return (
    <PublicCottageResults
      locale={locale}
      result={result}
      queryString={serializeCottageDiscoveryQuery(parsed.query)}
    />
  );
}

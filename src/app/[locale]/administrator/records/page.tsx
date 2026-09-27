import { notFound } from "next/navigation";

import type { AdministratorSearchInput } from "@/administrator-records/administrator-records";
import { searchAdministratorRecords } from "@/administrator-records/supabase-administrator-records";
import { AdministratorRecords } from "@/components/administrator-records";
import { isLocale } from "@/i18n/routing";

const defaultFilters: AdministratorSearchInput = {
  kind: "applications",
  query: "",
  status: "pending",
  from: null,
  through: null,
  ownerId: null,
  afterAt: null,
  afterId: null,
};

export default async function AdministratorRecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const hasScope = Object.keys(query).length > 0;
  const allowedScope =
    Object.keys(query).every((key) => key === "scope" || key === "ownerId") &&
    query.scope === "cottages" &&
    typeof query.ownerId === "string";
  const filters: AdministratorSearchInput = allowedScope
    ? {
        ...defaultFilters,
        kind: "cottages",
        status: null,
        ownerId: query.ownerId as string,
      }
    : defaultFilters;
  const initial =
    hasScope && !allowedScope
      ? { status: "invalid" as const }
      : await searchAdministratorRecords(filters);
  return (
    <main className="owner-application-page">
      <AdministratorRecords
        locale={locale}
        initial={initial}
        initialFilters={filters}
      />
    </main>
  );
}

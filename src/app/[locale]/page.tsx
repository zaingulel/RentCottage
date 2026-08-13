import { notFound } from "next/navigation";

import { MarketplaceShell } from "@/components/marketplace-shell";
import { isLocale } from "@/i18n/routing";

export default async function MarketplacePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <MarketplaceShell initialLocale={locale} />;
}

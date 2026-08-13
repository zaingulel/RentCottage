import { notFound } from "next/navigation";

import { BookingRequest } from "@/components/booking-request";
import { cottageBySlug, cottages } from "@/data/cottages";
import { isLocale, locales } from "@/i18n/routing";

export function generateStaticParams() {
  return locales.flatMap((locale) =>
    cottages.map((cottage) => ({ locale, slug: cottage.slug })),
  );
}

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const cottage = cottageBySlug(slug);
  if (!isLocale(locale) || !cottage) notFound();

  return <BookingRequest initialLocale={locale} cottage={cottage} />;
}

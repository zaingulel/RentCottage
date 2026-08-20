import { notFound } from "next/navigation";

import { isLocale } from "@/i18n/routing";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  notFound();
}

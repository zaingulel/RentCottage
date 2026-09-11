import { notFound, redirect } from "next/navigation";
import { accountAccessHref } from "@/access/return-destination";
import { isLocale } from "@/i18n/routing";
export default async function OwnerAccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  redirect(accountAccessHref(locale, `/${locale}/owner/application`));
}

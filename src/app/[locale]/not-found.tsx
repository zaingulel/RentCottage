import { locale as rootLocale } from "next/root-params";

import { NotFoundScreen } from "@/components/not-found-screen";
import { SiteFooter } from "@/components/site-footer";
import { defaultLocale, isLocale } from "@/i18n/routing";

export default async function LocaleNotFound() {
  const requested = await rootLocale();
  const locale = isLocale(requested) ? requested : defaultLocale;
  return (
    <>
      <NotFoundScreen locale={locale} />
      <SiteFooter locale={locale} path="" queryString="" />
    </>
  );
}

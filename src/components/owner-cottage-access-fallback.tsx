import Link from "next/link";

import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";

export function OwnerCottageAccessFallback({
  locale,
  title,
  status,
}: {
  locale: Locale;
  title: string;
  status: "unavailable" | "access_required" | "prospective";
}) {
  const copy = cottageProfileMessages[locale];
  const isUnavailable = status === "unavailable";
  return (
    <main className="owner-application-page access-required-page">
      <section
        className="access-required-card"
        role={isUnavailable ? "alert" : undefined}
      >
        <h1>{title}</h1>
        <p>
          {isUnavailable
            ? copy.unavailable
            : status === "prospective"
              ? copy.prospective
              : copy.accessRequired}
        </p>
        {status === "access_required" ? (
          <Link href={`/${locale}/owner/access`}>{copy.ownerAccessAction}</Link>
        ) : null}
        {status === "prospective" ? (
          <Link href={`/${locale}/owner/application`}>
            {copy.ownerApplication}
          </Link>
        ) : null}
      </section>
    </main>
  );
}

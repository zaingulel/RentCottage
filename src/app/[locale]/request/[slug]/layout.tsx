import type { ReactNode } from "react";

import { bookingRequestMessages } from "@/i18n/booking-request-messages";
import { defaultLocale, isLocale } from "@/i18n/routing";

export default async function RequestLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: requested } = await params;
  const locale = isLocale(requested) ? requested : defaultLocale;
  return (
    <div
      role="region"
      id="booking-request-content"
      aria-label={bookingRequestMessages[locale].formTitle}
      tabIndex={-1}
      className="action-focus-target action-focus-target-inset"
    >
      {children}
    </div>
  );
}

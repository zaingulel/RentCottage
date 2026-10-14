import Link from "next/link";

import { accessMessages } from "@/i18n/access-messages";
import { administratorPaymentHistoryMessages } from "@/i18n/administrator-payment-history-messages";
import { administratorQueuesMessages } from "@/i18n/administrator-queues-messages";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { administratorTotalsMessages } from "@/i18n/administrator-totals-messages";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { ownerBookingRequestMessages } from "@/i18n/owner-booking-request-messages";
import type { Locale } from "@/i18n/routing";

type BackofficeNavigationProps = { locale: Locale; nested?: boolean } & (
  | { area: "owner"; current: "cottages"; waitingBookingRequests?: number }
  | {
      area: "administrator";
      waitingBookingRequests?: never;
      current:
        | "owner-applications"
        | "cottages"
        | "payments"
        | "queues"
        | "totals";
    }
);

export function BackofficeNavigation({
  locale,
  nested,
  area,
  current,
  waitingBookingRequests,
}: BackofficeNavigationProps) {
  const access = accessMessages[locale];
  const profile = cottageProfileMessages[locale];
  const label = area === "owner" ? profile.eyebrow : profile.adminEyebrow;
  const destinations =
    area === "owner"
      ? [
          {
            key: "cottages",
            href: `/${locale}/owner/cottages`,
            label: access.manageCottages,
          },
          {
            key: "bookings",
            href: `/${locale}/bookings?workspace=owner`,
            label: access.ownerBookings,
          },
        ]
      : [
          {
            key: "owner-applications",
            href: `/${locale}/administrator/owner-applications`,
            label: access.reviewApplications,
          },
          {
            key: "cottages",
            href: `/${locale}/administrator/cottages`,
            label: access.manageCottageProfiles,
          },
          {
            key: "payments",
            href: `/${locale}/administrator/payments`,
            label: administratorPaymentHistoryMessages[locale].title,
          },
          {
            key: "queues",
            href: `/${locale}/administrator/queues`,
            label: administratorQueuesMessages[locale].title,
          },
          {
            key: "totals",
            href: `/${locale}/administrator/totals`,
            label: administratorTotalsMessages[locale].title,
          },
          {
            key: "records",
            href: `/${locale}/administrator/records`,
            label: administratorRecordsMessages[locale].records,
          },
        ];

  return (
    <nav
      className="backoffice-navigation"
      aria-labelledby="backoffice-navigation-area"
    >
      <span id="backoffice-navigation-area" className="visually-hidden">
        {label}
      </span>
      <div className="backoffice-navigation-links">
        {destinations.map((destination) => (
          <Link
            key={destination.key}
            className="backoffice-navigation-tab"
            href={destination.href}
            aria-current={
              destination.key === current
                ? nested
                  ? "true"
                  : "page"
                : undefined
            }
          >
            {destination.label}
            {destination.key === "bookings" && waitingBookingRequests ? (
              <>
                {" "}
                <span className="backoffice-navigation-count">
                  <span className="visually-hidden">
                    {ownerBookingRequestMessages[locale].title}:
                  </span>{" "}
                  {new Intl.NumberFormat(locale).format(waitingBookingRequests)}
                </span>
              </>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}

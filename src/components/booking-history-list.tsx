import type { BookingHistoryItem } from "@/booking-request/booking-history";
import { ownerBookingEarnings } from "@/booking-request/owner-booking-earnings";
import { bookingLifecycleMessages } from "@/i18n/booking-lifecycle-messages";
import { bookingRequestDisplayStatusMessages } from "@/i18n/booking-request-status-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import Link from "next/link";
import { OwnerBookingEarningsDetails } from "./owner-booking-earnings";

export function BookingHistoryList({
  items,
  locale,
}: {
  readonly items: readonly BookingHistoryItem[];
  readonly locale: Locale;
}) {
  return (
    <ul>
      {items.map((item) => {
        const earnings =
          item.actorRole === "cottage_owner"
            ? ownerBookingEarnings(
                item.ownerEarnings ?? { status: "unavailable" },
              )
            : null;
        return (
          <li key={`${item.actorRole}:${item.bookingRequestId}`}>
            <Link
              href={
                item.actorRole === "customer"
                  ? `/${locale}/booking-requests/${item.bookingRequestReference}`
                  : `/${locale}/owner/booking-requests/${item.bookingRequestReference}`
              }
            >
              <strong>{item.cottageName}</strong>
              <span>
                <bdi>
                  {item.bookingReference ?? item.bookingRequestReference}
                </bdi>
              </span>
              <span>
                {item.status in bookingLifecycleMessages[locale]
                  ? bookingLifecycleMessages[locale][
                      item.status as keyof (typeof bookingLifecycleMessages)[typeof locale]
                    ]
                  : bookingRequestDisplayStatusMessages[locale][
                      item.status as keyof (typeof bookingRequestDisplayStatusMessages)[typeof locale]
                    ]}
              </span>
              <time dateTime={item.firstStartsAt}>
                {formatIraqDateTime(item.firstStartsAt, locale)}
              </time>
            </Link>
            {earnings ? (
              <OwnerBookingEarningsDetails
                locale={locale}
                earnings={earnings}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

import { createRoot } from "react-dom/client";

import { CustomerBookingRequestStatus } from "@/components/customer-booking-request-status";
import { OwnerBookingRequestNotifications } from "@/components/owner-booking-request-notifications";
import { PublicCottageResults } from "@/components/public-cottage-results";
import {
  serializeCottageDiscoveryQuery,
  type CottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";
import type { PublicCottageSummary } from "@/cottage-discovery/supabase-cottage-discovery";

import {
  customerDisplayFixtures,
  customerRecoveryDisplayFixtures,
  ownerDisplayFixtures,
} from "./booking-request-display.fixtures";

const rootElement = document.getElementById("fixture-root");
if (!rootElement)
  throw new Error("Booking Request display fixture root is missing");

const root = createRoot(rootElement);

function renderBookingRequestDisplay({
  locale,
  role,
  status,
  recovery,
}: {
  locale: "en" | "ar" | "ckb";
  role: "customer" | "owner";
  recovery?: "available" | "processing" | "retryable";
  status:
    | "capture-processing"
    | "payment-required-open"
    | "payment-required-elapsed"
    | "payment-expiry-processing"
    | "payment-expiry-attention-required"
    | "payment-expiry-expired"
    | "payment-correction-refunding"
    | "payment-correction-quarantined"
    | "payment-correction-expired"
    | "payment-correction-released-review"
    | "paid-confirmed";
}) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "en" ? "ltr" : "rtl";
  root.render(
    <main
      className={
        role === "customer"
          ? "results-page page page-record"
          : "results-page page"
      }
    >
      {role === "customer" ? (
        <>
          <CustomerBookingRequestStatus
            key={`${status}:${recovery ?? "none"}`}
            locale={locale}
            request={
              recovery
                ? customerRecoveryDisplayFixtures[recovery]
                : customerDisplayFixtures[status]
            }
          />
          <div className="request-follow-up" />
        </>
      ) : (
        <OwnerBookingRequestNotifications
          key={`${status}:${recovery ?? "none"}`}
          locale={locale}
          notifications={[ownerDisplayFixtures[status]]}
        />
      )}
    </main>,
  );
}

window.renderBookingRequestDisplay = renderBookingRequestDisplay;

// Synthetic display content and repository sample photographs, never production records.
const publicCottageQuery: CottageDiscoveryQuery = {
  from: "2099-08-21",
  to: "2099-08-22",
  guests: 6,
  selections: [
    { serviceDay: "2099-08-21", kind: "shift", position: 1 },
    { serviceDay: "2099-08-22", kind: "full-day" },
  ],
  governorate: "Erbil",
  area: "Shaqlawa",
  amenities: ["pool", "parking"],
};

const publicDisplayCottage: PublicCottageSummary = {
  slug: "cottage-00000000000040008000000000000754",
  name: "Fictional Garden Cottage",
  governorate: "Erbil",
  approximateLocation: "Shaqlawa",
  capacity: 8,
  amenities: ["pool", "parking"],
  mediaUrls: [
    "/uploads/cottage-garden.png",
    "/uploads/interior-living.png",
    "/uploads/interior-bedroom.png",
    "/uploads/detail-tea.png",
    "/uploads/cottage-river.png",
    "/uploads/cottage-hills.png",
  ],
  inventory: [
    {
      serviceDay: "2099-08-21",
      kind: "shift",
      position: 1,
      name: "Morning",
      startTime: "09:00",
      endTime: "15:00",
      priceIqd: 180000,
      available: true,
    },
    {
      serviceDay: "2099-08-21",
      kind: "shift",
      position: 2,
      name: "Evening",
      startTime: "17:00",
      endTime: "02:00",
      priceIqd: null,
      available: false,
    },
    {
      serviceDay: "2099-08-21",
      kind: "full-day",
      name: "Full day",
      startTime: "09:00",
      endTime: "02:00",
      priceIqd: 250000,
      available: false,
    },
    {
      serviceDay: "2099-08-22",
      kind: "shift",
      position: 1,
      name: "Morning",
      startTime: "09:00",
      endTime: "15:00",
      priceIqd: 190000,
      available: true,
    },
    {
      serviceDay: "2099-08-22",
      kind: "shift",
      position: 2,
      name: "Afternoon",
      startTime: "15:00",
      endTime: "19:00",
      priceIqd: 200000,
      available: false,
    },
    {
      serviceDay: "2099-08-22",
      kind: "shift",
      position: 3,
      name: "Evening",
      startTime: "19:00",
      endTime: "02:00",
      priceIqd: 210000,
      available: true,
    },
    {
      serviceDay: "2099-08-22",
      kind: "full-day",
      name: "Full day",
      startTime: "09:00",
      endTime: "02:00",
      priceIqd: 250000,
      available: true,
    },
  ],
};

function renderPublicCottageDisplay({
  locale,
  photoCount,
  longContent,
}: {
  screen: "results";
  locale: "en" | "ar" | "ckb";
  photoCount: 0 | 1 | 4 | 6;
  longContent?: boolean;
}) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "en" ? "ltr" : "rtl";
  const cottage: PublicCottageSummary = {
    ...publicDisplayCottage,
    mediaUrls: publicDisplayCottage.mediaUrls.slice(0, photoCount),
    name: longContent
      ? "کۆتێجی باخچەی خەیاڵی بۆ کۆبوونەوەی خێزان لە ناوچەی شەقڵاوە لە نێوان دارەکان و چیاکان لەگەڵ شوێنی پشوودان و دانیشتنی دەرەوە"
      : publicDisplayCottage.name,
    approximateLocation: longContent
      ? "ناوچەی نزیکەیی لە دەوروبەری شەقڵاوە لەگەڵ دەقی درێژ بۆ پشکنینی پێچانەوە و خوێندنەوە"
      : publicDisplayCottage.approximateLocation,
  };
  root.render(
    <PublicCottageResults
      locale={locale}
      result={{
        status: "loaded",
        cottages: [cottage],
        nextAfter: "cottage-00000000000040008000000000000755",
      }}
      query={publicCottageQuery}
      queryString={serializeCottageDiscoveryQuery(publicCottageQuery)}
      after={null}
    />,
  );
}

window.renderPublicCottageDisplay = renderPublicCottageDisplay;

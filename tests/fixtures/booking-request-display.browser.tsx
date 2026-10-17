import { createRoot } from "react-dom/client";

import { BackofficeNavigation } from "@/components/backoffice-navigation";
import { CottageProfileEditor } from "@/components/cottage-profile-editor";
import { CottageProfileOverview } from "@/components/cottage-profile-overview";
import { SiteHeader } from "@/components/site-header";
import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import { CustomerBookingRequestStatus } from "@/components/customer-booking-request-status";
import { OwnerBookingRequestNotifications } from "@/components/owner-booking-request-notifications";
import { PublicCottageProfileView } from "@/components/public-cottage-profile";
import { PublicCottageResults } from "@/components/public-cottage-results";
import { ActionButton } from "@/components/interaction-controls";
import { messagingMessages } from "@/i18n/messaging-messages";
import {
  serializeCottageDiscoveryQuery,
  type CottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";
import type { PublicCottageProfile } from "@/cottage-discovery/supabase-cottage-discovery";

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
          <div className="card customer-request-messages">
            <section
              className="request-follow-up"
              aria-label={messagingMessages[locale].inbox}
            >
              <h2 className="section-title">
                {messagingMessages[locale].inbox}
              </h2>
              <ActionButton kind="secondary" size="regular" type="button">
                {messagingMessages[locale].open}
              </ActionButton>
            </section>
          </div>
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

const publicDisplayCottage: PublicCottageProfile = {
  bedrooms: 3,
  bathrooms: 2,
  description:
    "A fictional garden house for a family gathering, with a shaded veranda and room for tea outdoors.",
  houseRules: "No smoking indoors. Keep music low after 10 PM.",
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
  screen,
  locale,
  photoCount,
  longContent,
  withHeader = false,
}: {
  screen: "results" | "profile";
  locale: "en" | "ar" | "ckb";
  photoCount: 0 | 1 | 4 | 6;
  longContent?: boolean;
  withHeader?: boolean;
}) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "en" ? "ltr" : "rtl";
  const cottage: PublicCottageProfile = {
    ...publicDisplayCottage,
    description: longContent
      ? "کۆتێجێکی باخچەدار بۆ کۆبوونەوەی خێزان و پشوودان لە ناوچەی شەقڵاوە لەگەڵ دەقی درێژ بۆ پشکنینی پێچانەوە و خوێندنەوە. ".repeat(
          8,
        )
      : publicDisplayCottage.description,
    inventory:
      screen === "profile"
        ? publicDisplayCottage.inventory.map((unit) => ({
            ...unit,
            available: !(
              unit.serviceDay === "2099-08-21" &&
              unit.kind === "shift" &&
              unit.position === 2
            ),
            name:
              longContent && unit.kind === "shift" && unit.position === 1
                ? "هەڵبژاردەی درێژی بەیانی بۆ پشوودانی خێزان لە باخچەکە"
                : unit.name,
          }))
        : publicDisplayCottage.inventory,
    mediaUrls: publicDisplayCottage.mediaUrls.slice(0, photoCount),
    name: longContent
      ? "کۆتێجی باخچەی خەیاڵی بۆ کۆبوونەوەی خێزان لە ناوچەی شەقڵاوە لە نێوان دارەکان و چیاکان لەگەڵ شوێنی پشوودان و دانیشتنی دەرەوە"
      : publicDisplayCottage.name,
    approximateLocation: longContent
      ? "ناوچەی نزیکەیی لە دەوروبەری شەقڵاوە لەگەڵ دەقی درێژ بۆ پشکنینی پێچانەوە و خوێندنەوە"
      : publicDisplayCottage.approximateLocation,
  };
  root.render(
    <>
      {withHeader ? (
        <SiteHeader
          locale={locale}
          account={{ status: "authenticated", context: { role: "customer" } }}
        />
      ) : null}
      {screen === "profile" ? (
        <PublicCottageProfileView
          locale={locale}
          result={{ status: "loaded", cottage }}
          query={publicCottageQuery}
          resultsQueryString={serializeCottageDiscoveryQuery(
            publicCottageQuery,
          )}
        />
      ) : (
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
        />
      )}
    </>,
  );
}

window.renderPublicCottageDisplay = renderPublicCottageDisplay;

const overviewDisplayCottage = {
  id: "70000000-0000-4000-8000-000000000763",
  ownerUserId: "10000000-0000-4000-8000-000000000763",
  applicationId: "20000000-0000-4000-8000-000000000763",
  currentPublicationId: null,
  status: "draft",
  version: 1,
  name: "Fictional Garden Cottage",
  governorate: "Erbil",
  approximateLocation: "Near Shaqlawa",
  exactAddress: "Fictional private address",
  exactLatitude: null,
  exactLongitude: null,
  privateDirections: "",
  capacity: 8,
  bedrooms: 3,
  bathrooms: 2,
  amenities: ["garden"],
  sourceLanguage: "en",
  description: "A synthetic cottage for display checks.",
  houseRules: "Synthetic house rules.",
  photos: [],
  submittedSourceRevision: null,
  hasUnpublishedContentChange: false,
  updatedAt: "2026-08-17T09:00:00.000Z",
} satisfies CottageProfile;

window.renderCottageOverviewDisplay = ({
  locale,
  actor,
  waitingBookingRequests,
}) => {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "en" ? "ltr" : "rtl";
  root.render(
    <>
      <SiteHeader
        locale={locale}
        account={{
          status: "authenticated",
          context:
            actor === "owner"
              ? { role: "cottage_owner", approvalState: "approved" }
              : { role: "platform_administrator" },
        }}
      />
      <main className="results-page page">
        {actor === "owner" ? (
          <BackofficeNavigation
            locale={locale}
            area="owner"
            current="cottages"
            waitingBookingRequests={waitingBookingRequests}
          />
        ) : (
          <BackofficeNavigation
            locale={locale}
            area="administrator"
            current="cottages"
          />
        )}
        <CottageProfileOverview
          locale={locale}
          actor={actor}
          profiles={[overviewDisplayCottage]}
          canCreate={actor === "owner"}
        />
      </main>
    </>,
  );
};

window.renderCottageEditorDisplay = ({
  locale,
  actor,
  state = "draft",
  longContent = false,
  withHeader = false,
}) => {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "en" ? "ltr" : "rtl";
  const submitted = state === "submitted" || state === "review";
  const editable =
    state !== "abandoned" && (actor === "administrator" || !submitted);
  const profile: CottageProfile = {
    ...overviewDisplayCottage,
    status:
      state === "abandoned"
        ? "abandoned"
        : submitted
          ? "submitted_for_content_approval"
          : "draft",
    name: longContent
      ? "کۆتێجی باخچەی خەیاڵی بۆ کۆبوونەوەی خێزان لە ناوچەی شەقڵاوە لە نێوان دارەکان و چیاکان"
      : overviewDisplayCottage.name,
    exactLatitude: 36.408333,
    exactLongitude: 44.385834,
    privateDirections: "Synthetic directions to the fictional garden gate.",
    description: longContent
      ? "کۆتێجێکی باخچەدار بۆ کۆبوونەوەی خێزان و پشوودان لە ناوچەی شەقڵاوە. ".repeat(
          8,
        )
      : overviewDisplayCottage.description,
    photos: [
      {
        id: "80000000-0000-4000-8000-000000000753",
        originalFilename:
          "fictional-garden-<script>-photograph-with-a-long-filename-for-wrapping-and-private-photo-display-checks.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 2048,
        state: "ready",
        updatedAt: overviewDisplayCottage.updatedAt,
      },
      {
        id: "80000000-0000-4000-8000-000000000754",
        originalFilename: "synthetic-pending.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 2048,
        state: "pending",
        updatedAt: overviewDisplayCottage.updatedAt,
      },
      {
        id: "80000000-0000-4000-8000-000000000755",
        originalFilename: "synthetic-deletion-pending.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 2048,
        state: "deletion_pending",
        updatedAt: overviewDisplayCottage.updatedAt,
      },
    ],
    submittedSourceRevision: submitted
      ? {
          revision: 1,
          ownerUserId: overviewDisplayCottage.ownerUserId,
          sourceLanguage: "en",
          description: "Preserved synthetic source description.",
          houseRules: "Preserved synthetic House Rules.",
          submittedAt: overviewDisplayCottage.updatedAt,
        }
      : null,
  };
  root.render(
    <>
      {withHeader ? (
        <SiteHeader
          locale={locale}
          account={{
            status: "authenticated",
            context:
              actor === "owner"
                ? { role: "cottage_owner", approvalState: "approved" }
                : { role: "platform_administrator" },
          }}
        />
      ) : null}
      <main className="results-page page">
        <BackofficeNavigation locale={locale} area={actor} current="cottages" />
        <CottageProfileEditor
          key={`${locale}:${actor}:${state}`}
          locale={locale}
          actor={actor}
          profile={profile}
          editable={editable}
          sourceEditable={state !== "review"}
          photoEditable={editable && state !== "review"}
        />
      </main>
    </>,
  );
};

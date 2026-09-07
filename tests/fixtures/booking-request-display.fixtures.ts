import type { CustomerBookingRequestDisplay } from "@/booking-request/booking-request-display";
import type { OwnerBookingRequestNotificationDisplay } from "@/booking-request/booking-request-display";

export const restrictedBookingRequestSentinels = {
  provider: "PRIVATE_PROVIDER_REFERENCE_145",
  paymentMethod: "PRIVATE_PAYMENT_METHOD_145",
  contact: "PRIVATE_CONTACT_145",
  location: "PRIVATE_LOCATION_145",
  accessDetails: "PRIVATE_ACCESS_DETAILS_145",
  issue35: "PRIVATE_ISSUE_35_145",
} as const;

const sharedRequest = {
  id: "00000000-0000-4000-8000-000000000145",
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  cottageName: "Fictional Garden Cottage",
  bookingPeriod: [
    {
      serviceDay: "2099-08-21",
      kind: "shift" as const,
      position: 2 as const,
      displayName: "Evening",
      startsAt: "2099-08-21T20:00:00+03:00",
      endsAt: "2099-08-21T23:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 100_003,
    },
  ],
  responseDeadline: "2099-08-21T21:00:00.000Z",
  statusNotifications: [],
  paymentRequiredWindow: null,
  paymentRequiredExpiry: null,
};

const restrictedFields = {
  payment: {
    providerReference: restrictedBookingRequestSentinels.provider,
    paymentMethod: restrictedBookingRequestSentinels.paymentMethod,
  },
  customerContact: restrictedBookingRequestSentinels.contact,
  cottageLocation: restrictedBookingRequestSentinels.location,
  accessDetails: restrictedBookingRequestSentinels.accessDetails,
  issue35: restrictedBookingRequestSentinels.issue35,
};

const customerDisplay = {
  ...sharedRequest,
  ...restrictedFields,
  partySize: 4,
  bookingPriceIqd: 100_003,
  serviceFeeIqd: 5_000,
  customerTotalIqd: 105_003,
  declineReason: null,
  declineNote: null,
};

export const customerDisplayFixtures = {
  "capture-processing": { ...customerDisplay, status: "capture-processing" },
  "payment-required-open": {
    ...customerDisplay,
    status: "payment-required",
    paymentRequiredWindow: {
      recordedAt: "2099-08-21T09:00:00.000Z",
      deadline: "2099-08-21T09:20:00.000Z",
      phase: "open",
    },
    statusNotifications: [
      {
        id: "00000000-0000-4000-8000-000000000146",
        status: "payment-required",
        createdAt: "2099-08-21T09:00:00.000Z",
      },
    ],
  },
  "payment-required-elapsed": {
    ...customerDisplay,
    status: "payment-required",
    paymentRequiredWindow: {
      recordedAt: "2099-08-21T09:00:00.000Z",
      deadline: "2099-08-21T09:20:00.000Z",
      phase: "elapsed",
    },
  },
  "payment-expiry-processing": {
    ...customerDisplay,
    status: "payment-required",
    paymentRequiredExpiry: {
      status: "processing",
      deadline: "2099-08-21T09:20:00.000Z",
    },
    paymentRequiredWindow: {
      recordedAt: "2099-08-21T09:00:00.000Z",
      deadline: "2099-08-21T09:20:00.000Z",
      phase: "elapsed",
    },
  },
  "payment-expiry-attention-required": {
    ...customerDisplay,
    status: "payment-required",
    paymentRequiredExpiry: {
      status: "attention-required",
      deadline: "2099-08-21T09:20:00.000Z",
    },
    paymentRequiredWindow: {
      recordedAt: "2099-08-21T09:00:00.000Z",
      deadline: "2099-08-21T09:20:00.000Z",
      phase: "elapsed",
    },
  },
  "payment-expiry-expired": {
    ...customerDisplay,
    status: "expired",
    paymentRequiredExpiry: {
      status: "expired",
      deadline: "2099-08-21T09:20:00.000Z",
    },
    statusNotifications: [
      {
        id: "00000000-0000-4000-8000-000000000147",
        status: "expired",
        createdAt: "2099-08-21T09:21:00.000Z",
      },
    ],
  },
  "paid-confirmed": { ...customerDisplay, status: "paid-confirmed" },
} satisfies Record<
  | "capture-processing"
  | "payment-required-open"
  | "payment-required-elapsed"
  | "payment-expiry-processing"
  | "payment-expiry-attention-required"
  | "payment-expiry-expired"
  | "paid-confirmed",
  CustomerBookingRequestDisplay
>;

const ownerDisplay = {
  ...sharedRequest,
  ...restrictedFields,
  customerName: "Fictional Customer",
  partySize: 4,
  bookingNote: "Garden seating, please.",
  bookingPriceIqd: 100_003,
  marketplaceCommissionFils: 10_000_300,
  ownerNetFils: 90_002_700,
  houseRules: "No smoking",
  bookingTermsVersion: "terms-v1",
  cancellationPolicyVersion: "cancel-v1",
  createdAt: "2099-08-21T17:00:00.000Z",
};

export const ownerDisplayFixtures = {
  "capture-processing": { ...ownerDisplay, status: "capture-processing" },
  "payment-required-open": {
    ...ownerDisplay,
    status: "payment-required",
    paymentRequiredWindow: {
      recordedAt: "2099-08-21T09:00:00.000Z",
      deadline: "2099-08-21T09:20:00.000Z",
      phase: "open",
    },
  },
  "payment-required-elapsed": {
    ...ownerDisplay,
    status: "payment-required",
    paymentRequiredWindow: {
      recordedAt: "2099-08-21T09:00:00.000Z",
      deadline: "2099-08-21T09:20:00.000Z",
      phase: "elapsed",
    },
  },
  "payment-expiry-processing": {
    ...ownerDisplay,
    status: "payment-required",
    paymentRequiredExpiry: {
      status: "processing",
      deadline: "2099-08-21T09:20:00.000Z",
    },
    paymentRequiredWindow: {
      recordedAt: "2099-08-21T09:00:00.000Z",
      deadline: "2099-08-21T09:20:00.000Z",
      phase: "elapsed",
    },
  },
  "payment-expiry-attention-required": {
    ...ownerDisplay,
    status: "payment-required",
    paymentRequiredExpiry: {
      status: "attention-required",
      deadline: "2099-08-21T09:20:00.000Z",
    },
    paymentRequiredWindow: {
      recordedAt: "2099-08-21T09:00:00.000Z",
      deadline: "2099-08-21T09:20:00.000Z",
      phase: "elapsed",
    },
  },
  "payment-expiry-expired": {
    ...ownerDisplay,
    status: "expired",
    paymentRequiredExpiry: {
      status: "expired",
      deadline: "2099-08-21T09:20:00.000Z",
    },
    statusNotifications: [
      {
        id: "00000000-0000-4000-8000-000000000147",
        status: "expired",
        createdAt: "2099-08-21T09:21:00.000Z",
      },
    ],
  },
  "paid-confirmed": { ...ownerDisplay, status: "paid-confirmed" },
} satisfies Record<
  | "capture-processing"
  | "payment-required-open"
  | "payment-required-elapsed"
  | "payment-expiry-processing"
  | "payment-expiry-attention-required"
  | "payment-expiry-expired"
  | "paid-confirmed",
  OwnerBookingRequestNotificationDisplay
>;

export const customerRecoveryDisplayFixtures = {
  available: {
    ...customerDisplayFixtures["payment-required-open"],
    paymentRecovery: { status: "available" },
  },
  processing: {
    ...customerDisplayFixtures["payment-required-open"],
    paymentRecovery: { status: "processing" },
  },
  retryable: {
    ...customerDisplayFixtures["payment-required-open"],
    paymentRecovery: { status: "retryable" },
  },
} satisfies Record<string, CustomerBookingRequestDisplay>;

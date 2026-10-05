import type {
  BookingRequestDisplayStatus,
  CustomerBookingRequestDisplay,
} from "./booking-request-display";

export const bookingRequestProgressSteps = [
  "requested",
  "owner-decision",
  "payment",
  "confirmed",
] as const;

export type BookingRequestProgressStep =
  (typeof bookingRequestProgressSteps)[number];

export type BookingRequestProgressState =
  | "completed"
  | "current"
  | "action-required"
  | "stopped"
  | "upcoming";

type ProgressStates = readonly [
  BookingRequestProgressState,
  BookingRequestProgressState,
  BookingRequestProgressState,
  BookingRequestProgressState,
];

function progressStates(
  status: BookingRequestDisplayStatus,
  request: Pick<
    CustomerBookingRequestDisplay,
    "paymentRequiredWindow" | "paymentRequiredExpiry"
  >,
): ProgressStates {
  switch (status) {
    case "pending":
      return ["completed", "current", "upcoming", "upcoming"];
    case "processing":
    case "declined":
    case "withdrawn":
      return ["completed", "stopped", "upcoming", "upcoming"];
    case "expired":
      return request.paymentRequiredExpiry === null
        ? ["completed", "stopped", "upcoming", "upcoming"]
        : ["completed", "completed", "stopped", "upcoming"];
    case "accepted":
    case "capture-processing":
      return ["completed", "completed", "current", "upcoming"];
    case "payment-required":
      return request.paymentRequiredExpiry === null &&
        request.paymentRequiredWindow?.phase === "open"
        ? ["completed", "completed", "action-required", "upcoming"]
        : ["completed", "completed", "current", "upcoming"];
    case "paid-confirmed":
      return ["completed", "completed", "completed", "completed"];
  }
}

export function customerBookingRequestProgress(
  status: BookingRequestDisplayStatus,
  request: Pick<
    CustomerBookingRequestDisplay,
    "paymentRequiredWindow" | "paymentRequiredExpiry"
  >,
): readonly {
  readonly step: BookingRequestProgressStep;
  readonly state: BookingRequestProgressState;
}[] {
  const states = progressStates(status, request);
  return bookingRequestProgressSteps.map((step, index) => ({
    step,
    state: states[index],
  }));
}

import {
  canRecoverBookingRequestPayment,
  type CustomerBookingRequestDisplay,
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

type BookingRequestProgress = readonly {
  readonly step: BookingRequestProgressStep;
  readonly state: BookingRequestProgressState;
}[];

const confirmedStates: ProgressStates = [
  "completed",
  "completed",
  "completed",
  "completed",
];

function progressStates(
  request: Pick<
    CustomerBookingRequestDisplay,
    | "status"
    | "paymentRequiredWindow"
    | "paymentRequiredExpiry"
    | "paymentRecovery"
  >,
): ProgressStates {
  switch (request.status) {
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
      return canRecoverBookingRequestPayment(request)
        ? ["completed", "completed", "action-required", "upcoming"]
        : ["completed", "completed", "current", "upcoming"];
    case "paid-confirmed":
      return confirmedStates;
  }
}

function progressOf(states: ProgressStates): BookingRequestProgress {
  return bookingRequestProgressSteps.map((step, index) => ({
    step,
    state: states[index],
  }));
}

export const confirmedBookingProgress = progressOf(confirmedStates);

export function customerBookingRequestProgress(
  request: Pick<
    CustomerBookingRequestDisplay,
    | "status"
    | "paymentRequiredWindow"
    | "paymentRequiredExpiry"
    | "paymentRecovery"
  >,
): BookingRequestProgress {
  return progressOf(progressStates(request));
}

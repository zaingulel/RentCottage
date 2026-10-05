import type {
  BookingRequestProgressState,
  customerBookingRequestProgress,
} from "@/booking-request/booking-request-progress";
import { bookingRequestProgressMessages } from "@/i18n/booking-request-status-messages";
import type { Locale } from "@/i18n/routing";

const progressMarkers: Partial<Record<BookingRequestProgressState, string>> = {
  completed: "✓",
  "action-required": "!",
  stopped: "×",
};

export function BookingRequestProgress({
  locale,
  progress,
}: {
  locale: Locale;
  progress: ReturnType<typeof customerBookingRequestProgress>;
}) {
  const progressCopy = bookingRequestProgressMessages[locale];
  return (
    // Safari with VoiceOver drops list semantics from a list styled `list-style: none`.
    <ol
      className="booking-request-progress"
      role="list"
      aria-label={progressCopy.label}
    >
      {progress.map(({ step, state }, index) => (
        <li
          key={step}
          data-state={state}
          aria-current={
            state === "current" || state === "action-required"
              ? "step"
              : undefined
          }
        >
          <span className="booking-request-progress-marker" aria-hidden="true">
            {progressMarkers[state] ?? index + 1}
          </span>
          <span className="booking-request-progress-name">
            {progressCopy.steps[step]}
          </span>
          <span
            className={`booking-request-progress-state${state === "completed" || state === "upcoming" ? " visually-hidden" : ""}`}
          >
            {progressCopy.states[state]}
          </span>
        </li>
      ))}
    </ol>
  );
}

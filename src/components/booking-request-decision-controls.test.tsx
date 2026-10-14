import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actOnBookingRequest } = vi.hoisted(() => ({
  actOnBookingRequest: vi.fn(),
}));
vi.mock("@/booking-request/lifecycle-actions", () => ({ actOnBookingRequest }));

import { BookingRequestRowDecisionControls } from "./booking-request-decision-controls";

const bookingRequestId = "00000000-0000-4000-8000-000000000033";
const successorId = "owner-booking-requests-heading";

function renderRow(onStatusChange = vi.fn()) {
  render(
    <>
      <h2 id={successorId} tabIndex={-1}>
        Pending Booking Requests
      </h2>
      <BookingRequestRowDecisionControls
        locale="en"
        bookingRequestId={bookingRequestId}
        focusSuccessorId={successorId}
        onStatusChange={onStatusChange}
      />
    </>,
  );
  return {
    onStatusChange,
    heading: screen.getByRole("heading", { name: "Pending Booking Requests" }),
    declineToggle: screen.getByRole("button", { name: "Decline" }),
    accept: screen.getByRole("button", { name: "Accept complete request" }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function press(button: HTMLElement) {
  button.focus();
  fireEvent.click(button);
}

function openDecline(declineToggle: HTMLElement) {
  press(declineToggle);
  return {
    form: document.getElementById(
      declineToggle.getAttribute("aria-controls") ?? "",
    ),
    reason: screen.getByLabelText("Decline reason"),
    note: screen.getByRole("textbox", {
      name: /^Optional note to the Customer/,
    }),
    confirm: screen.getByRole("button", { name: "Decline complete request" }),
  };
}

describe("Booking Request row decision controls", () => {
  beforeEach(() => actOnBookingRequest.mockReset());

  it("opens the decline reason beneath the row and closes it again without moving focus", () => {
    const { declineToggle } = renderRow();
    expect(declineToggle).toHaveAttribute("aria-expanded", "false");
    expect(declineToggle).not.toHaveAttribute("aria-controls");
    expect(screen.queryByLabelText("Decline reason")).not.toBeInTheDocument();

    const { form, reason } = openDecline(declineToggle);
    expect(declineToggle).toHaveAttribute("aria-expanded", "true");
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect(form).toContainElement(reason);
    expect(form?.parentElement).toHaveClass("request-row-below");
    expect(declineToggle).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.change(reason, { target: { value: "other" } });
    press(declineToggle);
    expect(declineToggle).toHaveAttribute("aria-expanded", "false");
    expect(declineToggle).not.toHaveAttribute("aria-controls");
    expect(screen.queryByLabelText("Decline reason")).not.toBeInTheDocument();
    expect(declineToggle).toHaveFocus();

    expect(openDecline(declineToggle).reason).toHaveValue("");
    expect(actOnBookingRequest).not.toHaveBeenCalled();
  });

  it("declines with the same reason and note fields and hands focus to the successor", async () => {
    const decision = deferred<{ status: "declined" }>();
    actOnBookingRequest.mockReturnValue(decision.promise);
    const { declineToggle, heading, onStatusChange } = renderRow();
    const { reason, note, confirm } = openDecline(declineToggle);

    expect(reason).toBeRequired();
    expect(note).not.toBeRequired();
    expect(note).toHaveAttribute("maxLength", "500");
    expect(
      screen.getByText("Up to 500 characters. Do not include contact details."),
    ).toBeInTheDocument();
    press(confirm);
    expect(actOnBookingRequest).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "cottage_unavailable" } });
    fireEvent.change(note, { target: { value: "Dates clash" } });
    press(confirm);
    expect(actOnBookingRequest).toHaveBeenCalledExactlyOnceWith({
      locale: "en",
      bookingRequestId,
      action: "decline",
      declineReason: "cottage_unavailable",
      declineNote: "Dates clash",
    });
    expect(onStatusChange).toHaveBeenLastCalledWith("processing");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    await waitFor(() => expect(heading).toHaveFocus());

    decision.resolve({ status: "declined" });
    await waitFor(() =>
      expect(onStatusChange).toHaveBeenLastCalledWith("declined"),
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(heading).toHaveFocus();
  });

  it("keeps the decline reason open with an error after a failed decline", async () => {
    actOnBookingRequest.mockRejectedValueOnce(
      new Error("transport unavailable"),
    );
    const { declineToggle, heading, onStatusChange } = renderRow();
    const { reason, confirm } = openDecline(declineToggle);
    fireEvent.change(reason, { target: { value: "other" } });
    press(confirm);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "could not be updated safely",
      ),
    );
    expect(onStatusChange).toHaveBeenLastCalledWith("pending");
    const toggle = screen.getByRole("button", { name: "Decline" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const form = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(form).toContainElement(screen.getByLabelText("Decline reason"));
    expect(screen.getByLabelText("Decline reason")).toHaveValue("");
    expect(form?.parentElement).toContainElement(screen.getByRole("alert"));
    expect(
      screen.getByRole("button", { name: "Decline complete request" }),
    ).toBeEnabled();
    expect(heading).toHaveFocus();
  });

  it("accepts under today's accessible name and hands focus to the successor", async () => {
    const decision = deferred<{ status: "accepted" }>();
    actOnBookingRequest.mockReturnValue(decision.promise);
    const { accept, declineToggle, heading, onStatusChange } = renderRow();
    expect(accept).toHaveTextContent(/^Accept$/);
    expect(declineToggle).toHaveTextContent(/^Decline$/);

    press(accept);
    expect(actOnBookingRequest).toHaveBeenCalledExactlyOnceWith({
      locale: "en",
      bookingRequestId,
      action: "accept",
      declineReason: undefined,
      declineNote: undefined,
    });
    expect(accept).toBeDisabled();
    expect(accept).toHaveAttribute("aria-busy", "true");
    expect(onStatusChange).not.toHaveBeenCalled();

    decision.resolve({ status: "accepted" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith("accepted");
    expect(accept).not.toBeInTheDocument();
    expect(declineToggle).not.toBeInTheDocument();
  });

  it("returns focus to Accept with an error after a failed accept", async () => {
    const release = deferred<void>();
    actOnBookingRequest.mockImplementationOnce(async () => {
      await release.promise;
      throw new Error("transport unavailable");
    });
    const { accept, declineToggle, onStatusChange } = renderRow();

    press(accept);
    expect(accept).toBeDisabled();

    release.resolve();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "could not be updated safely",
      ),
    );
    expect(accept).toBeEnabled();
    expect(accept).toHaveFocus();
    expect(screen.getByRole("alert").parentElement).toHaveClass(
      "request-row-below",
    );
    expect(declineToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Decline reason")).not.toBeInTheDocument();
    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith("pending");
  });
});

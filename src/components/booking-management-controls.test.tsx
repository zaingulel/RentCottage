import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, expect, vi } from "vitest";
const action = vi.hoisted(() => vi.fn());
vi.mock("@/booking-request/booking-management-actions", () => ({
  manageConfirmedBooking: action,
}));
import { BookingManagementControl } from "./booking-management-controls";
const props = {
  locale: "en" as const,
  reference: "RC-REQ-0000000000001001",
  actorRole: "platform_administrator" as const,
  commandId: "90000000-0000-4000-8000-000000003855",
  action: "refund" as const,
};
describe("booking command controls", () => {
  beforeEach(() => vi.clearAllMocks());
  it("retains fields and exact identity after an uncertain result, then accepts a fresh successful-render identity", async () => {
    const user = userEvent.setup();
    action.mockResolvedValue({ status: "unavailable" });
    const rendered = render(<BookingManagementControl {...props} />);
    await user.type(screen.getByLabelText("Reason"), "Private compensation");
    await user.clear(screen.getByLabelText("Booking price to refund (IQD)"));
    await user.type(
      screen.getByLabelText("Booking price to refund (IQD)"),
      "20.01",
    );
    await user.click(screen.getByRole("button", { name: "Approve refund" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Reason")).toHaveValue("Private compensation");
    await user.click(screen.getByRole("button", { name: "Approve refund" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(
      action.mock.calls.map((call) => (call[1] as FormData).get("commandId")),
    ).toEqual([props.commandId, props.commandId]);
    const next = "90000000-0000-4000-8000-000000003856";
    rendered.rerender(
      <BookingManagementControl key={next} {...props} commandId={next} />,
    );
    expect(screen.getByLabelText("Reason")).toHaveValue("");
    action.mockResolvedValue({ status: "requested" });
    await user.type(screen.getByLabelText("Reason"), "Separate approval");
    await user.type(
      screen.getByLabelText("Booking price to refund (IQD)"),
      "10",
    );
    await user.click(screen.getByRole("button", { name: "Approve refund" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(3));
    expect((action.mock.calls[2][1] as FormData).get("commandId")).toBe(next);
  });
  it("discloses policy before a keyboard-confirmed customer cancellation", async () => {
    const user = userEvent.setup();
    action.mockResolvedValue({ status: "cancelled" });
    render(
      <BookingManagementControl
        {...props}
        action="cancel"
        actorRole="customer"
      />,
    );
    expect(
      screen.getByText(/Marketplace time at submission/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
    screen.getByRole("checkbox").focus();
    await user.keyboard("[Space][Tab][Enter]");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});

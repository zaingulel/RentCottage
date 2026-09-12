import { describe, expect, it, vi } from "vitest";
import { listConfirmedBookingHistory } from "./confirmed-booking-history";
const item = {
  receiptId: "82000000-0000-4000-8000-000000003502",
  bookingRequestReference: "RC-REQ-0000000000003501",
  bookingReference: "CONFIRMED-BOOKING-35",
  cottageName: "Preserved Cottage",
  confirmedAt: "2100-12-31T13:00:00Z",
  actorRole: "customer",
  cancelled: false,
  lifecycleStatus: "completed",
};
describe("confirmed Booking History parser", () => {
  it("accepts the minimal paid return-navigation row", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [item], error: null });
    await expect(
      listConfirmedBookingHistory({ rpc } as never),
    ).resolves.toEqual([item]);
    expect(rpc).toHaveBeenCalledWith("list_confirmed_booking_history");
  });
  it("requires an explicit retained cancellation status", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...item, cancelled: undefined }],
      error: null,
    });
    await expect(listConfirmedBookingHistory({ rpc } as never)).rejects.toThrow(
      "data is invalid",
    );
  });
  it("strips unexpected private data and requires a valid lifecycle outcome", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ ...item, incidents: [{ narrative: "PRIVATE" }] }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ ...item, lifecycleStatus: "unknown" }],
        error: null,
      });
    expect(await listConfirmedBookingHistory({ rpc } as never)).toEqual([item]);
    await expect(
      listConfirmedBookingHistory({ rpc } as never),
    ).rejects.toThrow();
  });
  it("fails closed on an unbound route", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...item, bookingRequestReference: "wrong" }],
      error: null,
    });
    await expect(listConfirmedBookingHistory({ rpc } as never)).rejects.toThrow(
      "data is invalid",
    );
  });
});

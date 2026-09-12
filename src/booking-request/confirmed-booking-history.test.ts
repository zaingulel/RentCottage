import { describe, expect, it, vi } from "vitest";
import { listBookingHistory } from "./booking-history";
const item = {
  bookingRequestId: "60000000-0000-4000-8000-000000003501",
  bookingRequestReference: "RC-REQ-0000000000003501",
  bookingReference: null,
  cottageName: "Preserved Cottage",
  createdAt: "2100-12-30T13:00:00Z",
  firstStartsAt: "2101-01-02T00:30:00+03:00",
  lastEndsAt: "2101-01-02T04:30:00+03:00",
  actorRole: "customer",
  status: "pending",
};
describe("Booking History parser", () => {
  it("accepts the database-shaped unconfirmed request without manufacturing a receipt", async () => {
    const databaseItem = Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== "bookingReference"),
    );
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [databaseItem], error: null });
    await expect(
      listBookingHistory({ rpc } as never, "customer"),
    ).resolves.toEqual([item]);
    expect(rpc).toHaveBeenCalledWith("list_booking_history", {
      target_actor_role: "customer",
    });
  });
  it("accepts a genuine confirmed receipt and durable lifecycle outcome", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          ...item,
          receiptId: "82000000-0000-4000-8000-000000003502",
          bookingReference: "CONFIRMED-BOOKING-35",
          confirmedAt: "2100-12-31T13:00:00Z",
          status: "completed",
        },
      ],
      error: null,
    });
    await expect(
      listBookingHistory({ rpc } as never, "customer"),
    ).resolves.toMatchObject([
      {
        status: "completed",
        receiptId: "82000000-0000-4000-8000-000000003502",
      },
    ]);
  });
  it("strips unexpected private data and requires a truthful outcome", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ ...item, address: "PRIVATE", phone: "PRIVATE" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ ...item, status: "unknown" }],
        error: null,
      });
    expect(await listBookingHistory({ rpc } as never, "customer")).toEqual([
      item,
    ]);
    await expect(
      listBookingHistory({ rpc } as never, "customer"),
    ).rejects.toThrow();
  });
  it("fails closed on an unbound route", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...item, bookingRequestReference: "wrong" }],
      error: null,
    });
    await expect(
      listBookingHistory({ rpc } as never, "customer"),
    ).rejects.toThrow("data is invalid");
  });
});

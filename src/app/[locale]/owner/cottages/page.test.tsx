import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  listOwner,
  loadOwnerBookingRequestNotifications,
  loadOwnerCottageAccess,
  notFound,
  router,
} = vi.hoisted(() => ({
  listOwner: vi.fn(),
  loadOwnerBookingRequestNotifications: vi.fn(),
  loadOwnerCottageAccess: vi.fn(),
  notFound: vi.fn(),
  router: { refresh: vi.fn() },
}));

vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: vi.fn().mockResolvedValue({
    status: "authenticated",
    context: {
      userId: "fixture",
      role: "cottage_owner",
      approvalState: "approved",
    },
  }),
}));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound,
  unstable_rethrow: vi.fn(),
  useRouter: () => router,
}));
vi.mock("@/cottage-profile/request-owner-cottage-access", () => ({
  loadOwnerCottageAccess,
}));
vi.mock(
  "@/booking-request/request-owner-booking-request-notifications",
  () => ({
    loadOwnerBookingRequestNotifications,
  }),
);
vi.mock("@/components/cottage-profile-overview", () => ({
  CottageProfileOverview: () => <h1>Your cottages</h1>,
}));

import { ownerDisplayFixtures } from "../../../../../tests/fixtures/booking-request-display.fixtures";
import OwnerCottagesPage from "./page";

function notification(
  suffix: string,
  status: "pending" | "payment-required" = "pending",
) {
  return {
    ...ownerDisplayFixtures["payment-required-open"],
    id: `00000000-0000-4000-8000-00000000090${suffix}`,
    bookingRequestReference: `RC-REQ-AAAAAAAAAAAAAAA${suffix}`,
    status,
  };
}

describe("owner Cottage Profiles page", () => {
  it("keeps profiles available but suppresses the alert query outside the isolated test runtime", async () => {
    listOwner.mockResolvedValue([]);
    loadOwnerCottageAccess.mockImplementation(async (load) => ({
      status: "ready",
      value: await load({ listOwner }, "approved"),
    }));
    vi.stubEnv("APP_ENVIRONMENT", "development");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");

    render(
      await OwnerCottagesPage({
        params: Promise.resolve({ locale: "en" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Your cottages" }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Online Booking Request alerts are not available yet",
    );
    expect(listOwner).toHaveBeenCalledOnce();
    expect(loadOwnerBookingRequestNotifications).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Bookings for my cottages" }),
    ).toBeVisible();
  });

  it("shows on the Bookings tab the number of pending Booking Requests the page lists", async () => {
    listOwner.mockResolvedValue([]);
    loadOwnerCottageAccess.mockImplementation(async (load) => ({
      status: "ready",
      value: await load({ listOwner }, "approved"),
    }));
    loadOwnerBookingRequestNotifications.mockResolvedValue([
      notification("1"),
      notification("2", "payment-required"),
      notification("3"),
    ]);
    vi.stubEnv("APP_ENVIRONMENT", "test");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");

    render(
      await OwnerCottagesPage({
        params: Promise.resolve({ locale: "en" }),
      }),
    );

    const bookings = within(
      screen.getByRole("navigation", { name: "Owner Backoffice" }),
    ).getByRole("link", { name: /^Bookings for my cottages/ });
    expect(bookings).toHaveAccessibleName(
      "Bookings for my cottages Pending Booking Requests: 2",
    );
    expect(
      screen.getAllByRole("button", { name: "Accept complete request" }),
    ).toHaveLength(2);
  });

  it("shows the Owner Backoffice navigation on the cottages list with no brand link of its own", async () => {
    listOwner.mockResolvedValue([]);
    loadOwnerCottageAccess.mockImplementation(async (load) => ({
      status: "ready",
      value: await load({ listOwner }, "approved"),
    }));
    vi.stubEnv("APP_ENVIRONMENT", "development");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");

    render(
      await OwnerCottagesPage({
        params: Promise.resolve({ locale: "en" }),
      }),
    );

    expect(screen.getByRole("main")).toHaveClass("results-page", "page");
    const navigation = within(
      screen.getByRole("navigation", { name: "Owner Backoffice" }),
    );
    expect(
      navigation.getByRole("link", { name: "Manage my cottages" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getAllByRole("link", { name: "Bookings for my cottages" }),
    ).toHaveLength(1);
    expect(
      navigation.getByRole("link", { name: "Bookings for my cottages" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "RentCottage" }),
    ).not.toBeInTheDocument();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });
});

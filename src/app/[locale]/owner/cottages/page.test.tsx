import { render, screen } from "@testing-library/react";
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

import OwnerCottagesPage from "./page";

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
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });
});

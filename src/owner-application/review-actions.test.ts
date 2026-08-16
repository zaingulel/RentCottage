import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRequestClient, revalidatePath, rpc } = vi.hoisted(() => ({
  createRequestClient: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createRequestClient,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { reviewOwnerApplicationAction } from "./review-actions";

function reviewForm(action: string) {
  const form = new FormData();
  form.set("locale", "en");
  form.set("action", action);
  form.set("applicationId", "20000000-0000-4000-8000-000000000001");
  form.set("expectedVersion", "4");
  return form;
}

describe("Owner Application review action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRequestClient.mockResolvedValue({ rpc });
  });

  it("rejects an empty information-request scope before creating a provider client", async () => {
    const form = reviewForm("request_information");
    form.set("reason", "Provide missing information.");

    await expect(
      reviewOwnerApplicationAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "invalid" });
    expect(createRequestClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["RC422", "invalid"],
    ["RC409", "conflict"],
    ["XX000", "unavailable"],
  ] as const)("maps provider code %s to %s", async (code, status) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code, message: "private provider detail" },
    });
    const form = reviewForm("reject");
    form.set("reason", "Recorded rejection reason.");

    await expect(
      reviewOwnerApplicationAction({ status: "idle" }, form),
    ).resolves.toEqual({ status });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

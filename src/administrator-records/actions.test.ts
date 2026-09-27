import { beforeEach, describe, expect, it, vi } from "vitest";

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("./supabase-administrator-records", () => ({
  searchAdministratorRecords: search,
}));
import { searchAdministratorRecordsAction } from "./actions";

describe("administrator records Server Action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects hostile form data and never trusts previous results", async () => {
    const form = new FormData();
    form.set("locale", "en");
    form.set("kind", "customers");
    form.append("kind", "owners");
    await expect(
      searchAdministratorRecordsAction(
        { status: "ready", page: { rows: [{ email: "private" }] } } as never,
        form,
      ),
    ).resolves.toEqual({ status: "invalid" });
    expect(search).not.toHaveBeenCalled();
    form.delete("kind");
    form.set("kind", "owners");
    form.set("query", "' OR 1=1 --");
    search.mockResolvedValue({ status: "access_required" });
    await expect(
      searchAdministratorRecordsAction({ status: "ready" } as never, form),
    ).resolves.toEqual({ status: "access_required" });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "owners", query: "' OR 1=1 --" }),
    );
  });

  it("clears stale results on unavailable and invalid locale", async () => {
    const form = new FormData();
    form.set("locale", "en");
    form.set("kind", "customers");
    search.mockResolvedValue({ status: "unavailable" });
    await expect(
      searchAdministratorRecordsAction(
        { status: "ready", page: { rows: [1] } } as never,
        form,
      ),
    ).resolves.toEqual({ status: "unavailable" });
    form.set("locale", "bad");
    await expect(
      searchAdministratorRecordsAction({ status: "idle" } as never, form),
    ).resolves.toEqual({ status: "invalid" });
  });
});

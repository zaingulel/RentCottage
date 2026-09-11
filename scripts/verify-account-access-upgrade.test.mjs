import { describe, it, expect, vi } from "vitest";
import { verifyAccountAccessUpgrade } from "./verify-account-access-upgrade.mjs";
const environment = {
  SUPABASE_LOCAL_PROJECT: "rentcottage-job-214",
  SUPABASE_LOCAL_WORKDIR: "/private/tmp/exact-214",
};
describe("account migration disposable boundary", () => {
  it("does not reset or restore after initial ownership rejection", () => {
    const runSupabase = vi.fn();
    const guardDisposableLocalDatabase = vi.fn(() => {
      throw Error("wrong owner");
    });
    expect(() =>
      verifyAccountAccessUpgrade({
        environment,
        harness: { guardDisposableLocalDatabase },
        runSupabase,
      }),
    ).toThrow("wrong owner");
    expect(runSupabase).not.toHaveBeenCalled();
  });
  it("restores current schema after proof failure", () => {
    const runSupabase = vi.fn();
    const guardDisposableLocalDatabase = vi.fn();
    const harness = {
      guardDisposableLocalDatabase,
      runSql: vi.fn().mockReturnValue("incorrect predecessor"),
    };
    expect(() =>
      verifyAccountAccessUpgrade({ environment, harness, runSupabase }),
    ).toThrow("Upgrade starts on the exact predecessor");
    expect(runSupabase.mock.calls).toEqual([
      [["db", "reset", "--local", "--version", "20260909221736"]],
      [["db", "reset", "--local"]],
    ]);
    expect(guardDisposableLocalDatabase).toHaveBeenCalledTimes(2);
  });
  it("preserves proof and restore failure together", () => {
    const runSupabase = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw Error("restore unavailable");
      });
    const harness = {
      guardDisposableLocalDatabase: vi.fn(),
      runSql: vi.fn().mockReturnValue("wrong"),
    };
    let failure;
    try {
      verifyAccountAccessUpgrade({ environment, harness, runSupabase });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toHaveLength(2);
  });
});

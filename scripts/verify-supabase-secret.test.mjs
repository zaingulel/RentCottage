import { describe, expect, it, vi } from "vitest";

import { main, verifySupabaseSecret } from "./verify-supabase-secret.mjs";

const validEnvironment = {
  SUPABASE_PROJECT_REF: "preview-project",
  SUPABASE_URL: "https://preview-project.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_valid-value",
};

describe("Supabase server secret verification command", () => {
  it("validates the server secret without exposing it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await verifySupabaseSecret(validEnvironment, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://preview-project.supabase.co/rest/v1/",
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { apikey: "sb_secret_valid-value" },
      redirect: "error",
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 403])(
    "fails safely when Supabase rejects the server secret with HTTP %i",
    async (status) => {
      const stderr = vi.fn();
      const exitCode = await main([], {
        source: validEnvironment,
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status }),
        stderr,
      });

      expect(exitCode).toBe(1);
      expect(stderr).toHaveBeenCalledWith(
        "Supabase server secret verification failed: secret rejected",
      );
      expect(JSON.stringify(stderr.mock.calls)).not.toContain(
        validEnvironment.SUPABASE_SECRET_KEY,
      );
    },
  );

  it("rejects surrounding whitespace and mismatched project origins before fetching", async () => {
    const fetchImpl = vi.fn();

    await expect(
      verifySupabaseSecret(
        { ...validEnvironment, SUPABASE_SECRET_KEY: " secret-with-spaces " },
        fetchImpl,
      ),
    ).rejects.toThrow();
    await expect(
      verifySupabaseSecret(
        {
          ...validEnvironment,
          SUPABASE_URL: "https://different-project.supabase.co",
        },
        fetchImpl,
      ),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports safe configuration and network failure categories", async () => {
    const configurationStderr = vi.fn();
    await expect(
      main([], {
        source: { ...validEnvironment, SUPABASE_URL: "not-a-url" },
        fetchImpl: vi.fn(),
        stderr: configurationStderr,
      }),
    ).resolves.toBe(1);
    expect(configurationStderr).toHaveBeenCalledWith(
      "Supabase server secret verification failed: invalid configuration",
    );

    const networkStderr = vi.fn();
    await expect(
      main([], {
        source: validEnvironment,
        fetchImpl: vi.fn().mockRejectedValue(new Error("provider detail")),
        stderr: networkStderr,
      }),
    ).resolves.toBe(1);
    expect(networkStderr).toHaveBeenCalledWith(
      "Supabase server secret verification failed: unable to reach Supabase",
    );
    expect(JSON.stringify(networkStderr.mock.calls)).not.toContain(
      "provider detail",
    );
  });

  it.each([
    [429, "provider unavailable"],
    [500, "provider unavailable"],
    [503, "provider unavailable"],
    [599, "provider unavailable"],
    [404, "unexpected Supabase response"],
  ])(
    "classifies HTTP %i without blaming the secret",
    async (status, category) => {
      const stderr = vi.fn();

      await expect(
        main([], {
          source: validEnvironment,
          fetchImpl: vi.fn().mockResolvedValue({ ok: false, status }),
          stderr,
        }),
      ).resolves.toBe(1);
      expect(stderr).toHaveBeenCalledWith(
        `Supabase server secret verification failed: ${category}`,
      );
    },
  );
});

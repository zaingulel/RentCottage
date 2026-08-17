import { describe, expect, it, vi } from "vitest";
import { main, parsePreviewUrl, verifyPreview } from "./verify-preview.mjs";

function response({ ok = true, status = ok ? 200 : 503, json = {} } = {}) {
  return {
    ok,
    status,
    json: async () => json,
  };
}

function healthyPreviewFetch(commit = "abc123def456") {
  return vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(
      response({
        json: {
          ok: true,
          deployment: { commit },
          supabase: { connected: true },
        },
      }),
    );
}

describe("preview verification command", () => {
  it("rejects malformed arguments before making a request", async () => {
    const fetchImpl = vi.fn();
    const stderr = vi.fn();

    const exitCode = await main(["not-a-url"], {
      fetchImpl,
      resolveCommit: () => "abc123",
      stderr,
      stdout: vi.fn(),
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      "Usage: npm run verify:preview -- <https-preview-url>",
    );
  });

  it("allows HTTPS origins and loopback HTTP origins only", () => {
    expect(parsePreviewUrl("https://preview.example.com").href).toBe(
      "https://preview.example.com/",
    );
    expect(parsePreviewUrl("http://127.0.0.1:8788").href).toBe(
      "http://127.0.0.1:8788/",
    );

    expect(() => parsePreviewUrl("http://preview.example.com")).toThrow();
    expect(() => parsePreviewUrl("ftp://localhost")).toThrow();
    expect(() => parsePreviewUrl("ws://127.0.0.1")).toThrow();
    expect(() => parsePreviewUrl("https://user:secret@example.com")).toThrow();
    expect(() => parsePreviewUrl("https://example.com/nested")).toThrow();
  });

  it("proves the Arabic shell and connected Supabase health boundary", async () => {
    const fetchImpl = healthyPreviewFetch();

    await expect(
      verifyPreview(
        new URL("https://preview.example.com"),
        "abc123def456",
        fetchImpl,
      ),
    ).resolves.toEqual({
      shellUrl: "https://preview.example.com/ar",
      healthUrl: "https://preview.example.com/api/health?check=supabase",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries boundedly while a new Cloudflare deployment propagates", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: false, status: 404 }))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ ok: false }))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        response({
          json: {
            ok: true,
            deployment: { commit: "abc123def456" },
            supabase: { connected: true },
          },
        }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyPreview(
        new URL("https://preview.example.com"),
        "abc123def456",
        fetchImpl,
        { maxAttempts: 3, retryDelayMs: 1, sleep },
      ),
    ).resolves.toEqual({
      shellUrl: "https://preview.example.com/ar",
      healthUrl: "https://preview.example.com/api/health?check=supabase",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls).toEqual([[1], [2]]);
  });

  it("returns the last transient error after exhausting bounded retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: false }))
      .mockResolvedValueOnce(response({ ok: false }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyPreview(
        new URL("https://preview.example.com"),
        "abc123def456",
        fetchImpl,
        { maxAttempts: 2, retryDelayMs: 1, sleep },
      ),
    ).rejects.toThrow("Arabic shell returned HTTP 503");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("fails immediately on a non-transient authorization response", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyPreview(
        new URL("https://preview.example.com"),
        "abc123def456",
        fetchImpl,
        { maxAttempts: 6, retryDelayMs: 1, sleep },
      ),
    ).rejects.toThrow("Arabic shell returned HTTP 401");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails when the hosted health check cannot prove Supabase connectivity", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        response({
          json: {
            ok: true,
            deployment: { commit: "abc123def456" },
            supabase: { connected: false },
          },
        }),
      );

    await expect(
      verifyPreview(
        new URL("https://preview.example.com"),
        "abc123def456",
        fetchImpl,
        { maxAttempts: 1 },
      ),
    ).rejects.toThrow("did not prove Supabase connectivity");
  });

  it("fails when the hosted Worker is not the exact checked-out commit", async () => {
    await expect(
      verifyPreview(
        new URL("https://preview.example.com"),
        "expected-head",
        healthyPreviewFetch("previous-head"),
        { maxAttempts: 1 },
      ),
    ).rejects.toThrow("did not serve expected commit expected-head");
  });

  it("aborts a hosted request that does not respond", async () => {
    vi.useFakeTimers();
    let requestSignal;
    const fetchImpl = vi.fn((_url, options) => {
      requestSignal = options.signal;
      if (!requestSignal) throw new Error("missing abort signal");
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    try {
      const verification = verifyPreview(
        new URL("https://preview.example.com"),
        "abc123def456",
        fetchImpl,
        { maxAttempts: 1 },
      );
      const rejection = expect(verification).rejects.toThrow(
        "timed out after 10000ms",
      );
      await vi.advanceTimersByTimeAsync(10_000);

      await rejection;
      expect(requestSignal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the exact verified URL and commit", async () => {
    const stdout = vi.fn();
    const fetchImpl = healthyPreviewFetch("abc123def456");

    const exitCode = await main(["https://preview.example.com"], {
      fetchImpl,
      resolveCommit: () => "abc123def456",
      retryOptions: { maxAttempts: 1 },
      stderr: vi.fn(),
      stdout,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(
      "Verified preview https://preview.example.com/ at commit abc123def456",
    );
  });

  it("returns failure when hosted verification fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ ok: false }));
    const stderr = vi.fn();

    const exitCode = await main(["https://preview.example.com"], {
      fetchImpl,
      resolveCommit: () => "unused",
      retryOptions: { maxAttempts: 1 },
      stderr,
      stdout: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Preview verification failed: Arabic shell returned HTTP 503",
    );
  });
});

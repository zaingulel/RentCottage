import { describe, expect, it, vi } from "vitest";
import { main, parsePreviewUrl, verifyPreview } from "./verify-preview.mjs";

function response({ ok = true, json = {} } = {}) {
  return {
    ok,
    status: ok ? 200 : 503,
    json: async () => json,
  };
}

function healthyPreviewFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(
      response({ json: { ok: true, supabase: { connected: true } } }),
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
      verifyPreview(new URL("https://preview.example.com"), fetchImpl),
    ).resolves.toEqual({
      shellUrl: "https://preview.example.com/ar",
      healthUrl: "https://preview.example.com/api/health?check=supabase",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails when the hosted health check cannot prove Supabase connectivity", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        response({ json: { ok: true, supabase: { connected: false } } }),
      );

    await expect(
      verifyPreview(new URL("https://preview.example.com"), fetchImpl),
    ).rejects.toThrow("did not prove Supabase connectivity");
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
        fetchImpl,
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
    const fetchImpl = healthyPreviewFetch();

    const exitCode = await main(["https://preview.example.com"], {
      fetchImpl,
      resolveCommit: () => "abc123def456",
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
      stderr,
      stdout: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Preview verification failed: Arabic shell returned HTTP 503",
    );
  });
});

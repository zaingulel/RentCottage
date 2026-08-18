import { afterEach, describe, expect, it, vi } from "vitest";

import { createCottagePublicationMediaService } from "./cottage-publication-media";

const adapter = {
  resolveMedia: vi.fn(async () => "private/photo.webp"),
  signMedia: vi.fn(async () => "https://storage.test/signed"),
};

function service(fetchMedia: typeof fetch) {
  return createCottagePublicationMediaService({
    adapter,
    configuredSupabaseUrl: "https://storage.test",
    fetchMedia,
    timeoutMilliseconds: 1_000,
  });
}

describe("Cottage publication media service", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns approved same-origin image bytes without provider response metadata", async () => {
    const fetchMedia = vi.fn(async () =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "Content-Type": "image/webp",
            "x-provider-path": "owner/profile/private-photo.webp",
          },
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await service(fetchMedia).load(
      "40000000-0000-4000-8000-000000000024",
    );

    expect(result).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/webp",
    });
  });

  it("follows a same-origin redirect before returning the image", async () => {
    const fetchMedia = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "/storage/object?token=secret" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([4, 5]), {
          headers: { "Content-Type": "image/png" },
        }),
      ) as unknown as typeof fetch;

    const result = await service(fetchMedia).load(
      "40000000-0000-4000-8000-000000000024",
    );

    expect(result).toEqual({
      bytes: new Uint8Array([4, 5]),
      contentType: "image/png",
    });
    expect(fetchMedia).toHaveBeenNthCalledWith(
      2,
      "https://storage.test/storage/object?token=secret",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects an unexpected signed URL origin before fetching", async () => {
    adapter.signMedia.mockResolvedValueOnce(
      "https://attacker.test/private-photo.webp",
    );
    const fetchMedia = vi.fn() as unknown as typeof fetch;

    await expect(
      service(fetchMedia).load("40000000-0000-4000-8000-000000000024"),
    ).rejects.toMatchObject({ phase: "origin" });
    expect(fetchMedia).not.toHaveBeenCalled();
  });
});

describe("Cottage publication media service time bounds", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("aborts a signed provider fetch that never returns headers", async () => {
    vi.useFakeTimers();
    const fetchMedia = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;

    const pending = service(fetchMedia).load(
      "40000000-0000-4000-8000-000000000024",
    );
    const assertion = expect(pending).rejects.toMatchObject({
      phase: "timeout",
    });
    await vi.advanceTimersByTimeAsync(1_001);

    await assertion;
  });

  it("aborts a provider stream that stalls after successful headers", async () => {
    vi.useFakeTimers();
    const fetchMedia = vi.fn(async () =>
      Promise.resolve(
        new Response(new ReadableStream({ start() {} }), {
          headers: { "Content-Type": "image/png" },
        }),
      ),
    ) as unknown as typeof fetch;

    const pending = service(fetchMedia).load(
      "40000000-0000-4000-8000-000000000024",
    );
    const assertion = expect(pending).rejects.toMatchObject({
      phase: "timeout",
    });
    await vi.advanceTimersByTimeAsync(1_001);

    await assertion;
  });
});

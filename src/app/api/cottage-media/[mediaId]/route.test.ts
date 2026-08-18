import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveMedia = vi.fn();
const createSignedUrl = vi.fn();
const fetchMedia = vi.fn();
const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("@/cottage-publication/request-cottage-publication", async () => {
  const { createCottagePublicationMediaService } = await vi.importActual<
    typeof import("@/cottage-publication/cottage-publication-media")
  >("@/cottage-publication/cottage-publication-media");
  return {
    createRequestCottagePublicationMedia: vi.fn(() =>
      createCottagePublicationMediaService({
        adapter: {
          resolveMedia,
          async signMedia(objectPath: string) {
            const result = await createSignedUrl(objectPath, 60);
            if (result.error || !result.data?.signedUrl)
              throw new Error("signing failed");
            return result.data.signedUrl;
          },
        },
        configuredSupabaseUrl: "https://storage.test",
        fetchMedia,
      }),
    ),
  };
});

import { GET } from "./route";

describe("approved Cottage publication media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMedia);
  });

  it("proxies approved media without exposing its signed URL or private path", async () => {
    resolveMedia.mockResolvedValue("owner/profile/private-photo.webp");
    createSignedUrl.mockResolvedValue({
      data: {
        signedUrl:
          "https://storage.test/owner/profile/private-photo.webp?token=secret",
      },
      error: null,
    });
    fetchMedia.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Type": "image/webp",
          "x-provider-path": "owner/profile/private-photo.webp",
        },
      }),
    );

    const response = await GET(
      new Request("https://app.test/api/cottage-media/id"),
      {
        params: Promise.resolve({
          mediaId: "40000000-0000-4000-8000-000000000024",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-provider-path")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(createSignedUrl).toHaveBeenCalledWith(
      "owner/profile/private-photo.webp",
      60,
    );
    expect(fetchMedia).toHaveBeenCalledWith(
      "https://storage.test/owner/profile/private-photo.webp?token=secret",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("follows only bounded same-origin provider redirects", async () => {
    resolveMedia.mockResolvedValue("private/photo.webp");
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.test/signed" },
      error: null,
    });
    fetchMedia
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "/storage/object?token=secret" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "image/png" },
        }),
      );

    const response = await GET(
      new Request("https://app.test/api/cottage-media/id"),
      {
        params: Promise.resolve({
          mediaId: "40000000-0000-4000-8000-000000000024",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMedia).toHaveBeenNthCalledWith(
      2,
      "https://storage.test/storage/object?token=secret",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("does not follow a provider redirect to another origin", async () => {
    resolveMedia.mockResolvedValue("private/photo.webp");
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.test/signed" },
      error: null,
    });
    fetchMedia.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://attacker.test/private" },
      }),
    );

    const response = await GET(
      new Request("https://app.test/api/cottage-media/id"),
      {
        params: Promise.resolve({
          mediaId: "40000000-0000-4000-8000-000000000024",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(fetchMedia).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledWith(
      "Cottage publication media unavailable",
      { phase: "origin", result: "unavailable" },
    );
  });

  it("rejects unsafe provider content and oversized responses", async () => {
    resolveMedia.mockResolvedValue("private/photo.webp");
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.test/signed" },
      error: null,
    });
    fetchMedia.mockResolvedValueOnce(
      new Response("not an image", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    const unsafe = await GET(
      new Request("https://app.test/api/cottage-media/id"),
      {
        params: Promise.resolve({
          mediaId: "40000000-0000-4000-8000-000000000024",
        }),
      },
    );
    fetchMedia.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": "5242881",
        },
      }),
    );
    const oversized = await GET(
      new Request("https://app.test/api/cottage-media/id"),
      {
        params: Promise.resolve({
          mediaId: "40000000-0000-4000-8000-000000000024",
        }),
      },
    );

    expect(unsafe.status).toBe(404);
    expect(oversized.status).toBe(404);
    expect(diagnostic).toHaveBeenCalledWith(
      "Cottage publication media unavailable",
      expect.objectContaining({ phase: "type", result: "unavailable" }),
    );
  });

  it("rejects an unexpected signed URL origin without fetching it", async () => {
    resolveMedia.mockResolvedValue("private/photo.webp");
    createSignedUrl.mockResolvedValue({
      data: {
        signedUrl:
          "https://attacker.test/private/profile.webp?owner=secret#fragment",
      },
      error: null,
    });

    const response = await GET(
      new Request("https://app.test/api/cottage-media/id"),
      {
        params: Promise.resolve({
          mediaId: "40000000-0000-4000-8000-000000000024",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(fetchMedia).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith(
      "Cottage publication media unavailable",
      { phase: "origin", result: "unavailable" },
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("attacker");
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("owner");
  });

  it("enforces the streamed-byte limit when content length is absent", async () => {
    resolveMedia.mockResolvedValue("private/photo.webp");
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.test/signed" },
      error: null,
    });
    const oversizedChunk = new Uint8Array(5 * 1024 * 1024 + 1);
    fetchMedia.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(oversizedChunk);
            controller.close();
          },
        }),
        { headers: { "Content-Type": "image/webp" } },
      ),
    );

    const response = await GET(
      new Request("https://app.test/api/cottage-media/id"),
      {
        params: Promise.resolve({
          mediaId: "40000000-0000-4000-8000-000000000024",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(diagnostic).toHaveBeenCalledWith(
      "Cottage publication media unavailable",
      { phase: "size", result: "unavailable" },
    );
  });

  it("returns the same opaque not-found response for malformed and unavailable media", async () => {
    const malformed = await GET(
      new Request("https://app.test/api/cottage-media/nope"),
      {
        params: Promise.resolve({ mediaId: "nope" }),
      },
    );
    resolveMedia.mockRejectedValue(new Error("unavailable"));
    const unavailable = await GET(
      new Request("https://app.test/api/cottage-media/id"),
      {
        params: Promise.resolve({
          mediaId: "40000000-0000-4000-8000-000000000024",
        }),
      },
    );

    expect(await malformed.text()).toBe("Publication media is unavailable");
    expect(await unavailable.text()).toBe("Publication media is unavailable");
    expect(malformed.status).toBe(404);
    expect(unavailable.status).toBe(404);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveMedia = vi.fn();
const signMedia = vi.fn();
const fetchMedia = vi.fn();
const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("@/cottage-profile/request-cottage-profile", async () => {
  const { createCottagePublicationMediaService } = await vi.importActual<
    typeof import("@/cottage-publication/cottage-publication-media")
  >("@/cottage-publication/cottage-publication-media");
  return {
    createRequestCottageProfilePhotoMedia: vi.fn(async () =>
      createCottagePublicationMediaService({
        adapter: { resolveMedia, signMedia },
        configuredSupabaseUrl: "https://storage.test",
        fetchMedia,
      }),
    ),
  };
});

import { GET } from "./route";

const photoId = "40000000-0000-4000-8000-000000000024";
const privatePath = "owner/profile/private-photo.webp";
const signedUrl = `https://storage.test/${privatePath}?token=secret`;
const emptyWebp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function get(id: string) {
  return GET(new Request(`https://app.test/api/cottage-profile-photos/${id}`), {
    params: Promise.resolve({ photoId: id }),
  });
}

describe("private Cottage Profile photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMedia);
  });

  it("serves an authorized Cottage Profile photo without exposing its signed URL or private path", async () => {
    resolveMedia.mockResolvedValue(privatePath);
    signMedia.mockResolvedValue(signedUrl);
    fetchMedia.mockResolvedValue(
      new Response(emptyWebp, {
        headers: {
          "Content-Type": "image/webp",
          "x-provider-path": privatePath,
        },
      }),
    );

    const response = await get(photoId);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-provider-path")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(resolveMedia).toHaveBeenCalledWith(photoId);
    expect(signMedia).toHaveBeenCalledTimes(1);
    expect(signMedia).toHaveBeenCalledWith(privatePath);
    expect(fetchMedia).toHaveBeenCalledWith(
      signedUrl,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("answers a malformed, denied or unavailable photo with the same private 404 and a log line free of identifiers", async () => {
    const malformed = await get("not-a-uuid");
    expect(resolveMedia).not.toHaveBeenCalled();

    resolveMedia.mockRejectedValue(
      new Error(`denied ${photoId} ${privatePath}`),
    );
    const denied = await get(photoId);
    expect(signMedia).not.toHaveBeenCalled();

    resolveMedia.mockResolvedValue(privatePath);
    signMedia.mockResolvedValue(signedUrl);
    fetchMedia.mockResolvedValue(
      new Response("not an image", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    const unavailable = await get(photoId);

    for (const response of [malformed, denied, unavailable]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("location")).toBeNull();
      await expect(response.text()).resolves.toBe(
        "Cottage Profile photo is unavailable",
      );
    }
    expect(diagnostic).toHaveBeenCalledTimes(3);
    expect(diagnostic).toHaveBeenCalledWith(
      "Cottage Profile photo unavailable",
      { phase: "resolve", result: "unavailable" },
    );
    expect(diagnostic).toHaveBeenCalledWith(
      "Cottage Profile photo unavailable",
      { phase: "type", result: "unavailable" },
    );
    const logged = JSON.stringify(diagnostic.mock.calls);
    expect(logged).not.toContain(photoId);
    expect(logged).not.toContain(privatePath);
  });
});

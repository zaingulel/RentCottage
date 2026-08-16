import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("hosted health route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the server-only Supabase key for the privileged REST health probe", async () => {
    vi.stubEnv("APP_ENVIRONMENT", "preview");
    vi.stubEnv("SUPABASE_PROJECT_REF", "preview-project");
    vi.stubEnv("SUPABASE_URL", "https://preview-project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-browser-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret-server-key");
    vi.stubEnv("PRIVILEGED_AUDIT_HMAC_KEY", "a".repeat(32));

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("https://preview.example.com/api/health?check=supabase"),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://preview-project.supabase.co/rest/v1/",
      expect.objectContaining({
        headers: {
          apikey: "secret-server-key",
          Authorization: "Bearer secret-server-key",
        },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      supabase: { connected: true },
    });
  });
});

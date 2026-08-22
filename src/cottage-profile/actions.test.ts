import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, createRequestCottageProfile } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  createRequestCottageProfile: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("./request-cottage-profile", () => ({ createRequestCottageProfile }));

import {
  abandonAdministratorCottageProfileAction,
  abandonOwnerCottageProfileAction,
  restoreAdministratorCottageProfileAction,
  saveOwnerCottageProfileAction,
  uploadCottageProfilePhotoAction,
} from "./actions";

describe("Cottage Profile actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes normalized owner form values to the use-case seam and revalidates the editor", async () => {
    const saveOwnerDraft = vi.fn().mockResolvedValue({
      status: "saved",
      profile: { id: "70000000-0000-4000-8000-000000000001" },
    });
    createRequestCottageProfile.mockResolvedValue({ saveOwnerDraft });
    const form = new FormData();
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("expectedVersion", "2");
    form.set("name", "Continued Application Cottage");
    form.set("governorate", "Erbil");
    form.set("approximateLocation", "Near Shaqlawa");
    form.set("exactAddress", "Private exact address");
    form.set("exactLatitude", "36.408333");
    form.set("exactLongitude", "44.385834");
    form.set("privateDirections", "Continue past the orchard gate.");
    form.set("capacity", "10");
    form.set("bedrooms", "4");
    form.set("bathrooms", "3");
    form.append("amenities", "garden");
    form.append("amenities", "wifi");
    form.set("sourceLanguage", "en");
    form.set("description", "Owner working-copy description");
    form.set("houseRules", "Owner working-copy House Rules");

    await expect(
      saveOwnerCottageProfileAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "saved" });
    expect(saveOwnerDraft).toHaveBeenCalledWith(
      "70000000-0000-4000-8000-000000000001",
      2,
      expect.objectContaining({
        exactLatitude: "36.408333",
        amenities: ["garden", "wifi"],
        sourceLanguage: "en",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/en/owner/cottages/70000000-0000-4000-8000-000000000001",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/en/owner/cottages");
  });

  it("rejects an oversized photo before reading its bytes", async () => {
    const form = new FormData();
    const photo = new File([new Uint8Array([0x52])], "oversized.webp", {
      type: "image/webp",
    });
    const arrayBuffer = vi.fn();
    Object.defineProperties(photo, {
      size: { value: 5_242_881 },
      arrayBuffer: { value: arrayBuffer },
    });
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("photo", photo);

    await expect(
      uploadCottageProfilePhotoAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "invalid_photo" });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(createRequestCottageProfile).not.toHaveBeenCalled();
  });

  it("accepts a photo at the exact 5 MiB action boundary", async () => {
    const uploadPhoto = vi.fn().mockResolvedValue({ status: "uploaded" });
    createRequestCottageProfile.mockResolvedValue({ uploadPhoto });
    const form = new FormData();
    const photo = new File([new Uint8Array([0x52])], "maximum.webp", {
      type: "image/webp",
    });
    const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(12));
    Object.defineProperties(photo, {
      size: { value: 5_242_880 },
      arrayBuffer: { value: arrayBuffer },
    });
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("photo", photo);

    await expect(
      uploadCottageProfilePhotoAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "uploaded" });
    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(uploadPhoto).toHaveBeenCalledWith(
      "70000000-0000-4000-8000-000000000001",
      expect.objectContaining({ size: 5_242_880 }),
    );
  });

  it("routes owner abandonment through the authorized lifecycle seam", async () => {
    const abandonOwner = vi.fn().mockResolvedValue({ status: "abandoned" });
    createRequestCottageProfile.mockResolvedValue({ abandonOwner });
    const form = new FormData();
    form.set("locale", "ar");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("expectedVersion", "4");

    await expect(
      abandonOwnerCottageProfileAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "abandoned" });
    expect(abandonOwner).toHaveBeenCalledWith(
      "70000000-0000-4000-8000-000000000001",
      4,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/ar/owner/cottages");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/ar/administrator/cottages/70000000-0000-4000-8000-000000000001",
    );
  });

  it.each([
    [
      abandonAdministratorCottageProfileAction,
      "abandonAdministrator",
      "abandoned",
    ],
    [
      restoreAdministratorCottageProfileAction,
      "restoreAdministrator",
      "restored",
    ],
  ] as const)(
    "requires the administrator %s action to pass the recorded reason",
    async (action, method, status) => {
      const lifecycle = vi.fn().mockResolvedValue({ status });
      createRequestCottageProfile.mockResolvedValue({ [method]: lifecycle });
      const form = new FormData();
      form.set("locale", "ckb");
      form.set("profileId", "70000000-0000-4000-8000-000000000001");
      form.set("expectedVersion", "5");
      form.set("reason", "Verified duplicate");

      await expect(action({ status: "idle" }, form)).resolves.toEqual({
        status,
      });
      expect(lifecycle).toHaveBeenCalledWith(
        "70000000-0000-4000-8000-000000000001",
        5,
        "Verified duplicate",
      );
    },
  );
});

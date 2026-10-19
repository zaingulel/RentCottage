import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, createRequestCottageProfile } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  createRequestCottageProfile: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("./request-cottage-profile", () => ({ createRequestCottageProfile }));

import {
  setAdministratorCottageDescriptionVisibilityAction,
  setAdministratorCottagePhotoVisibilityAction,
  abandonAdministratorCottageProfileAction,
  abandonOwnerCottageProfileAction,
  restoreAdministratorCottageProfileAction,
  saveOwnerCottageProfileAction,
  saveAdministratorCottageProfileAction,
  deleteCottageProfilePhotoAction,
  uploadCottageProfilePhotoAction,
} from "./actions";

describe("Cottage Profile actions", () => {
  it("administrator visibility actions validate input and forward authenticated intent", async () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    const publicationId = "72000000-0000-4000-8000-000000000001";
    const photoId = "71000000-0000-4000-8000-000000000001";
    const visibility = {
      profileId,
      publicationId,
      publicSlug: "authoritative-slug",
      descriptionHidden: true,
      photos: [{ photoId, originalFilename: "cottage.webp", hidden: false }],
    };
    const description = vi
      .fn()
      .mockResolvedValue({ status: "saved", visibility });
    const photo = vi.fn().mockResolvedValue({ status: "saved", visibility });
    createRequestCottageProfile.mockResolvedValue({
      setAdministratorDescriptionHidden: description,
      setAdministratorPhotoHidden: photo,
    });
    const validForm = () => {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        locale: "ar",
        profileId,
        publicationId,
        photoId,
        hidden: "true",
        reason: " Safety review ",
        publicSlug: "hostile-slug",
      }))
        form.set(key, value);
      return form;
    };
    for (const action of [
      setAdministratorCottageDescriptionVisibilityAction,
      setAdministratorCottagePhotoVisibilityAction,
    ]) {
      for (const [key, value] of [
        ["locale", "fr"],
        ["profileId", "bad"],
        ["publicationId", "bad"],
        ["hidden", "1"],
        ["hidden", " true "],
        ["hidden", ""],
        ["reason", " "],
        ["reason", "x".repeat(1001)],
      ]) {
        const form = validForm();
        form.set(key, value);
        await expect(action({ status: "idle" }, form)).resolves.toMatchObject({
          status: "invalid",
        });
      }
      const malformed = validForm();
      malformed.set("reason", new File(["reason"], "reason.txt"));
      await expect(
        action({ status: "idle" }, malformed),
      ).resolves.toMatchObject({ status: "invalid" });
    }
    const badPhoto = validForm();
    badPhoto.set("photoId", "bad");
    await expect(
      setAdministratorCottagePhotoVisibilityAction(
        { status: "idle" },
        badPhoto,
      ),
    ).resolves.toEqual({ status: "invalid" });
    expect(createRequestCottageProfile).not.toHaveBeenCalled();
    await expect(
      setAdministratorCottageDescriptionVisibilityAction(
        { status: "idle" },
        validForm(),
      ),
    ).resolves.toEqual({ status: "saved", visibility });
    expect(description).toHaveBeenLastCalledWith(
      profileId,
      publicationId,
      true,
      " Safety review ",
    );
    const restore = validForm();
    restore.set("hidden", "false");
    await expect(
      setAdministratorCottagePhotoVisibilityAction({ status: "idle" }, restore),
    ).resolves.toEqual({ status: "saved", visibility });
    expect(photo).toHaveBeenLastCalledWith(
      profileId,
      publicationId,
      photoId,
      false,
      " Safety review ",
    );
    for (const locale of ["en", "ar", "ckb"]) {
      expect(revalidatePath).toHaveBeenCalledWith(
        `/${locale}/cottages/authoritative-slug`,
      );
      expect(revalidatePath).toHaveBeenCalledWith(`/${locale}/results`);
      expect(revalidatePath).toHaveBeenCalledWith(
        `/${locale}/administrator/cottages/${profileId}`,
      );
    }
    expect(revalidatePath).not.toHaveBeenCalledWith(
      expect.stringContaining("hostile-slug"),
    );
    revalidatePath.mockClear();
    for (const status of ["denied", "conflict", "last_photo", "unavailable"]) {
      photo.mockResolvedValueOnce({ status });
      await expect(
        setAdministratorCottagePhotoVisibilityAction(
          { status: "idle" },
          validForm(),
        ),
      ).resolves.toEqual({ status });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
    createRequestCottageProfile.mockRejectedValueOnce(
      new Error("request client unavailable"),
    );
    await expect(
      setAdministratorCottageDescriptionVisibilityAction(
        { status: "idle" },
        validForm(),
      ),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("administrator edits forward a validated reason", async () => {
    const saveAdministratorDraft = vi
      .fn()
      .mockResolvedValue({ status: "invalid", fields: ["reason"] });
    createRequestCottageProfile.mockResolvedValue({ saveAdministratorDraft });
    const form = new FormData();
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("expectedVersion", "2");
    form.set("reason", " Content correction ");
    await expect(
      saveAdministratorCottageProfileAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "invalid", fields: ["reason"] });
    expect(saveAdministratorDraft).toHaveBeenLastCalledWith(
      expect.any(String),
      2,
      expect.any(Object),
      " Content correction ",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("administrator photo mutations preserve owner calls and forward reasons", async () => {
    const deletePhoto = vi.fn().mockResolvedValue({ status: "deleted" });
    const uploadPhoto = vi.fn().mockResolvedValue({ status: "uploaded" });
    createRequestCottageProfile.mockResolvedValue({ deletePhoto, uploadPhoto });
    const form = new FormData();
    form.set("locale", "en");
    form.set("profileId", "70000000-0000-4000-8000-000000000001");
    form.set("photoId", "71000000-0000-4000-8000-000000000001");
    form.set(
      "photo",
      new File([new Uint8Array([1])], "cottage.webp", { type: "image/webp" }),
    );
    await deleteCottageProfilePhotoAction({ status: "idle" }, form);
    await uploadCottageProfilePhotoAction({ status: "idle" }, form);
    expect(deletePhoto).toHaveBeenLastCalledWith(form.get("photoId"));
    expect(uploadPhoto).toHaveBeenLastCalledWith(
      form.get("profileId"),
      expect.any(Object),
    );
    for (const reason of [
      " Correct photo ",
      "",
      new File(["reason"], "reason.txt"),
    ]) {
      form.set("reason", reason);
      await deleteCottageProfilePhotoAction({ status: "idle" }, form);
      await uploadCottageProfilePhotoAction({ status: "idle" }, form);
      expect(deletePhoto).toHaveBeenLastCalledWith(form.get("photoId"), reason);
      expect(uploadPhoto).toHaveBeenLastCalledWith(
        form.get("profileId"),
        expect.any(Object),
        reason,
      );
    }
  });

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

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRequestCottagePublication, revalidatePath } = vi.hoisted(() => ({
  createRequestCottagePublication: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("./request-cottage-publication", () => ({
  createRequestCottagePublication,
}));

import {
  correctCottageLocalizationAction,
  decideCottageLocalizationAction,
  decideCottagePublicationAction,
} from "./actions";

const cycleId = "20000000-0000-4000-8000-000000000024";

function baseForm() {
  const form = new FormData();
  form.set("locale", "en");
  form.set("targetLocale", "ar");
  form.set("reviewCycleId", cycleId);
  form.set("reason", "Reviewed carefully");
  return form;
}

describe("Cottage publication actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["approved", "yes"],
    ["approved", ""],
    ["reviewCycleId", "not-a-uuid"],
    ["targetLocale", "fr"],
    ["reason", "   "],
  ])(
    "rejects malformed locale decisions without mutation (%s)",
    async (key, value) => {
      const form = baseForm();
      form.set("approved", "true");
      form.set(key, value);

      await expect(decideCottageLocalizationAction(form)).rejects.toThrow(
        "Cottage publication action input is invalid",
      );
      expect(createRequestCottagePublication).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("surfaces a missing generated target without refreshing review state", async () => {
    const correct = vi
      .fn()
      .mockRejectedValue(
        new Error("A generated localized revision is required"),
      );
    createRequestCottagePublication.mockResolvedValue({ correct });
    const form = baseForm();
    form.set("description", "Human-authored Arabic");
    form.set("houseRules", "Human-authored rules");

    await expect(correctCottageLocalizationAction(form)).rejects.toThrow(
      "A generated localized revision is required",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves a literal false decision at the application boundary", async () => {
    const decideLocale = vi.fn().mockResolvedValue(undefined);
    createRequestCottagePublication.mockResolvedValue({ decideLocale });
    const form = baseForm();
    form.set("approved", "false");

    await expect(
      decideCottageLocalizationAction(form),
    ).resolves.toBeUndefined();
    expect(decideLocale).toHaveBeenCalledWith(
      cycleId,
      "ar",
      false,
      "Reviewed carefully",
    );
  });

  it.each([
    ["description", ""],
    ["houseRules", ""],
    ["reason", ""],
  ])(
    "rejects incomplete corrections without mutation (%s)",
    async (key, value) => {
      const form = baseForm();
      form.set("description", "Corrected description");
      form.set("houseRules", "Corrected rules");
      form.set(key, value);

      await expect(correctCottageLocalizationAction(form)).rejects.toThrow(
        "Cottage publication action input is invalid",
      );
      expect(createRequestCottagePublication).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed publication decisions without mutation", async () => {
    const form = baseForm();
    form.set("approved", "1");

    await expect(decideCottagePublicationAction(form)).rejects.toThrow(
      "Cottage publication action input is invalid",
    );
    expect(createRequestCottagePublication).not.toHaveBeenCalled();
  });
});

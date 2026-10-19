import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/cottage-profile/actions", () => ({
  setAdministratorCottageDescriptionVisibilityAction: vi.fn(),
  setAdministratorCottagePhotoVisibilityAction: vi.fn(),
  previewCottageProfilePhotoAction: vi.fn(),
}));

import {
  setAdministratorCottageDescriptionVisibilityAction,
  setAdministratorCottagePhotoVisibilityAction,
  previewCottageProfilePhotoAction,
  type CottageContentVisibilityActionState,
} from "@/cottage-profile/actions";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { CottageContentVisibility } from "./cottage-content-visibility";

const hostileFilename = '<img data-hostile="visibility-filename" src="x">.webp';

const visibility = {
  profileId: "70000000-0000-4000-8000-000000000001",
  publicationId: "72000000-0000-4000-8000-000000000001",
  publicSlug: "approved-cottage",
  descriptionHidden: false,
  photos: [
    {
      photoId: "71000000-0000-4000-8000-000000000001",
      originalFilename: hostileFilename,
      hidden: false,
    },
    {
      photoId: "71000000-0000-4000-8000-000000000002",
      originalFilename: "second.webp",
      hidden: true,
    },
  ],
};

it("published content controls report persisted hide and restore outcomes", async () => {
  for (const locale of ["en", "ar", "ckb"] as const) {
    const copy = cottageProfileMessages[locale];
    let settle: (state: CottageContentVisibilityActionState) => void = () => {};
    vi.mocked(
      setAdministratorCottageDescriptionVisibilityAction,
    ).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    vi.mocked(previewCottageProfilePhotoAction).mockResolvedValue({
      status: "ready",
      url: "https://private.example.test/retained-photo",
      expiresInSeconds: 300,
    });
    const { unmount } = render(
      <CottageContentVisibility
        locale={locale}
        result={{ status: "loaded", visibility }}
      />,
    );
    const panel = screen.getByRole("region", { name: copy.visibilityTitle });
    const hostilePhoto = within(panel).getByRole("group", {
      name: hostileFilename,
    });
    expect(
      within(hostilePhoto).getByRole("heading", {
        name: hostileFilename,
        exact: true,
      }),
    ).toBeVisible();
    expect(
      panel.querySelector('[data-hostile="visibility-filename"]'),
    ).toBeNull();
    const description = within(panel).getByRole("group", {
      name: copy.visibilityDescription,
    });
    const reason = within(description).getByLabelText(copy.lifecycleReason);
    expect(reason).toBeRequired();
    expect(reason).toHaveAttribute("maxLength", "1000");
    expect(within(panel).getAllByLabelText(copy.lifecycleReason)).toHaveLength(
      3,
    );
    fireEvent.change(reason, { target: { value: "Safety review" } });
    const hide = within(description).getByRole("button", {
      name: copy.visibilityHide,
    });
    hide.focus();
    fireEvent.click(hide);
    await waitFor(() => expect(hide).toBeDisabled());
    expect(within(description).getByText(copy.visibilityVisible)).toBeVisible();
    for (const button of within(panel).getAllByRole("button"))
      expect(button).toBeDisabled();
    await act(async () =>
      settle({
        status: "saved",
        visibility: { ...visibility, descriptionHidden: true },
      }),
    );
    expect(within(description).getByText(copy.visibilityHidden)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(copy.visibilitySaved);
    expect(
      within(description).getByRole("button", { name: copy.visibilityRestore }),
    ).toHaveFocus();
    const sent = vi
      .mocked(setAdministratorCottageDescriptionVisibilityAction)
      .mock.calls.at(-1)?.[1];
    expect(sent?.get("publicationId")).toBe(visibility.publicationId);
    expect(sent?.get("hidden")).toBe("true");
    expect(sent?.get("reason")).toBe("Safety review");
    vi.mocked(
      setAdministratorCottageDescriptionVisibilityAction,
    ).mockResolvedValueOnce({ status: "saved", visibility });
    fireEvent.change(reason, { target: { value: "Review complete" } });
    fireEvent.click(
      within(description).getByRole("button", { name: copy.visibilityRestore }),
    );
    await waitFor(() =>
      expect(
        within(description).getByText(copy.visibilityVisible),
      ).toBeVisible(),
    );
    const photo = within(panel).getByRole("group", { name: "second.webp" });
    fireEvent.click(within(photo).getByRole("button", { name: copy.preview }));
    await waitFor(() =>
      expect(
        within(photo).getByRole("link", { name: copy.preview }),
      ).toHaveAttribute("href", "https://private.example.test/retained-photo"),
    );
    vi.mocked(
      setAdministratorCottagePhotoVisibilityAction,
    ).mockResolvedValueOnce({
      status: "saved",
      visibility: {
        ...visibility,
        photos: visibility.photos.map((photo) => ({ ...photo, hidden: false })),
      },
    });
    fireEvent.change(within(photo).getByLabelText(copy.lifecycleReason), {
      target: { value: "Review complete" },
    });
    fireEvent.click(
      within(photo).getByRole("button", { name: copy.visibilityRestore }),
    );
    await waitFor(() =>
      expect(within(photo).getByText(copy.visibilityVisible)).toBeVisible(),
    );
    const photoSent = vi
      .mocked(setAdministratorCottagePhotoVisibilityAction)
      .mock.calls.at(-1)?.[1];
    expect(photoSent?.get("photoId")).toBe(visibility.photos[1].photoId);
    expect(photoSent?.get("hidden")).toBe("false");
    for (const [status, message] of [
      ["last_photo", copy.visibilityLastPhoto],
      ["conflict", copy.visibilityConflict],
      ["denied", copy.visibilityDenied],
      ["unavailable", copy.visibilityUnavailable],
      ["invalid", copy.reasonInvalid],
    ] as const) {
      vi.mocked(
        setAdministratorCottagePhotoVisibilityAction,
      ).mockResolvedValueOnce({
        status,
        fields: status === "invalid" ? ["reason"] : undefined,
      });
      fireEvent.change(within(photo).getByLabelText(copy.lifecycleReason), {
        target: { value: "Restore reviewed photo" },
      });
      fireEvent.click(
        within(photo).getByRole("button", { name: copy.visibilityHide }),
      );
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(message),
      );
      expect(within(photo).getByText(copy.visibilityVisible)).toBeVisible();
    }
    expect(within(photo).getByLabelText(copy.lifecycleReason)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(within(photo).getByLabelText(copy.lifecycleReason)).toHaveAttribute(
      "aria-describedby",
      "cottage-content-visibility-feedback",
    );
    expect(
      within(description).getByLabelText(copy.lifecycleReason),
    ).not.toHaveAttribute("aria-invalid");
    expect(
      within(description).getByLabelText(copy.lifecycleReason),
    ).not.toHaveAttribute("aria-describedby");

    unmount();
    const unavailable = render(
      <CottageContentVisibility
        locale={locale}
        result={{ status: "unavailable" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      copy.visibilityUnavailable,
    );
    expect(screen.queryByRole("button")).toBeNull();
    unavailable.unmount();
  }
});

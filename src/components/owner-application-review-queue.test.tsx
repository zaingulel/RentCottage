import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/owner-application/actions", () => ({
  createOwnerDocumentAccessAction: vi.fn(),
}));

import type { SubmittedOwnerApplicationReview } from "@/owner-application/supabase-owner-application";
import { createOwnerDocumentAccessAction } from "@/owner-application/actions";
import { OwnerApplicationReviewQueue } from "./owner-application-review-queue";

const applications: SubmittedOwnerApplicationReview[] = [
  {
    applicationId: "20000000-0000-4000-8000-000000000001",
    legalName: "Synthetic Owner",
    status: "submitted",
    version: 2,
    submittedAt: "2026-08-16T10:00:00.000Z",
    reviewDueAt: "2026-08-19T10:00:00.000Z",
    documents: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        kind: "identity",
        originalFilename:
          "syntheticlongprivateidentityevidencefilenamethatmustwrapwithouttruncation.pdf",
      },
      {
        id: "40000000-0000-4000-8000-000000000002",
        kind: "authority_to_rent",
        originalFilename: "synthetic-authority.pdf",
      },
    ],
  },
];

describe("Owner Application review queue", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("associates each private document with a shared compact action control", () => {
    render(
      <OwnerApplicationReviewQueue locale="en" applications={applications} />,
    );

    const [document, secondDocument] = screen.getAllByRole("listitem");
    expect(within(document).getByText("Identity evidence")).toBeVisible();
    expect(
      within(document).getByText(
        "syntheticlongprivateidentityevidencefilenamethatmustwrapwithouttruncation.pdf",
      ),
    ).toHaveClass("administrator-review-filename");
    expect(
      within(document).getByRole("button", { name: "Create secure link" }),
    ).toHaveClass("action", "action-secondary", "action-compact");
    expect(
      within(document).getByDisplayValue(
        "40000000-0000-4000-8000-000000000001",
      ),
    ).toHaveAttribute("name", "documentId");
    expect(within(document).queryByRole("status")).toBeNull();
    expect(
      within(document).queryByRole("link", { name: "Open secure document" }),
    ).toBeNull();
    expect(
      within(secondDocument).getByRole("button", {
        name: "Create secure link",
      }),
    ).toBeVisible();
  });

  it("keeps secure-link state associated with the document row that started it", async () => {
    vi.mocked(createOwnerDocumentAccessAction).mockResolvedValue({
      status: "ready",
      url: "https://storage.test/second-document",
      expiresInSeconds: 60,
    });
    render(
      <OwnerApplicationReviewQueue locale="en" applications={applications} />,
    );

    const [firstDocument, secondDocument] = screen.getAllByRole("listitem");
    fireEvent.submit(
      within(secondDocument)
        .getByRole("button", { name: "Create secure link" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(
        within(secondDocument).getByRole("link", {
          name: "Open secure document",
        }),
      ).toHaveAttribute("href", "https://storage.test/second-document"),
    );
    expect(within(firstDocument).queryByRole("status")).toBeNull();
    expect(within(firstDocument).queryByRole("alert")).toBeNull();
    expect(
      within(firstDocument).queryByRole("link", {
        name: "Open secure document",
      }),
    ).toBeNull();
  });

  it("masks an old secure link while a retry is pending and shows only the new URL", async () => {
    let resolveFirst!: (state: {
      status: "ready";
      url: string;
      expiresInSeconds: number;
    }) => void;
    let resolveSecond!: (state: {
      status: "ready";
      url: string;
      expiresInSeconds: number;
    }) => void;
    vi.mocked(createOwnerDocumentAccessAction)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    render(
      <OwnerApplicationReviewQueue locale="en" applications={applications} />,
    );

    const [document] = screen.getAllByRole("listitem");
    const form = within(document)
      .getByRole("button", { name: "Create secure link" })
      .closest("form")!;
    fireEvent.submit(form);

    await waitFor(() =>
      expect(
        within(document).getByRole("button", { name: "Create secure link" }),
      ).toHaveAttribute("aria-busy", "true"),
    );
    expect(within(document).getByRole("status")).toHaveTextContent(
      "Creating secure link.",
    );
    expect(within(document).getByRole("status")).toHaveClass(
      "administrator-review-pending",
    );
    expect(within(document).getByRole("status")).not.toHaveClass(
      "action-feedback-success",
    );
    fireEvent.click(
      within(document).getByRole("button", { name: "Create secure link" }),
    );
    expect(createOwnerDocumentAccessAction).toHaveBeenCalledTimes(1);

    resolveFirst({
      status: "ready",
      url: "https://storage.test/first",
      expiresInSeconds: 60,
    });
    await waitFor(() =>
      expect(
        within(document).getByRole("link", { name: "Open secure document" }),
      ).toHaveAttribute("href", "https://storage.test/first"),
    );
    expect(within(document).getByRole("status")).toHaveClass(
      "action-feedback",
      "action-feedback-success",
    );

    fireEvent.submit(form);
    expect(createOwnerDocumentAccessAction).toHaveBeenLastCalledWith(
      { status: "idle" },
      expect.any(FormData),
    );
    await waitFor(() =>
      expect(
        within(document).queryByRole("link", { name: "Open secure document" }),
      ).toBeNull(),
    );
    expect(within(document).getByRole("status")).toHaveTextContent(
      "Creating secure link.",
    );
    resolveSecond({
      status: "ready",
      url: "https://storage.test/second",
      expiresInSeconds: 60,
    });
    await waitFor(() =>
      expect(
        within(document).getByRole("link", { name: "Open secure document" }),
      ).toHaveAttribute("href", "https://storage.test/second"),
    );
    expect(
      within(document).queryByText("https://storage.test/first"),
    ).toBeNull();
  });

  it("withholds a delayed response that reaches the client after its deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    let resolveAccess!: (state: {
      status: "ready";
      url: string;
      expiresInSeconds: number;
    }) => void;
    vi.mocked(createOwnerDocumentAccessAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAccess = resolve;
        }),
    );
    render(
      <OwnerApplicationReviewQueue locale="en" applications={applications} />,
    );

    fireEvent.submit(
      within(screen.getAllByRole("listitem")[0])
        .getByRole("button", { name: "Create secure link" })
        .closest("form")!,
    );
    expect(createOwnerDocumentAccessAction).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(61_000));
    resolveAccess({
      status: "ready",
      url: "https://storage.test/late",
      expiresInSeconds: 60,
    });

    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This secure link has expired.",
    );
    expect(
      screen.queryByRole("link", { name: "Open secure document" }),
    ).toBeNull();
  });

  it("expires a ready link at its deadline and starts a fresh retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    vi.mocked(createOwnerDocumentAccessAction)
      .mockResolvedValueOnce({
        status: "ready",
        url: "https://storage.test/first-expiring",
        expiresInSeconds: 1,
      })
      .mockResolvedValueOnce({
        status: "ready",
        url: "https://storage.test/retried",
        expiresInSeconds: 60,
      });
    render(
      <OwnerApplicationReviewQueue locale="en" applications={applications} />,
    );

    const form = within(screen.getAllByRole("listitem")[0])
      .getByRole("button", { name: "Create secure link" })
      .closest("form")!;
    fireEvent.submit(form);
    await act(async () => {});
    expect(
      screen.getByRole("link", { name: "Open secure document" }),
    ).toHaveAttribute("href", "https://storage.test/first-expiring");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This secure link has expired.",
    );

    fireEvent.submit(form);
    await act(async () => {});
    expect(
      screen.getByRole("link", { name: "Open secure document" }),
    ).toHaveAttribute("href", "https://storage.test/retried");
  });

  it("starts a fresh deadline when an expired document access is retried", async () => {
    let now = 1_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.mocked(createOwnerDocumentAccessAction)
      .mockResolvedValueOnce({ status: "expired" })
      .mockResolvedValueOnce({
        status: "ready",
        url: "https://storage.test/retried",
        expiresInSeconds: 60,
      });
    render(
      <OwnerApplicationReviewQueue locale="en" applications={applications} />,
    );

    const form = within(screen.getAllByRole("listitem")[0])
      .getByRole("button", { name: "Create secure link" })
      .closest("form")!;
    fireEvent.submit(form);
    expect(createOwnerDocumentAccessAction).toHaveBeenLastCalledWith(
      { status: "idle" },
      expect.any(FormData),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This secure link has expired.",
      ),
    );

    now = 70_000;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Open secure document" }),
      ).toHaveAttribute("href", "https://storage.test/retried"),
    );
    clock.mockRestore();
  });

  it("withholds a stale ready link when a retry request fails", async () => {
    vi.mocked(createOwnerDocumentAccessAction)
      .mockResolvedValueOnce({
        status: "ready",
        url: "https://storage.test/first",
        expiresInSeconds: 60,
      })
      .mockRejectedValueOnce(new Error("temporary failure"));
    render(
      <OwnerApplicationReviewQueue locale="en" applications={applications} />,
    );

    const [document] = screen.getAllByRole("listitem");
    const form = within(document)
      .getByRole("button", { name: "Create secure link" })
      .closest("form")!;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(
        within(document).getByRole("link", { name: "Open secure document" }),
      ).toHaveAttribute("href", "https://storage.test/first"),
    );

    fireEvent.submit(form);
    await waitFor(() =>
      expect(within(document).getByRole("alert")).toHaveTextContent(
        "The private review queue is temporarily unavailable.",
      ),
    );
    expect(
      within(document).queryByRole("link", { name: "Open secure document" }),
    ).toBeNull();
  });

  it.each([
    ["denied", "You do not have permission to access this private document."],
    ["unavailable", "The private review queue is temporarily unavailable."],
    ["expired", "This secure link has expired."],
  ] as const)("withholds a URL for %s access", async (status, message) => {
    vi.mocked(createOwnerDocumentAccessAction).mockResolvedValue({ status });
    render(
      <OwnerApplicationReviewQueue locale="en" applications={applications} />,
    );

    fireEvent.submit(
      within(screen.getAllByRole("listitem")[0])
        .getByRole("button", { name: "Create secure link" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(message),
    );
    expect(
      screen.queryByRole("link", { name: "Open secure document" }),
    ).toBeNull();
  });
});

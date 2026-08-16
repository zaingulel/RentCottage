import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/owner-application/actions", () => ({
  saveOwnerApplicationAction: vi.fn(),
  uploadOwnerDocumentAction: vi.fn(),
  submitOwnerApplicationAction: vi.fn(),
}));

import type { OwnerApplicationSnapshot } from "@/owner-application/owner-application";
import {
  saveOwnerApplicationAction,
  submitOwnerApplicationAction,
  uploadOwnerDocumentAction,
} from "@/owner-application/actions";
import { OwnerApplicationForm } from "./owner-application-form";

const draft: OwnerApplicationSnapshot = {
  applicationId: "20000000-0000-4000-8000-000000000001",
  ownerUserId: "10000000-0000-4000-8000-000000000001",
  status: "draft",
  applicantKind: "individual",
  legalName: "Zana Kareem",
  companyName: "",
  licensingBasis: "licence",
  exemptionBasis: "",
  cottage: {
    name: "Garden House",
    governorate: "Erbil",
    approximateLocation: "Shaqlawa countryside",
    exactAddress: "Eastern orchard road",
    capacity: 8,
    bedrooms: 3,
    bathrooms: 2,
    amenities: ["garden", "parking"],
    description: "A quiet family cottage.",
    houseRules: "Families only.",
  },
  documents: [
    {
      id: "40000000-0000-4000-8000-000000000001",
      kind: "identity",
      originalFilename: "passport.pdf",
      mediaType: "application/pdf",
      sizeBytes: 128,
      updatedAt: "2026-08-14T10:00:00.000Z",
    },
  ],
  submittedAt: null,
  version: 1,
  reviewDueAt: null,
};

describe("Owner Application form", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    [
      "en",
      "submitted",
      "Your application is locked while it awaits initial review.",
    ],
    [
      "en",
      "needs_information",
      "Your review clock is paused. Provide only the requested information in Owner Backoffice.",
    ],
    [
      "en",
      "under_review",
      "Your response was received and review is underway. Your application remains locked.",
    ],
    [
      "en",
      "approved",
      "Your owner identity is approved. This does not publish a cottage or enable bookings yet.",
    ],
    [
      "en",
      "rejected",
      "Your application was rejected and remains read-only. Review the notice for the decision reason.",
    ],
    [
      "en",
      "expired",
      "Your approval expired. Existing servicing remains available, but new business is blocked until renewal is approved.",
    ],
    [
      "en",
      "suspended",
      "Your owner account is suspended for new business. Your application remains read-only.",
    ],
    ["ar", "submitted", "طلبك مقفل أثناء انتظار المراجعة الأولية."],
    [
      "ar",
      "needs_information",
      "توقفت مهلة المراجعة مؤقتاً. قدّم فقط المعلومات المطلوبة في لوحة المالك.",
    ],
    ["ar", "under_review", "تم استلام ردك والمراجعة جارية. يبقى طلبك مقفلاً."],
    [
      "ar",
      "approved",
      "تمت الموافقة على هوية المالك. هذا لا ينشر كوخاً ولا يفعّل الحجوزات بعد.",
    ],
    [
      "ar",
      "rejected",
      "رُفض طلبك ويبقى للقراءة فقط. راجع الإشعار لمعرفة سبب القرار.",
    ],
    [
      "ar",
      "expired",
      "انتهت موافقتك. تستمر خدمة الأعمال القائمة، لكن الأعمال الجديدة محظورة حتى قبول التجديد.",
    ],
    [
      "ar",
      "suspended",
      "حساب المالك معلّق للأعمال الجديدة. يبقى طلبك للقراءة فقط.",
    ],
    [
      "ckb",
      "submitted",
      "داواکارییەکەت قفڵە تا پێداچوونەوەی سەرەتایی دەست پێ بکات.",
    ],
    [
      "ckb",
      "needs_information",
      "کاتی پێداچوونەوە ڕاگیراوە. تەنها زانیارییە داواکراوەکان لە بەشی خاوەن بنێرە.",
    ],
    [
      "ckb",
      "under_review",
      "وەڵامەکەت وەرگیرا و پێداچوونەوە بەردەوامە. داواکارییەکەت هەر قفڵە.",
    ],
    [
      "ckb",
      "approved",
      "ناسنامەی خاوەن پەسەندکرا. ئەمە هێشتا کۆخ بڵاوناکاتەوە یان حجز چالاک ناکات.",
    ],
    [
      "ckb",
      "rejected",
      "داواکارییەکەت ڕەتکرایەوە و تەنها بۆ خوێندنەوەیە. هۆکاری بڕیارەکە لە ئاگادارکردنەوەکە ببینە.",
    ],
    [
      "ckb",
      "expired",
      "پەسەندکردنەکەت بەسەرچوو. خزمەتگوزارییە هەبووەکان بەردەوامن، بەڵام کاری نوێ تا پەسەندکردنی نوێکردنەوە ڕاگیراوە.",
    ],
    [
      "ckb",
      "suspended",
      "هەژماری خاوەن بۆ کاری نوێ ڕاگیراوە. داواکارییەکەت تەنها بۆ خوێندنەوەیە.",
    ],
  ] as const)(
    "shows accurate %s guidance for %s",
    (locale, status, guidance) => {
      const { unmount } = render(
        <OwnerApplicationForm
          locale={locale}
          application={{ ...draft, status }}
        />,
      );
      expect(screen.getByText(guidance)).toBeVisible();
      unmount();
    },
  );

  it("shows every application section and allows a partial draft", () => {
    render(<OwnerApplicationForm locale="en" application={null} />);

    expect(screen.getByRole("heading", { name: "Your details" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Your first private cottage" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Private verification documents" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Prepare your Owner Application",
      }),
    ).toBeVisible();
    expect(screen.getByText(/Save the draft before uploading/)).toBeVisible();
  });

  it("requires distinct company and authorised-representative evidence", () => {
    render(
      <OwnerApplicationForm
        locale="en"
        application={{ ...draft, applicantKind: "company" }}
      />,
    );

    expect(
      screen.getByRole("article", { name: "Company evidence" }),
    ).toBeVisible();
    expect(
      screen.getByRole("article", {
        name: "Authorised-representative evidence",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Identity evidence" }),
    ).toBeNull();
  });

  it("updates required evidence from the current applicant choices", () => {
    render(<OwnerApplicationForm locale="en" application={draft} />);

    fireEvent.change(screen.getByLabelText("Applicant type"), {
      target: { value: "company" },
    });
    fireEvent.change(screen.getByLabelText("Local compliance basis"), {
      target: { value: "exemption" },
    });

    expect(
      screen.getByRole("article", { name: "Company evidence" }),
    ).toBeVisible();
    expect(
      screen.getByRole("article", {
        name: "Authorised-representative evidence",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Identity evidence" }),
    ).toBeNull();
    expect(
      screen.queryByRole("article", { name: "Licence or exemption evidence" }),
    ).toBeNull();
  });

  it("preserves every submitted value after an invalid save", async () => {
    vi.mocked(saveOwnerApplicationAction).mockImplementation(
      async (_previous, formData) => ({
        status: "invalid",
        fields: ["capacity"],
        values: {
          applicantKind: String(formData.get("applicantKind")),
          legalName: String(formData.get("legalName")),
          companyName: String(formData.get("companyName")),
          licensingBasis: String(formData.get("licensingBasis")),
          exemptionBasis: String(formData.get("exemptionBasis")),
          cottageName: String(formData.get("cottageName")),
          governorate: String(formData.get("governorate")),
          approximateLocation: String(formData.get("approximateLocation")),
          exactAddress: String(formData.get("exactAddress")),
          capacity: String(formData.get("capacity")),
          bedrooms: String(formData.get("bedrooms")),
          bathrooms: String(formData.get("bathrooms")),
          amenities: formData.getAll("amenities").map(String),
          description: String(formData.get("description")),
          houseRules: String(formData.get("houseRules")),
        },
      }),
    );
    render(<OwnerApplicationForm locale="en" application={draft} />);
    fireEvent.change(screen.getByLabelText("Legal name"), {
      target: { value: "Updated Legal Name" },
    });
    fireEvent.change(screen.getByLabelText("Guest capacity"), {
      target: { value: "101" },
    });

    fireEvent.submit(
      screen.getByRole("button", { name: "Save draft" }).closest("form")!,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Check the marked fields and try again."),
      ).toBeVisible(),
    );
    expect(screen.getByLabelText("Legal name")).toHaveValue(
      "Updated Legal Name",
    );
    expect(screen.getByLabelText("Guest capacity")).toHaveValue(101);
    expect(screen.getByLabelText(/Guest capacity/)).toHaveAttribute(
      "aria-describedby",
      "owner-application-capacity-error",
    );
    expect(
      document.getElementById("owner-application-capacity-error"),
    ).toHaveTextContent("Check this field.");
    expect(screen.getByLabelText("Garden")).toBeChecked();
    expect(screen.getByLabelText("Parking")).toBeChecked();
  });

  it("shows saved document metadata without exposing a download action", () => {
    render(<OwnerApplicationForm locale="en" application={draft} />);

    expect(screen.getByText("passport.pdf")).toBeVisible();
    expect(screen.queryByRole("link", { name: /secure link/i })).toBeNull();
    expect(screen.getByLabelText("Legal name")).toHaveValue("Zana Kareem");
  });

  it("keeps private document uploads as native file controls", () => {
    render(<OwnerApplicationForm locale="en" application={draft} />);

    const fileControls = [
      "Identity evidence: PDF, JPEG, or PNG · maximum 5 MB",
      "Authority-to-rent evidence: PDF, JPEG, or PNG · maximum 5 MB",
      "Licence or exemption evidence: PDF, JPEG, or PNG · maximum 5 MB",
      "Payout-account evidence: PDF, JPEG, or PNG · maximum 5 MB",
    ].map((name) => screen.getByLabelText(name));
    expect(fileControls.length).toBeGreaterThan(0);
    for (const control of fileControls) {
      expect(control).toHaveAttribute("type", "file");
      expect(control).toHaveAttribute("name", "document");
      expect(control).toHaveAttribute(
        "accept",
        "application/pdf,image/jpeg,image/png",
      );
    }
  });

  it("keeps mutable Owner Application controls native, pending, and announced", async () => {
    let resolveSave: (state: { status: "saved" }) => void;
    vi.mocked(saveOwnerApplicationAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<OwnerApplicationForm locale="en" application={draft} />);

    expect(screen.getByLabelText("Legal name")).toHaveProperty(
      "tagName",
      "INPUT",
    );
    expect(screen.getByLabelText("Applicant type")).toHaveProperty(
      "tagName",
      "SELECT",
    );
    expect(screen.getByLabelText("Cottage description")).toHaveProperty(
      "tagName",
      "TEXTAREA",
    );
    expect(screen.getByRole("button", { name: "Save draft" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(
      screen.getByRole("button", { name: "Replace document" }),
    ).toHaveAttribute("type", "submit");
    expect(
      screen.getByRole("button", { name: "Submit application" }),
    ).toHaveAttribute("type", "submit");

    fireEvent.submit(
      screen.getByRole("button", { name: "Save draft" }).closest("form")!,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save draft" }),
      ).toHaveAttribute("aria-busy", "true"),
    );
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    resolveSave!({ status: "saved" });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Draft saved."),
    );
  });

  it("announces a successful draft save", async () => {
    vi.mocked(saveOwnerApplicationAction).mockResolvedValue({
      status: "saved",
    });
    render(<OwnerApplicationForm locale="en" application={draft} />);

    fireEvent.submit(
      screen.getByRole("button", { name: "Save draft" }).closest("form")!,
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Draft saved."),
    );
  });

  it("announces a successful private document upload", async () => {
    vi.mocked(uploadOwnerDocumentAction).mockResolvedValue({
      status: "uploaded",
    });
    render(<OwnerApplicationForm locale="en" application={draft} />);

    const identityEvidence = screen.getByRole("article", {
      name: "Identity evidence",
    });
    fireEvent.submit(
      within(identityEvidence)
        .getByRole("button", { name: "Replace document" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(within(identityEvidence).getByRole("status")).toHaveTextContent(
        "Private document saved.",
      ),
    );
  });

  it("announces a successful application submission", async () => {
    vi.mocked(submitOwnerApplicationAction).mockResolvedValue({
      status: "submitted",
    });
    render(<OwnerApplicationForm locale="en" application={draft} />);

    fireEvent.submit(
      screen
        .getByRole("button", { name: "Submit application" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Application submitted.",
      ),
    );
  });

  it("keeps the final submission pending and suppresses repeat activation", async () => {
    let resolveSubmit: (state: { status: "submitted" }) => void;
    vi.mocked(submitOwnerApplicationAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    render(<OwnerApplicationForm locale="en" application={draft} />);

    const submit = screen.getByRole("button", {
      name: "Submit application",
    });
    const form = submit.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => expect(submit).toHaveAttribute("aria-busy", "true"));
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleName("Submit application");
    fireEvent.click(submit);
    expect(submitOwnerApplicationAction).toHaveBeenCalledTimes(1);

    resolveSubmit!({ status: "submitted" });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Application submitted.",
      ),
    );
  });

  it("explains that a draft is required when an upload loses its application", async () => {
    vi.mocked(uploadOwnerDocumentAction).mockResolvedValue({
      status: "application_required",
    });
    render(<OwnerApplicationForm locale="en" application={draft} />);

    const identityEvidence = screen.getByRole("article", {
      name: "Identity evidence",
    });
    fireEvent.submit(
      within(identityEvidence)
        .getByRole("button", { name: "Replace document" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(
        within(identityEvidence).getByText(
          "Save the draft before uploading documents.",
        ),
      ).toBeVisible(),
    );
  });

  it("locks the application after submission", () => {
    render(
      <OwnerApplicationForm
        locale="en"
        application={{
          ...draft,
          status: "submitted",
          submittedAt: "2026-08-14T10:30:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("Submitted for review")).toBeVisible();
    expect(screen.getByLabelText("Legal name")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Submit application" }),
    ).toBeNull();
  });

  it("keeps the locked application rail consistent with later review states", () => {
    render(
      <OwnerApplicationForm
        locale="en"
        application={{
          ...draft,
          status: "needs_information",
          submittedAt: "2026-08-14T10:30:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("Needs information")).toBeVisible();
    expect(screen.queryByText("Submitted for review")).toBeNull();
    expect(screen.getByLabelText("Legal name")).toBeDisabled();
  });

  it("names every missing item when submission is incomplete", async () => {
    vi.mocked(submitOwnerApplicationAction).mockResolvedValue({
      status: "incomplete",
      missingItems: ["legal_name", "document:payout_account"],
    });
    render(<OwnerApplicationForm locale="en" application={draft} />);

    fireEvent.submit(
      screen
        .getByRole("button", { name: "Submit application" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Complete these items before submitting:"),
      ).toBeVisible(),
    );
    const guidance = screen.getByRole("alert");
    expect(within(guidance).getByText("Legal name")).toBeVisible();
    expect(within(guidance).getByText("Payout-account evidence")).toBeVisible();
  });
});

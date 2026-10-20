import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/owner-application/review-actions", () => ({
  reviewOwnerApplicationAction: vi.fn(),
}));
vi.mock("@/owner-application/actions", () => ({
  createOwnerDocumentAccessAction: vi.fn(),
}));

import type { OwnerApplicationReviewDetail } from "@/owner-application/supabase-owner-application-review";
import { OwnerApplicationReviewDetailView } from "./owner-application-review-detail";

const detail: OwnerApplicationReviewDetail = {
  applicationId: "20000000-0000-4000-8000-000000000001",
  version: 2,
  status: "submitted",
  submittedAt: "2026-08-16T10:00:00.000Z",
  reviewDueAt: "2026-08-19T10:00:00.000Z",
  applicantKind: "individual",
  legalName: "Synthetic Owner",
  companyName: "",
  licensingBasis: "licence",
  exemptionBasis: "",
  cottage: {
    name: "Garden House",
    governorate: "Erbil",
    approximateLocation: "Shaqlawa",
    exactAddress: "Private road",
    capacity: 8,
    bedrooms: 3,
    bathrooms: 2,
    amenities: ["garden"],
    description: "Description",
    houseRules: "Rules",
  },
  documents: [
    {
      id: "40000000-0000-4000-8000-000000000001",
      kind: "identity",
      originalFilename: "identity.pdf",
      mediaType: "application/pdf",
      sizeBytes: 128,
      updatedAt: "2026-08-16T09:00:00.000Z",
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      kind: "licensing_or_exemption",
      originalFilename: "licence.pdf",
      mediaType: "application/pdf",
      sizeBytes: 128,
      updatedAt: "2026-08-16T09:00:00.000Z",
    },
  ],
  activeInformationRequest: null,
  transitions: [],
};

describe("Owner Application review detail", () => {
  it("shows Sorani dates without Sorani locale data", () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    const dateTimeFormat = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function (locales, options) {
        const first = Array.isArray(locales) ? locales[0] : locales;
        return new RealDateTimeFormat(
          typeof first === "string" && first.startsWith("ckb")
            ? "en-US"
            : locales,
          options,
        );
      });
    const instants = [
      "2026-10-17T12:34:56Z",
      "2026-10-18T12:34:56Z",
      "2026-10-19T12:34:56Z",
    ];
    try {
      for (const [locale, expected] of [
        [
          "ckb",
          [
            "٢٠٢٦ تشرینی یەکەم ١٧ ٣:٣٤ د.ن",
            "٢٠٢٦ تشرینی یەکەم ١٨ ٣:٣٤ د.ن",
            "٢٠٢٦ تشرینی یەکەم ١٩ ٣:٣٤ د.ن",
          ],
        ],
        [
          "en",
          [
            "Oct 17, 2026, 3:34 PM",
            "Oct 18, 2026, 3:34 PM",
            "Oct 19, 2026, 3:34 PM",
          ],
        ],
        [
          "ar",
          [
            "17\u200f/10\u200f/2026، 3:34 م",
            "18\u200f/10\u200f/2026، 3:34 م",
            "19\u200f/10\u200f/2026، 3:34 م",
          ],
        ],
      ] as const) {
        const { container, unmount } = render(
          <OwnerApplicationReviewDetailView
            locale={locale}
            detail={{
              ...detail,
              submittedAt: instants[0],
              reviewDueAt: instants[1],
              transitions: [
                {
                  fromStatus: "submitted",
                  toStatus: "under_review",
                  occurredAt: instants[2],
                  reason: "Synthetic review",
                },
              ],
            }}
          />,
        );
        const times = container.querySelectorAll("time");
        expect(times).toHaveLength(instants.length);
        for (const [index, time] of times.entries()) {
          expect(time).toBeVisible();
          expect(time.textContent).toBe(expected[index]);
          expect(time).toHaveAttribute("datetime", instants[index]);
        }
        unmount();
      }
    } finally {
      dateTimeFormat.mockRestore();
    }
  });

  it("visibly labels review decision fields and preserves submitted form values", async () => {
    const user = userEvent.setup();
    render(<OwnerApplicationReviewDetailView locale="en" detail={detail} />);

    const reasons = screen.getAllByRole("textbox", {
      name: "Reason",
    });
    expect(reasons).toHaveLength(3);
    for (const [name, controls] of [
      ["Reason", reasons],
      ["Jurisdiction", [screen.getByRole("textbox", { name: "Jurisdiction" })]],
      [
        "Licensing basis",
        [screen.getByRole("combobox", { name: "Licensing basis" })],
      ],
      [
        "Licence or exemption basis",
        [screen.getByRole("textbox", { name: "Licence or exemption basis" })],
      ],
    ] as const) {
      for (const control of controls) {
        const labels = (
          control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        ).labels;
        expect(labels).toHaveLength(1);
        expect(labels![0]).toBeVisible();
        expect(labels![0]).toHaveTextContent(name);
      }
    }

    const fields = screen.getByRole("group", {
      name: "Required application fields",
    });
    const documents = screen.getByRole("group", { name: "Required evidence" });
    expect(fields.tagName).toBe("FIELDSET");
    expect(documents.tagName).toBe("FIELDSET");
    await user.click(
      within(fields).getByRole("checkbox", { name: "Legal name" }),
    );
    await user.click(
      within(documents).getByRole("checkbox", {
        name: "Identity evidence",
      }),
    );
    await user.type(reasons[0], "Please update the identity evidence.");
    const requestForm = screen
      .getByRole("button", { name: "Request missing information" })
      .closest("form")!;
    const request = new FormData(requestForm);
    expect(Object.fromEntries(request)).toEqual({
      locale: "en",
      action: "request_information",
      applicationId: "20000000-0000-4000-8000-000000000001",
      expectedVersion: "2",
      reason: "Please update the identity evidence.",
      requestedFields: "legal_name",
      requestedDocumentKinds: "identity",
    });
    expect(request.getAll("requestedFields")).toEqual(["legal_name"]);
    expect(request.getAll("requestedDocumentKinds")).toEqual(["identity"]);

    await user.type(reasons[1], "Evidence checked.");
    await user.type(
      screen.getByRole("textbox", { name: "Jurisdiction" }),
      "Erbil",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Licensing basis" }),
      "exemption",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Licence or exemption basis" }),
      "Recorded exemption evidence.",
    );
    await user.type(
      screen.getByLabelText("Expiry date: Licence or exemption evidence"),
      "2027-08-16",
    );
    const approvalForm = screen
      .getByRole("button", { name: "Approve Owner Application" })
      .closest("form")!;
    expect(Object.fromEntries(new FormData(approvalForm))).toEqual({
      locale: "en",
      action: "approve",
      applicationId: "20000000-0000-4000-8000-000000000001",
      expectedVersion: "2",
      reason: "Evidence checked.",
      jurisdiction: "Erbil",
      licensingBasis: "exemption",
      licenceOrExemptionBasis: "Recorded exemption evidence.",
      "expiryDate:identity": "",
      "expiryDate:licensing_or_exemption": "2027-08-16",
    });
  });

  it("shows the private profile, evidence and every legal submitted action", () => {
    render(<OwnerApplicationReviewDetailView locale="en" detail={detail} />);

    expect(screen.getByText("Private road")).toBeVisible();
    expect(screen.getByText("identity.pdf")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start review" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Request missing information" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Approve Owner Application" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reject Owner Application" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Suspend Owner Application" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Expiry date: Licence or exemption evidence"),
    ).not.toBeRequired();
  });

  it.each([
    ["en", "Individual"],
    ["ar", "فرد"],
    ["ckb", "تاک"],
  ] as const)("localizes the applicant kind in %s", (locale, label) => {
    render(
      <OwnerApplicationReviewDetailView locale={locale} detail={detail} />,
    );

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText("individual")).not.toBeInTheDocument();
  });

  it("uses localized placeholders instead of empty numeric details", () => {
    render(
      <OwnerApplicationReviewDetailView
        locale="en"
        detail={{
          ...detail,
          cottage: {
            ...detail.cottage,
            capacity: null,
            bedrooms: null,
            bathrooms: null,
          },
        }}
      />,
    );

    expect(screen.getAllByText("Not provided")).toHaveLength(3);
  });

  it("shows the placeholder for an application without an exact address", () => {
    render(
      <OwnerApplicationReviewDetailView
        locale="en"
        detail={{
          ...detail,
          cottage: { ...detail.cottage, exactAddress: "" },
        }}
      />,
    );

    expect(screen.queryByText("Private road")).not.toBeInTheDocument();
    expect(screen.getByText("Not provided")).toBeVisible();
  });

  it("keeps lifecycle transition order explicit in a right-to-left locale", () => {
    const { container } = render(
      <OwnerApplicationReviewDetailView
        locale="ar"
        detail={{
          ...detail,
          status: "under_review",
          transitions: [
            {
              fromStatus: "submitted",
              toStatus: "under_review",
              occurredAt: "2026-08-16T11:00:00.000Z",
              reason: "بدأت المراجعة",
            },
          ],
        }}
      />,
    );

    const transition = container.querySelector(".review-transition");
    expect(transition).toHaveAttribute("dir", "ltr");
    expect(transition?.textContent).toBe("أُرسل للمراجعة → قيد المراجعة");
  });

  it("shows only decision actions while under review", () => {
    render(
      <OwnerApplicationReviewDetailView
        locale="en"
        detail={{ ...detail, status: "under_review" }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Start review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request missing information" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Approve Owner Application" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reject Owner Application" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Suspend Owner Application" }),
    ).not.toBeInTheDocument();
  });

  it("shows only suspension for an approved application", () => {
    render(
      <OwnerApplicationReviewDetailView
        locale="en"
        detail={{ ...detail, status: "approved" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Suspend Owner Application" }),
    ).toBeVisible();
    for (const name of [
      "Start review",
      "Request missing information",
      "Approve Owner Application",
      "Reject Owner Application",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
  it.each([
    [
      "en",
      "Suspend Owner Application",
      "Waiting requests enter payment release processing. Unresolved releases remain visible in administrator payments; suspension does not confirm that money was released.",
      "Manage restrictions in administrator records",
    ],
    [
      "ar",
      "علّق طلب المالك",
      "تدخل الطلبات المنتظرة في معالجة تحرير الدفعات. تبقى عمليات التحرير غير المحسومة ظاهرة في دفعات الإدارة؛ التعليق لا يؤكد تحرير الأموال.",
      "أدر القيود في سجلات الإدارة",
    ],
    [
      "ckb",
      "داواکاری خاوەن ڕابگرە",
      "داواکارییە چاوەڕوانەکان دەچنە پرۆسەی ئازادکردنی پارەدان. ئازادکردنە چارەسەرنەکراوەکان لە پارەدانی بەڕێوەبەر دەردەکەون؛ ڕاگرتن پشتڕاستکردنەوەی ئازادکردنی پارە نییە.",
      "سنووردارکردنەکان لە تۆمارەکانی بەڕێوەبەر بەڕێوە ببە",
    ],
  ] as const)(
    "explains legacy suspension release processing and retains record navigation in %s",
    (locale, suspendLabel, explanation, recordsLabel) => {
      render(
        <OwnerApplicationReviewDetailView
          locale={locale}
          detail={{ ...detail, status: "approved" }}
        />,
      );
      const submit = screen.getByRole("button", { name: suspendLabel });
      expect(submit).toBeVisible();
      const form = submit.closest("form")!;
      expect(within(form).getByText(explanation)).toBeVisible();
      expect(
        within(form).getByRole("link", { name: recordsLabel }),
      ).toHaveAttribute("href", `/${locale}/administrator/records`);
      expect(new FormData(form).get("action")).toBe("suspend");
    },
  );
});

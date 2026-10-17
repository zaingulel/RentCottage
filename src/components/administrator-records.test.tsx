import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  AdministratorRecordDetailView,
  AdministratorRecords,
} from "./administrator-records";

// Next.js supplies this server-action boundary in the browser.
vi.mock("@/administrator-records/actions", () => ({
  searchAdministratorRecordsAction: vi.fn(),
}));

function withoutSoraniNumberData() {
  const RealNumberFormat = Intl.NumberFormat;
  vi.spyOn(Intl, "NumberFormat").mockImplementation(
    function (locales, options) {
      const first = Array.isArray(locales) ? locales[0] : locales;
      return new RealNumberFormat(
        typeof first === "string" && first.startsWith("ckb")
          ? "en-US"
          : locales,
        options,
      );
    },
  );
}

afterEach(() => vi.restoreAllMocks());

const id = "11111111-1111-4111-8111-111111111111";
const createdAt = "2026-10-17T12:34:56Z";

it("localizes Sorani search counts without Sorani locale data", () => {
  withoutSoraniNumberData();
  for (const [
    locale,
    applications,
    approvals,
    matching,
    cycle,
    total,
    rowCycle,
  ] of [
    [
      "ckb",
      "داواکارییە چاوەڕوانەکانی خاوەن: ٣",
      "پەسەندکردنی چاوەڕوانی ناوەڕۆک: ١٢",
      "تۆمارە هاوتاکان:",
      "خولی پێداچوونەوە",
      "١٬٢٣٤",
      "٢٥",
    ],
    [
      "en",
      "Pending Owner Applications: 3",
      "Pending content approvals: 12",
      "Matching records:",
      "Review cycle",
      "1,234",
      "25",
    ],
    [
      "ar",
      "طلبات المالك المعلقة: 3",
      "موافقات المحتوى المعلقة: 12",
      "السجلات المطابقة:",
      "دورة المراجعة",
      "1,234",
      "25",
    ],
  ] as const) {
    const { unmount } = render(
      <AdministratorRecords
        locale={locale}
        initialFilters={{
          kind: "approvals",
          query: "",
          status: null,
          from: null,
          through: null,
          ownerId: null,
        }}
        initial={{
          status: "ready",
          page: {
            pendingApplications: 3,
            pendingApprovals: 12,
            total: 1234,
            nextCursor: null,
            rows: [
              {
                kind: "approvals",
                id,
                ownerId: id,
                label: "Synthetic cottage",
                status: "in_review",
                at: createdAt,
                cycleNumber: 25,
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: applications })).toBeVisible();
    expect(screen.getByRole("button", { name: approvals })).toBeVisible();
    expect(
      screen.getByText(matching).querySelector("strong")?.textContent,
    ).toBe(total);
    expect(screen.getByText(cycle).nextElementSibling?.textContent).toBe(
      rowCycle,
    );
    expect(screen.getByText(id)).toBeVisible();
    unmount();
  }
});

it("localizes Sorani cycle numbers without Sorani locale data", () => {
  withoutSoraniNumberData();
  for (const [locale, cycle, expected] of [
    ["ckb", "خولی پێداچوونەوە", "٢٥"],
    ["en", "Review cycle", "25"],
    ["ar", "دورة المراجعة", "25"],
  ] as const) {
    const { unmount } = render(
      <AdministratorRecordDetailView
        locale={locale}
        record={{
          kind: "approval",
          id,
          profileId: id,
          ownerId: id,
          name: "Synthetic cottage",
          approximateLocation: "Synthetic locality",
          state: "in_review",
          cycleNumber: 25,
          createdAt,
          decidedAt: null,
          publicationDecision: null,
          localizedDecisions: [],
        }}
      />,
    );
    expect(
      screen.getByText(cycle).nextElementSibling?.textContent?.trim(),
    ).toBe(expected);
    expect(screen.getAllByText(id)).toHaveLength(3);
    unmount();
  }
});

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/administrator-records/marketplace-suspension-actions", () => ({
  setMarketplaceSuspension: vi.fn(),
  readMarketplaceSuspension: vi.fn(),
}));

vi.mock("@/administrator-records/supabase-administrator-records", () => ({
  loadAdministratorRecord: vi.fn(),
}));
vi.mock("@/administrator-records/supabase-marketplace-suspension", () => ({
  loadMarketplaceSuspension: vi.fn(),
}));
vi.mock("@/administrator-records/actions", () => ({
  searchAdministratorRecordsAction: vi.fn(),
}));

const cottageBoundary = vi.hoisted(() => ({
  load: vi.fn(),
  canAdministratorManageLifecycle: vi.fn(async () => false),
  loadCurrentReview: vi.fn(async () => null),
  loadTranslationAdministration: vi.fn(async () => null),
}));
vi.mock("@/access/platform-administrator-gate", () => ({
  resolvePlatformAdministratorAccess: vi.fn(async () => "allowed"),
}));
vi.mock("@/cottage-profile/request-cottage-profile", () => ({
  createRequestCottageProfile: vi.fn(async () => cottageBoundary),
}));
vi.mock("@/cottage-publication/request-cottage-publication", () => ({
  createRequestCottagePublication: vi.fn(async () => cottageBoundary),
}));
vi.mock("@/cottage-profile/actions", () => ({
  deleteCottageProfilePhotoAction: vi.fn(),
  previewCottageProfilePhotoAction: vi.fn(),
  saveAdministratorCottageProfileAction: vi.fn(),
  saveOwnerCottageProfileAction: vi.fn(),
  submitCottageProfileAction: vi.fn(),
  uploadCottageProfilePhotoAction: vi.fn(),
  abandonAdministratorCottageProfileAction: vi.fn(),
  abandonOwnerCottageProfileAction: vi.fn(),
  restoreAdministratorCottageProfileAction: vi.fn(),
  setAdministratorCottageDescriptionVisibilityAction: vi.fn(),
  setAdministratorCottagePhotoVisibilityAction: vi.fn(),
}));
vi.mock("@/cottage-publication/actions", () => ({
  correctCottageLocalizationAction: vi.fn(),
  decideCottageLocalizationAction: vi.fn(),
  decideCottagePublicationAction: vi.fn(),
  generateCottageTranslationAction: vi.fn(),
  reportCottageTranslationAction: vi.fn(),
  routeCottageTranslationToHumanReviewAction: vi.fn(),
}));
import AdministratorCottageProfilePage from "@/app/[locale]/administrator/cottages/[profileId]/page";
import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import AdministratorRecordDetailPage from "@/app/[locale]/administrator/records/[recordKind]/[recordId]/page";
import { loadAdministratorRecord } from "@/administrator-records/supabase-administrator-records";
import { loadMarketplaceSuspension } from "@/administrator-records/supabase-marketplace-suspension";
import {
  setMarketplaceSuspension,
  readMarketplaceSuspension,
} from "@/administrator-records/marketplace-suspension-actions";
import type { MarketplaceSuspensionReady } from "@/administrator-records/marketplace-suspension";
import { MarketplaceSuspensionControls } from "./marketplace-suspension-controls";

const target = {
  kind: "customer",
  id: "10000000-0000-4000-8000-000000000001",
} as const;
const initial: MarketplaceSuspensionReady = {
  status: "ready",
  targetKind: "customer",
  targetId: target.id,
  state: "active",
  revision: 0,
  applicationId: null,
  canSuspend: true,
  canReactivate: false,
  restrictionReason: null,
  restorationState: null,
  restorationRestriction: null,
  releaseSummary: { affected: 0, resolved: 0, processing: 0, quarantined: 0 },
  actions: [],
  nextCursor: null,
};
const suspended: MarketplaceSuspensionReady = {
  ...initial,
  state: "suspended",
  revision: 1,
  canSuspend: false,
  canReactivate: true,
  restorationState: "active",
  releaseSummary: { affected: 4, resolved: 1, processing: 2, quarantined: 1 },
  actions: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      commandId: "30000000-0000-4000-8000-000000000001",
      actorUserId: "40000000-0000-4000-8000-000000000001",
      action: "suspend",
      expectedRevision: 0,
      resultingRevision: 1,
      fromState: "active",
      toState: "suspended",
      reason: "Safety review",
      createdAt: "2026-10-19T12:34:56Z",
      affected: 4,
      resolved: 1,
      processing: 2,
      quarantined: 1,
    },
  ],
};

beforeEach(() => vi.resetAllMocks());

describe("marketplace suspension controls", () => {
  it("requires a reason and displays the authoritative suspension and release facts after a driven command", async () => {
    const user = userEvent.setup();
    vi.mocked(setMarketplaceSuspension).mockResolvedValue({
      status: "completed",
      actionId: suspended.actions[0].id,
      target: suspended,
    });
    render(
      <MarketplaceSuspensionControls
        locale="en"
        target={target}
        initial={initial}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Customer activity" }),
    ).toBeVisible();
    const reason = screen.getByRole("textbox", { name: "Reason" });
    expect(reason).toBeRequired();
    await user.click(
      screen.getByRole("button", { name: "Suspend new activity" }),
    );
    expect(setMarketplaceSuspension).not.toHaveBeenCalled();
    await user.type(reason, "Safety review");
    await user.click(
      screen.getByRole("button", { name: "Suspend new activity" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Command completed. Current restriction and payment release progress are shown below.",
    );
    expect(
      screen.getByText("Suspended", { selector: ".status-badge" }),
    ).toBeVisible();
    expect(setMarketplaceSuspension).toHaveBeenCalledWith({
      locale: "en",
      target,
      action: "suspend",
      expectedRevision: 0,
      reason: "Safety review",
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    const summary = screen.getByRole("group", {
      name: "Payment release progress",
    });
    for (const [label, value] of [
      ["Affected", "4"],
      ["Resolved", "1"],
      ["Processing", "2"],
      ["Needs attention", "1"],
    ]) {
      expect(
        within(summary).getByText(label).nextElementSibling,
      ).toHaveTextContent(value);
    }
    expect(
      screen.getByRole("link", { name: "Review payments needing attention" }),
    ).toHaveAttribute("href", "/en/administrator/payments");
    expect(
      screen.queryByRole("button", { name: /resolve/i }),
    ).not.toBeInTheDocument();
    const history = screen.getByRole("region", { name: "Restriction history" });
    expect(within(history).getByText("Safety review")).toBeVisible();
    expect(
      within(history).getByText("40000000-0000-4000-8000-000000000001"),
    ).toBeVisible();
    expect(within(history).getByText("Oct 19, 2026, 3:34 PM")).toHaveAttribute(
      "datetime",
      "2026-10-19T12:34:56Z",
    );
  });
  it("keeps an exclusive unchanged command across an unknown response and retry, then renders the current replay snapshot", async () => {
    const user = userEvent.setup();
    let reject!: (reason: Error) => void;
    vi.mocked(setMarketplaceSuspension).mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    render(
      <MarketplaceSuspensionControls
        locale="en"
        target={target}
        initial={initial}
      />,
    );
    const reason = screen.getByRole("textbox", { name: "Reason" });
    await user.type(reason, "Safety review");
    await user.click(
      screen.getByRole("button", { name: "Suspend new activity" }),
    );
    expect(reason).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Suspend new activity" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Active", { selector: ".status-badge" }),
    ).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => reject(new Error("Response lost")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The result is uncertain. Retry the unchanged action or refresh the current restriction. Payment release is not confirmed.",
    );
    expect(reason).toHaveValue("Safety review");
    vi.mocked(setMarketplaceSuspension).mockResolvedValueOnce({
      status: "retry",
    });
    await user.click(
      screen.getByRole("button", { name: "Retry previous action" }),
    );
    expect(setMarketplaceSuspension).toHaveBeenCalledTimes(2);
    expect(vi.mocked(setMarketplaceSuspension).mock.calls[1][0]).toEqual(
      vi.mocked(setMarketplaceSuspension).mock.calls[0][0],
    );
    const currentReplay = {
      ...initial,
      revision: 22,
      actions: suspended.actions,
      nextCursor: {
        createdAt: "2026-10-19T12:34:56Z",
        id: suspended.actions[0].id,
      },
    };
    vi.mocked(setMarketplaceSuspension).mockResolvedValueOnce({
      status: "completed",
      actionId: suspended.actions[0].id,
      target: currentReplay,
    });
    await user.click(
      screen.getByRole("button", { name: "Retry previous action" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Command completed.",
    );
    expect(
      screen.getByText("Active", { selector: ".status-badge" }),
    ).toBeVisible();
    expect(reason).toHaveValue("");
    await user.type(reason, "A new decision");
    vi.mocked(setMarketplaceSuspension).mockResolvedValueOnce({
      status: "retry",
    });
    await user.click(
      screen.getByRole("button", { name: "Suspend new activity" }),
    );
    const original = vi.mocked(setMarketplaceSuspension).mock.calls[0][0] as {
      commandId: string;
    };
    expect(vi.mocked(setMarketplaceSuspension).mock.calls[3][0]).toEqual(
      expect.objectContaining({
        expectedRevision: 22,
        reason: "A new decision",
        commandId: expect.not.stringMatching(original.commandId),
      }),
    );
    await user.type(reason, " edited");
    vi.mocked(setMarketplaceSuspension).mockResolvedValueOnce({
      status: "retry",
    });
    await user.click(
      screen.getByRole("button", { name: "Suspend new activity" }),
    );
    const previous = vi.mocked(setMarketplaceSuspension).mock.calls[3][0] as {
      commandId: string;
    };
    expect(vi.mocked(setMarketplaceSuspension).mock.calls[4][0]).toEqual(
      expect.objectContaining({
        reason: "A new decision edited",
        commandId: expect.not.stringMatching(previous.commandId),
      }),
    );
  });

  it("requires refresh after conflict and retains the last known state and history on unavailable reads", async () => {
    const user = userEvent.setup();
    vi.mocked(setMarketplaceSuspension).mockResolvedValue({
      status: "conflict",
    });
    render(
      <MarketplaceSuspensionControls
        locale="en"
        target={target}
        initial={suspended}
      />,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "Verification checked",
    );
    await user.click(
      screen.getByRole("button", { name: "Reactivate eligible activity" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This record changed. Refresh before making a new decision.",
    );
    expect(
      screen.queryByRole("button", { name: "Reactivate eligible activity" }),
    ).not.toBeInTheDocument();
    vi.mocked(readMarketplaceSuspension).mockResolvedValueOnce({
      status: "unavailable",
    });
    await user.click(
      screen.getByRole("button", {
        name: "Refresh restriction and release progress",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Restriction information is unavailable. Refresh before taking another action.",
    );
    expect(
      screen.getByText(
        "Last loaded restriction and history are shown; current information is unavailable.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Safety review")).toBeVisible();
    expect(
      screen.queryByText("No restriction actions are recorded."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Reason" }),
    ).not.toBeInTheDocument();
    let resolve!: (value: MarketplaceSuspensionReady) => void;
    vi.mocked(readMarketplaceSuspension).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Refresh restriction and release progress",
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "Refresh restriction and release progress",
      }),
    ).toBeDisabled();
    await act(async () =>
      resolve({
        ...suspended,
        releaseSummary: {
          affected: 4,
          resolved: 3,
          processing: 0,
          quarantined: 1,
        },
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Restriction and payment release progress refreshed.",
    );
    expect(screen.getByRole("textbox", { name: "Reason" })).toHaveValue(
      "Verification checked",
    );
    const summary = screen.getByRole("group", {
      name: "Payment release progress",
    });
    expect(
      within(summary).getByText("Resolved").nextElementSibling,
    ).toHaveTextContent("3");
    expect(readMarketplaceSuspension).toHaveBeenCalledTimes(2);
    expect(readMarketplaceSuspension).toHaveBeenLastCalledWith({
      locale: "en",
      target,
    });
  });

  it("keeps an initially unavailable card explicit and can recover through an explicit refresh", async () => {
    const user = userEvent.setup();
    render(
      <MarketplaceSuspensionControls
        locale="en"
        target={target}
        initial={{ status: "unavailable" }}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Customer activity" }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Restriction information is unavailable.",
    );
    expect(
      screen.queryByText("No restriction actions are recorded."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Reason" }),
    ).not.toBeInTheDocument();
    vi.mocked(readMarketplaceSuspension).mockResolvedValueOnce(initial);
    await user.click(
      screen.getByRole("button", {
        name: "Refresh restriction and release progress",
      }),
    );
    expect(
      await screen.findByRole("textbox", { name: "Reason" }),
    ).toBeRequired();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["owner", "approved", null, "Approved"],
    ["owner", "expired", "verification-expired", "Expired: renewal required"],
    ["cottage", "published", null, "Published"],
    ["cottage", "paused", "previously-paused", "Paused"],
    ["cottage", "unpublished", null, "Unpublished"],
  ] as const)(
    "reactivates %s into returned %s without reopening closed inventory",
    async (kind, restoredState, restorationRestriction, label) => {
      const user = userEvent.setup();
      const ready: MarketplaceSuspensionReady = {
        ...suspended,
        targetKind: kind,
        restorationState: restoredState,
        restorationRestriction,
        applicationId:
          kind === "owner" ? "50000000-0000-4000-8000-000000000001" : null,
        actions: [],
      };
      vi.mocked(setMarketplaceSuspension).mockResolvedValueOnce({
        status: "completed",
        actionId: suspended.actions[0].id,
        target: {
          ...ready,
          revision: 2,
          state: restoredState,
          canSuspend: true,
          canReactivate: false,
          restorationState: null,
          restorationRestriction: null,
        },
      });
      render(
        <MarketplaceSuspensionControls
          locale="en"
          target={{ ...target, kind }}
          initial={ready}
        />,
      );
      expect(screen.getByText(`Eligible restoration: ${label}`)).toBeVisible();
      expect(
        screen.getByText(
          "Closed dates, private blocks, holds and confirmed commitments remain unchanged. Separate cottage restrictions remain.",
        ),
      ).toBeVisible();
      await user.type(
        screen.getByRole("textbox", { name: "Reason" }),
        "Eligibility checked",
      );
      await user.click(
        screen.getByRole("button", { name: "Reactivate eligible activity" }),
      );
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Command completed.",
      );
      expect(
        screen.getByText(label, { selector: ".status-badge" }),
      ).toBeVisible();
      expect(setMarketplaceSuspension).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "reactivate",
          expectedRevision: 1,
          target: { ...target, kind },
        }),
      );
    },
  );

  it("keeps prospective owners on application review without a new suspension action", () => {
    render(
      <MarketplaceSuspensionControls
        locale="en"
        target={{ ...target, kind: "owner" }}
        initial={{
          ...initial,
          targetKind: "owner",
          state: "under_review",
          applicationId: "50000000-0000-4000-8000-000000000001",
          canSuspend: false,
          restrictionReason: "owner-application-ineligible",
        }}
      />,
    );
    expect(
      screen.getByText(
        "Use the existing Owner Application review for this application state.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Review Owner Application" }),
    ).toHaveAttribute(
      "href",
      "/en/administrator/owner-applications/50000000-0000-4000-8000-000000000001",
    );
    expect(
      screen.queryByRole("textbox", { name: "Reason" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Suspend new activity" }),
    ).not.toBeInTheDocument();
  });

  it("loads older immutable history through the supplied cursor and retains it when the next page is unavailable", async () => {
    const user = userEvent.setup();
    const cursor = {
      createdAt: "2026-10-19T12:34:56Z",
      id: suspended.actions[0].id,
    };
    const older = {
      ...suspended.actions[0],
      id: "20000000-0000-4000-8000-000000000002",
      commandId: "30000000-0000-4000-8000-000000000002",
      reason: "Older immutable reason",
      createdAt: "2026-10-18T12:34:56Z",
    };
    render(
      <MarketplaceSuspensionControls
        locale="en"
        target={target}
        initial={{ ...suspended, nextCursor: cursor }}
      />,
    );
    vi.mocked(readMarketplaceSuspension).mockResolvedValueOnce({
      ...suspended,
      actions: [older],
      nextCursor: { ...cursor, id: older.id },
    });
    await user.click(
      screen.getByRole("button", { name: "Load older restriction history" }),
    );
    expect(await screen.findByText("Older immutable reason")).toBeVisible();
    expect(screen.getByText("Safety review")).toBeVisible();
    expect(readMarketplaceSuspension).toHaveBeenCalledWith({
      locale: "en",
      target,
      cursor,
    });
    vi.mocked(readMarketplaceSuspension).mockResolvedValueOnce({
      status: "unavailable",
    });
    await user.click(
      screen.getByRole("button", { name: "Load older restriction history" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Restriction information is unavailable.",
    );
    expect(screen.getByText("Older immutable reason")).toBeVisible();
    expect(screen.getByText("Safety review")).toBeVisible();
    expect(
      screen.queryByText("No restriction actions are recorded."),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      "en",
      "Customer activity",
      "Reason",
      "Suspend new activity",
      "Suspended",
      "Payment release progress",
      "Needs attention",
      "Review payments needing attention",
      "Restriction history",
      "Refresh restriction and release progress",
      "Restriction and payment release progress refreshed.",
      "4",
      "1",
      "The result is uncertain.",
      "Retry previous action",
    ],
    [
      "ar",
      "نشاط العميل",
      "السبب",
      "علّق النشاط الجديد",
      "معلّق",
      "تقدّم تحرير الدفعات",
      "يحتاج إلى متابعة",
      "راجع الدفعات التي تحتاج إلى متابعة",
      "سجل القيود",
      "حدّث القيد وتقدّم تحرير الدفعات",
      "تم تحديث القيد وتقدّم تحرير الدفعات.",
      "4",
      "1",
      "النتيجة غير مؤكدة.",
      "أعد محاولة الإجراء السابق",
    ],
    [
      "ckb",
      "چالاکی کڕیار",
      "هۆکار",
      "چالاکی نوێ ڕابگرە",
      "ڕاگیراو",
      "پێشکەوتنی ئازادکردنی پارەدان",
      "پێویستی بە بەدواداچوونە",
      "پارەدانە پێویست بە بەدواداچوونەکان بپشکنە",
      "مێژووی سنووردارکردن",
      "سنووردارکردن و پێشکەوتنی ئازادکردنی پارەدان نوێ بکەرەوە",
      "سنووردارکردن و پێشکەوتنی ئازادکردنی پارەدان نوێ کرانەوە.",
      "٤",
      "١",
      "ئەنجامەکە دڵنیا نییە.",
      "کردارەکەی پێشوو دووبارە بکەرەوە",
    ],
  ] as const)(
    "drives localized restriction, uncertain retry and refresh in %s",
    async (
      locale,
      title,
      reasonLabel,
      suspendLabel,
      suspendedLabel,
      progressLabel,
      attentionLabel,
      attentionLink,
      historyLabel,
      refreshLabel,
      refreshedLabel,
      affectedCount,
      attentionCount,
      uncertainLabel,
      retryLabel,
    ) => {
      const user = userEvent.setup();
      vi.mocked(setMarketplaceSuspension)
        .mockResolvedValueOnce({ status: "retry" })
        .mockResolvedValueOnce({
          status: "completed",
          actionId: suspended.actions[0].id,
          target: suspended,
        });
      render(
        <MarketplaceSuspensionControls
          locale={locale}
          target={target}
          initial={initial}
        />,
      );
      expect(screen.getByRole("region", { name: title })).toHaveAttribute(
        "dir",
        locale === "en" ? "ltr" : "rtl",
      );
      await user.type(
        screen.getByRole("textbox", { name: reasonLabel }),
        "Safety review",
      );
      await user.click(screen.getByRole("button", { name: suspendLabel }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        uncertainLabel,
      );
      await user.click(screen.getByRole("button", { name: retryLabel }));
      expect(await screen.findByRole("status")).toBeVisible();
      expect(
        screen.getByText(suspendedLabel, { selector: ".status-badge" }),
      ).toBeVisible();
      const progress = screen.getByRole("group", { name: progressLabel });
      expect(within(progress).getAllByRole("definition")[0]).toHaveTextContent(
        affectedCount,
      );
      expect(
        within(progress).getByText(attentionLabel).nextElementSibling,
      ).toHaveTextContent(attentionCount);
      expect(screen.getByRole("link", { name: attentionLink })).toHaveAttribute(
        "href",
        `/${locale}/administrator/payments`,
      );
      expect(
        within(screen.getByRole("region", { name: historyLabel })).getByText(
          "Safety review",
        ),
      ).toBeVisible();
      vi.mocked(readMarketplaceSuspension).mockResolvedValueOnce(suspended);
      await user.click(screen.getByRole("button", { name: refreshLabel }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        refreshedLabel,
      );
    },
  );

  it.each([
    ["customer", false],
    ["cottage_owner", false],
    ["customer", true],
    ["cottage_owner", true],
  ] as const)(
    "integrates customer controls for %s accounts and owner controls only with application facts %s",
    async (marketplaceRole, hasApplication) => {
      const user = userEvent.setup();
      vi.mocked(loadAdministratorRecord).mockResolvedValueOnce({
        status: "ready",
        record: {
          kind: "account",
          id: target.id,
          marketplaceRole,
          customerCapability: true,
          createdAt: "2026-10-19T12:34:56Z",
          ...(hasApplication
            ? {
                applicationId: "50000000-0000-4000-8000-000000000001",
                ownerApprovalState: "under_review",
              }
            : {}),
        },
      });
      vi.mocked(loadMarketplaceSuspension)
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce({
          ...initial,
          targetKind: "owner",
          state: "under_review",
          canSuspend: false,
          restrictionReason: "owner-application-ineligible",
          applicationId: "50000000-0000-4000-8000-000000000001",
        });
      render(
        await AdministratorRecordDetailPage({
          params: Promise.resolve({
            locale: "en",
            recordKind: "account",
            recordId: target.id,
          }),
        }),
      );
      const customer = screen.getByRole("region", {
        name: "Customer activity",
      });
      expect(customer).toBeVisible();
      expect(
        screen.queryByRole("region", { name: "Owner activity" }) !== null,
      ).toBe(hasApplication);
      expect(loadMarketplaceSuspension).toHaveBeenCalledWith(target);
      expect(loadMarketplaceSuspension).toHaveBeenCalledTimes(
        hasApplication ? 2 : 1,
      );
      if (hasApplication) {
        const owner = screen.getByRole("region", { name: "Owner activity" });
        expect(
          within(owner).queryByRole("button", { name: "Suspend new activity" }),
        ).not.toBeInTheDocument();
        expect(
          within(owner).getByRole("link", { name: "Review Owner Application" }),
        ).toBeVisible();
      }
      vi.mocked(setMarketplaceSuspension).mockResolvedValueOnce({
        status: "completed",
        actionId: suspended.actions[0].id,
        target: suspended,
      });
      await user.type(
        within(customer).getByRole("textbox", { name: "Reason" }),
        "Safety review",
      );
      await user.click(
        within(customer).getByRole("button", { name: "Suspend new activity" }),
      );
      expect(await within(customer).findByRole("status")).toBeVisible();
      expect(setMarketplaceSuspension).toHaveBeenCalledWith(
        expect.objectContaining({ target }),
      );
    },
  );

  it("integrates cottage activity before publication and keeps a failed read visible", async () => {
    const user = userEvent.setup();
    const profile: CottageProfile = {
      id: target.id,
      ownerUserId: "10000000-0000-4000-8000-000000000002",
      applicationId: null,
      currentPublicationId: null,
      status: "draft",
      version: 1,
      name: "Synthetic cottage",
      governorate: "Erbil",
      approximateLocation: "Shaqlawa",
      exactAddress: "Private address",
      exactLatitude: 36.4,
      exactLongitude: 44.3,
      privateDirections: "Private directions",
      capacity: 6,
      bedrooms: 3,
      bathrooms: 2,
      amenities: ["garden"],
      sourceLanguage: "en",
      description: "Description",
      houseRules: "Rules",
      photos: [],
      submittedSourceRevision: null,
      hasUnpublishedContentChange: false,
      updatedAt: "2026-10-19T12:34:56Z",
    };
    cottageBoundary.load.mockResolvedValueOnce(profile);
    vi.mocked(loadMarketplaceSuspension).mockResolvedValueOnce({
      status: "unavailable",
    });
    render(
      await AdministratorCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId: target.id }),
      }),
    );
    const card = screen.getByRole("region", { name: "Cottage activity" });
    expect(card).toBeVisible();
    expect(within(card).getByRole("alert")).toHaveTextContent(
      "Restriction information is unavailable.",
    );
    expect(loadMarketplaceSuspension).toHaveBeenCalledWith({
      kind: "cottage",
      id: target.id,
    });
    vi.mocked(readMarketplaceSuspension).mockResolvedValueOnce({
      ...initial,
      targetKind: "cottage",
      state: "unpublished",
    });
    await user.click(
      within(card).getByRole("button", {
        name: "Refresh restriction and release progress",
      }),
    );
    expect(
      await within(card).findByRole("button", { name: "Suspend new activity" }),
    ).toBeEnabled();
    expect(
      within(card).getByText("Unpublished", { selector: ".status-badge" }),
    ).toBeVisible();
  });

  it("identifies an empty normalized reason and associates a rejected reason with the field", async () => {
    const user = userEvent.setup();
    render(
      <MarketplaceSuspensionControls
        locale="en"
        target={target}
        initial={initial}
      />,
    );
    const reason = screen.getByRole("textbox", { name: "Reason" });
    await user.type(reason, "   ");
    await user.click(
      screen.getByRole("button", { name: "Suspend new activity" }),
    );
    expect(setMarketplaceSuspension).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a reason of 1 to 1,000 characters.",
    );
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAccessibleDescription(
      "Enter a reason of 1 to 1,000 characters.",
    );
    await user.clear(reason);
    await user.type(reason, "Safety review");
    vi.mocked(setMarketplaceSuspension).mockResolvedValueOnce({
      status: "invalid",
    });
    await user.click(
      screen.getByRole("button", { name: "Suspend new activity" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a reason of 1 to 1,000 characters.",
    );
    expect(reason).toHaveValue("Safety review");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["access_required", "not_found"] as const)(
    "withholds commands after a definitive %s response until a successful refresh",
    async (status) => {
      const user = userEvent.setup();
      render(
        <MarketplaceSuspensionControls
          locale="en"
          target={target}
          initial={initial}
        />,
      );
      await user.type(
        screen.getByRole("textbox", { name: "Reason" }),
        "Safety review",
      );
      vi.mocked(setMarketplaceSuspension).mockResolvedValueOnce({ status });
      await user.click(
        screen.getByRole("button", { name: "Suspend new activity" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Restriction information is unavailable.",
      );
      expect(
        screen.queryByRole("textbox", { name: "Reason" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText("Active", { selector: ".status-badge" }),
      ).toBeVisible();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  it("does not announce empty audit history after a failed refresh", async () => {
    const user = userEvent.setup();
    render(
      <MarketplaceSuspensionControls
        locale="en"
        target={target}
        initial={initial}
      />,
    );
    expect(
      screen.getByText("No restriction actions are recorded."),
    ).toBeVisible();
    vi.mocked(readMarketplaceSuspension).mockRejectedValueOnce(
      new Error("Reader unavailable"),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Refresh restriction and release progress",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Restriction information is unavailable.",
    );
    expect(
      screen.queryByText("No restriction actions are recorded."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Last loaded restriction and history are shown; current information is unavailable.",
      ),
    ).toBeVisible();
  });
});

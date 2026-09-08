import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import { AdministratorPaymentHistoryView } from "./administrator-payment-history";

const history = {
  bookingRequestReference: "RC-REQ-0000000000000137",
  simulated: true as const,
  current: {
    requestStatus: "accepted",
    paymentStatus: "payment-required",
    expiryStatus: null,
    reasonCode: null,
    paymentRequiredDeadline: null,
  },
  historyCoverage: "retained-evidence-only" as const,
  events: [
    {
      id: "10000000-0000-4000-8000-000000000137",
      kind: "physical-attempt" as const,
      source: "provider-operation",
      provenance: "imported" as const,
      operationKind: "capture",
      outcome: "indeterminate",
      logicalOperationId: "logical-137",
      physicalAttemptId: "physical-137",
      providerReference: "reference-unavailable",
      amountFils: "105000000",
      currency: "IQD" as const,
      providerOccurredAt: "2026-09-08T10:00:00+00:00",
      recordedAt: "2026-09-08T10:00:01+00:00",
    },
    {
      id: "20000000-0000-4000-8000-000000000137",
      kind: "receipt-observation" as const,
      source: "provider-receipt",
      provenance: "observed" as const,
      operationKind: "capture",
      outcome: "succeeded",
      reasonCode: "unclassified-evidence",
      receivedAt: "2026-09-08T10:05:00+00:00",
      recordedAt: "2026-09-08T10:05:01+00:00",
    },
  ],
};

it("renders ordered support evidence and distinct clocks accessibly in English", () => {
  render(<AdministratorPaymentHistoryView locale="en" history={history} />);
  expect(
    screen.getByRole("heading", { name: "Payment support history" }),
  ).toBeVisible();
  expect(screen.getByRole("note")).toHaveTextContent("older request");
  const events = screen.getAllByRole("listitem");
  expect(within(events[0]).getAllByText("Physical attempt")).toHaveLength(2);
  expect(within(events[0]).getByText("Indeterminate")).toBeVisible();
  expect(within(events[1]).getByText("Succeeded")).toBeVisible();
  expect(within(events[0]).getByText("Amount").parentElement).toHaveTextContent(
    "105000 IQD",
  );
  expect(
    within(events[0]).queryByText("105000000 IQD"),
  ).not.toBeInTheDocument();
  expect(within(events[0]).getByText("Logical operation")).toBeVisible();
  expect(within(events[0]).getByText("Provider reference")).toBeVisible();
  expect(screen.getByText("Provider occurrence")).toBeVisible();
  expect(screen.getByText("Received by RentCottage")).toBeVisible();
});

it.each(["ar", "ckb"] as const)(
  "renders the right-to-left %s support history without raw English codes",
  (locale) => {
    const { container } = render(
      <div dir="rtl">
        <AdministratorPaymentHistoryView locale={locale} history={history} />
      </div>,
    );
    expect(container.querySelector("bdi")).toHaveTextContent(
      "RC-REQ-0000000000000137",
    );
    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    const rendered = container.textContent ?? "";
    expect(rendered).not.toMatch(
      /physical-attempt|capture|succeeded|unclassified-evidence|reference-unavailable/,
    );
    if (locale === "ar") {
      expect(rendered).toContain("محاولة تنفيذ");
      expect(rendered).toContain("تحصيل");
      expect(rendered).toContain("ناجح");
      expect(rendered).toContain("دليل غير مصنف");
      expect(rendered).toContain("المرجع غير متاح");
    } else {
      expect(rendered).toContain("هەوڵی جێبەجێکردن");
      expect(rendered).toContain("وەرگرتنی پارە");
      expect(rendered).toContain("سەرکەوتوو");
      expect(rendered).toContain("بەڵگەی پۆلێننەکراو");
      expect(rendered).toContain("سەرچاوە بەردەست نییە");
    }
  },
);

it("explains an absent payment state instead of rendering an ambiguous dash", () => {
  render(
    <AdministratorPaymentHistoryView
      locale="en"
      history={{
        ...history,
        current: { ...history.current, paymentStatus: null },
      }}
    />,
  );
  expect(screen.getByText("No payment state recorded")).toBeVisible();
  expect(screen.queryByText("—")).not.toBeInTheDocument();
});

it.each([
  ["1", "0.001 IQD"],
  ["105000001", "105000.001 IQD"],
  ["9223372036854775807", "9223372036854775.807 IQD"],
])(
  "renders %s fils exactly without floating point rounding",
  (amountFils, expected) => {
    render(
      <AdministratorPaymentHistoryView
        locale="en"
        history={{ ...history, events: [{ ...history.events[0], amountFils }] }}
      />,
    );
    expect(screen.getByText("Amount").parentElement).toHaveTextContent(
      expected,
    );
  },
);

it.each([
  [
    "en",
    "Quarantined",
    "Replacement capture",
    "Conflicting provider observation",
  ],
  ["ar", "معزول للمراجعة", "تحصيل بديل", "ملاحظة مزود متعارضة"],
  [
    "ckb",
    "گۆشەگیرکراو بۆ پێداچوونەوە",
    "وەرگرتنی پارەی جێگرەوە",
    "تێبینی ناکۆکی دابینکەر",
  ],
] as const)(
  "shows actionable quarantine, operation, and reason in %s",
  (locale, state, operation, reason) => {
    render(
      <AdministratorPaymentHistoryView
        locale={locale}
        history={{
          ...history,
          current: { ...history.current, expiryStatus: "quarantined" },
          events: [
            {
              ...history.events[1],
              operationKind: "replacement-capture",
              reasonCode: "conflicting-provider-observation",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(state)).toBeVisible();
    expect(screen.getByText(operation)).toBeVisible();
    expect(screen.getByText(reason)).toBeVisible();
  },
);

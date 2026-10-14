import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { notFound, redirect, requireAccount, resolveName } = vi.hoisted(() => ({
  notFound: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
  requireAccount: vi.fn(),
  resolveName: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: requireAccount,
}));
vi.mock("@/access/request-account-name", () => ({
  resolveRequestAccountName: resolveName,
}));
vi.mock("@/access/actions", () => ({
  saveAccountName: vi.fn(),
  signOutAccount: vi.fn(),
}));
import PersonalInformationPage from "./page";

const context = { userId: "user-1", role: "customer" } as const;

function renderPage(locale = "en") {
  return PersonalInformationPage({ params: Promise.resolve({ locale }) });
}

describe("Personal information page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccount.mockResolvedValue({ status: "authenticated", context });
  });

  it("fills in the person's own first name", async () => {
    resolveName.mockResolvedValue({
      status: "named",
      firstName: "Zana",
      initial: "Z",
    });
    render(await renderPage());

    expect(resolveName).toHaveBeenCalledExactlyOnceWith(context);
    expect(requireAccount).toHaveBeenCalledExactlyOnceWith("en", "/en/account");
    expect(screen.getByRole("main")).toHaveClass("page", "page-record");
    expect(
      screen.getByRole("heading", { name: "Personal information" }),
    ).toHaveClass("page-title");
    expect(screen.getByLabelText("First name")).toHaveValue("Zana");
  });

  it("leaves the field empty when no first name is stored", async () => {
    resolveName.mockResolvedValue({ status: "missing" });
    render(await renderPage("ar"));

    expect(screen.getByLabelText("الاسم الأول")).toHaveValue("");
  });

  it("shows the unavailable state when the name cannot be read", async () => {
    resolveName.mockResolvedValue({ status: "unavailable" });
    render(await renderPage());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Account access is unavailable. Please try again.",
    );
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
  });

  it.each([
    ["has no context", { status: "authenticated" }],
    ["cannot be read", { status: "unavailable" }],
  ] as const)(
    "does not look for a name when the account %s",
    async (_reason, account) => {
      requireAccount.mockResolvedValue(account);
      render(await renderPage());

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Account access is unavailable. Please try again.",
      );
      expect(resolveName).not.toHaveBeenCalled();
    },
  );

  it("sends a Platform Administrator before two-step sign-in to administrator access", async () => {
    requireAccount.mockResolvedValue({
      status: "authenticated",
      context: { userId: "user-2", role: "platform_administrator" },
    });
    resolveName.mockResolvedValue({ status: "not_asked" });

    await expect(renderPage()).rejects.toThrow(
      "redirect:/en/administrator/access",
    );
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestPhone, signInAdministrator, verifyAdministrator, verifyPhone } =
  vi.hoisted(() => ({
    requestPhone: vi.fn(),
    signInAdministrator: vi.fn(),
    verifyAdministrator: vi.fn(),
    verifyPhone: vi.fn(),
  }));

vi.mock("@/access/actions", () => ({
  requestPhoneAccess: requestPhone,
  signInPlatformAdministrator: signInAdministrator,
  verifyPhoneAccess: verifyPhone,
  verifyPlatformAdministratorMfa: verifyAdministrator,
}));

import { AdministratorAccessForm } from "./administrator-access-form";
import { PhoneAccessForm } from "./phone-access-form";

describe("access forms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("suppresses repeated phone access requests while preserving result mapping", async () => {
    let resolveRequest!: (value: { status: "invalid_phone" }) => void;
    requestPhone.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    render(<PhoneAccessForm locale="en" role="customer" />);

    fireEvent.change(screen.getByLabelText("Iraqi phone number"), {
      target: { value: "invalid" },
    });
    const send = screen.getByRole("button", {
      name: "Send verification code",
    });
    act(() => {
      send.click();
      send.click();
    });

    expect(requestPhone).toHaveBeenCalledTimes(1);
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("aria-busy", "true");

    await act(async () => resolveRequest({ status: "invalid_phone" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid Iraqi number beginning +964.",
    );
    expect(send).toBeEnabled();
  });

  it("suppresses repeated phone verification while preserving invalid-code mapping", async () => {
    requestPhone.mockResolvedValue({ status: "code_sent" });
    let resolveVerification!: (value: { status: "invalid_code" }) => void;
    verifyPhone.mockReturnValue(
      new Promise((resolve) => {
        resolveVerification = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<PhoneAccessForm locale="en" role="customer" />);

    await user.type(
      screen.getByLabelText("Iraqi phone number"),
      "+9647500000000",
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await user.type(screen.getByLabelText("Verification code"), "123456");
    const verify = screen.getByRole("button", { name: "Verify" });
    act(() => {
      verify.click();
      verify.click();
    });

    expect(verifyPhone).toHaveBeenCalledTimes(1);
    expect(verify).toBeDisabled();
    expect(verify).toHaveAttribute("aria-busy", "true");

    await act(async () => resolveVerification({ status: "invalid_code" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The verification code could not be confirmed.",
    );
    expect(verify).toBeEnabled();
  });

  it("links an approved owner to Cottage Profiles after phone verification", async () => {
    requestPhone.mockResolvedValue({ status: "code_sent" });
    verifyPhone.mockResolvedValue({
      status: "authenticated",
      context: {
        role: "cottage_owner",
        approvalState: "approved",
      },
    });
    const user = userEvent.setup();
    render(
      <PhoneAccessForm
        locale="en"
        role="cottage_owner"
        applicationHref="/en/owner/application"
        cottageProfilesHref="/en/owner/cottages"
      />,
    );

    await user.type(
      screen.getByLabelText("Iraqi phone number"),
      "+9647500000000",
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Verified. Your private Cottage Profiles are ready.",
    );
    expect(
      screen.getByRole("link", { name: "Open Cottage Profiles" }),
    ).toHaveAttribute("href", "/en/owner/cottages");
    expect(
      screen.queryByRole("link", { name: "Continue to Owner Application" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a prospective owner on Owner Application after verification", async () => {
    requestPhone.mockResolvedValue({ status: "code_sent" });
    verifyPhone.mockResolvedValue({
      status: "authenticated",
      context: {
        role: "cottage_owner",
        approvalState: "prospective",
      },
    });
    const user = userEvent.setup();
    render(
      <PhoneAccessForm
        locale="en"
        role="cottage_owner"
        applicationHref="/en/owner/application"
        cottageProfilesHref="/en/owner/cottages"
      />,
    );

    await user.type(
      screen.getByLabelText("Iraqi phone number"),
      "+9647500000000",
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(
      screen.getByRole("link", { name: "Continue to Owner Application" }),
    ).toHaveAttribute("href", "/en/owner/application");
    expect(
      screen.queryByRole("link", { name: "Open Cottage Profiles" }),
    ).not.toBeInTheDocument();
  });

  it.each(["expired", "suspended"] as const)(
    "describes an %s owner as servicing-only after verification",
    async (approvalState) => {
      requestPhone.mockResolvedValue({ status: "code_sent" });
      verifyPhone.mockResolvedValue({
        status: "authenticated",
        context: { role: "cottage_owner", approvalState },
      });
      const user = userEvent.setup();
      render(
        <PhoneAccessForm
          locale="en"
          role="cottage_owner"
          applicationHref="/en/owner/application"
          cottageProfilesHref="/en/owner/cottages"
        />,
      );

      await user.type(
        screen.getByLabelText("Iraqi phone number"),
        "+9647500000000",
      );
      await user.click(
        screen.getByRole("button", { name: "Send verification code" }),
      );
      await user.type(screen.getByLabelText("Verification code"), "123456");
      await user.click(screen.getByRole("button", { name: "Verify" }));

      expect(screen.getByRole("status")).toHaveTextContent(
        "Your private profile remains available, but changes are unavailable while this owner account is expired or suspended.",
      );
      expect(
        screen.getByRole("link", { name: "Open Cottage Profiles" }),
      ).toHaveAttribute("href", "/en/owner/cottages");
    },
  );

  it("suppresses repeated administrator sign-in while preserving invalid-sign-in mapping", async () => {
    let resolveSignIn!: (value: { status: "invalid_sign_in" }) => void;
    signInAdministrator.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<AdministratorAccessForm locale="en" />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    const signIn = screen.getByRole("button", { name: "Continue" });
    act(() => {
      signIn.click();
      signIn.click();
    });

    expect(signInAdministrator).toHaveBeenCalledTimes(1);
    expect(signIn).toBeDisabled();
    expect(signIn).toHaveAttribute("aria-busy", "true");

    await act(async () => resolveSignIn({ status: "invalid_sign_in" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The sign-in is invalid or this is not an administrator account.",
    );
    expect(signIn).toBeEnabled();
  });

  it("suppresses repeated administrator MFA verification while preserving invalid-code mapping", async () => {
    signInAdministrator.mockResolvedValue({
      status: "challenge_required",
      factorId: "factor-1",
      challengeId: "challenge-1",
    });
    let resolveVerification!: (value: { status: "invalid_code" }) => void;
    verifyAdministrator.mockReturnValue(
      new Promise((resolve) => {
        resolveVerification = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<AdministratorAccessForm locale="en" />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Authenticator app code"), "123456");
    const verify = screen.getByRole("button", { name: "Verify" });
    act(() => {
      verify.click();
      verify.click();
    });

    expect(verifyAdministrator).toHaveBeenCalledTimes(1);
    expect(verify).toBeDisabled();
    expect(verify).toHaveAttribute("aria-busy", "true");

    await act(async () => resolveVerification({ status: "invalid_code" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The verification code could not be confirmed.",
    );
    expect(screen.getByLabelText("Authenticator app code")).toBeVisible();
    expect(verify).toBeEnabled();
  });

  it("returns to administrator credentials after an unavailable MFA result", async () => {
    signInAdministrator.mockResolvedValue({
      status: "challenge_required",
      factorId: "factor-1",
      challengeId: "challenge-1",
    });
    verifyAdministrator.mockResolvedValue({ status: "unavailable" });
    const user = userEvent.setup();
    render(<AdministratorAccessForm locale="en" />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Authenticator app code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(screen.getByLabelText("Email")).toBeVisible();
    expect(
      screen.getByText("Verification is unavailable. Try again."),
    ).toBeVisible();
  });

  it("returns to administrator credentials after an expired MFA challenge", async () => {
    signInAdministrator.mockResolvedValue({
      status: "challenge_required",
      factorId: "factor-1",
      challengeId: "challenge-1",
    });
    verifyAdministrator.mockResolvedValue({ status: "challenge_expired" });
    const user = userEvent.setup();
    render(<AdministratorAccessForm locale="en" />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Authenticator app code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(screen.getByLabelText("Email")).toBeVisible();
    expect(screen.getByText(/code could not be confirmed/)).toBeVisible();
  });

  it("links an MFA-authenticated administrator to submitted applications", async () => {
    signInAdministrator.mockResolvedValue({
      status: "challenge_required",
      factorId: "factor-1",
      challengeId: "challenge-1",
    });
    verifyAdministrator.mockResolvedValue({ status: "authenticated" });
    const user = userEvent.setup();
    render(
      <AdministratorAccessForm
        locale="en"
        reviewHref="/en/administrator/owner-applications"
        cottageProfilesHref="/en/administrator/cottages"
      />,
    );

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Authenticator app code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(
      screen.getByRole("link", {
        name: "Review submitted Owner Applications",
      }),
    ).toHaveAttribute("href", "/en/administrator/owner-applications");
    expect(
      screen.getByRole("link", { name: "Manage Cottage Profiles" }),
    ).toHaveAttribute("href", "/en/administrator/cottages");
  });

  it("reports an identity mismatch as unavailable after phone verification", async () => {
    requestPhone.mockResolvedValue({ status: "code_sent" });
    verifyPhone.mockResolvedValue({ status: "not_authorized" });
    const user = userEvent.setup();
    render(<PhoneAccessForm locale="en" role="customer" />);

    await user.type(
      screen.getByLabelText("Iraqi phone number"),
      "+9647500000000",
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(
      screen.getByText("Verification is unavailable. Try again."),
    ).toBeVisible();
  });
});

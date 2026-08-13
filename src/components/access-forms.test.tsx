import { render, screen } from "@testing-library/react";
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

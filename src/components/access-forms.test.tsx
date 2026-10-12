import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  completePhone,
  refresh,
  replace,
  requestPhone,
  signInAdministrator,
  verifyAdministrator,
  verifyPhone,
} = vi.hoisted(() => ({
  completePhone: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  requestPhone: vi.fn(),
  signInAdministrator: vi.fn(),
  verifyAdministrator: vi.fn(),
  verifyPhone: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
}));

vi.mock("@/access/actions", () => ({
  completePhoneAccess: completePhone,
  requestPhoneAccess: requestPhone,
  signInPlatformAdministrator: signInAdministrator,
  verifyPhoneAccess: verifyPhone,
  verifyPlatformAdministratorMfa: verifyAdministrator,
}));

import { AdministratorAccessForm } from "./administrator-access-form";
import { PhoneAccessForm } from "./phone-access-form";

describe("access forms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restores owned focus to the next local access step without reclaiming departed focus", async () => {
    let resolveRequest!: (value: {
      status: "code_sent" | "invalid_phone";
    }) => void;
    requestPhone.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const user = userEvent.setup();
    const phoneView = render(<PhoneAccessForm locale="en" />);

    const phone = screen.getByLabelText("Iraqi phone number");
    expect(phone).not.toHaveFocus();
    await user.type(phone, "+9647500000000");
    const send = screen.getByRole("button", {
      name: "Send verification code",
    });
    await user.click(send);
    expect(send).toBeDisabled();

    await act(async () => resolveRequest({ status: "invalid_phone" }));
    expect(send).toHaveFocus();
    await user.click(send);
    await act(async () => resolveRequest({ status: "code_sent" }));

    expect(send).not.toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toHaveFocus();
    phoneView.unmount();

    const departedView = render(<PhoneAccessForm locale="en" />);
    const departedPhone = screen.getByLabelText("Iraqi phone number");
    await user.type(departedPhone, "+9647500000000");
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await user.click(departedPhone);
    expect(departedPhone).toHaveFocus();
    await act(async () => resolveRequest({ status: "code_sent" }));
    expect(departedPhone).not.toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).not.toHaveFocus();
    expect(document.body).toHaveFocus();
    departedView.unmount();

    requestPhone.mockResolvedValue({ status: "code_sent" });
    let resolveVerification!: (value: { status: "authenticated" }) => void;
    let resolveCompletion!: (value: { status: "unavailable" }) => void;
    verifyPhone.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVerification = resolve;
        }),
    );
    completePhone.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCompletion = resolve;
        }),
    );
    for (const depart of [false, true]) {
      const completionView = render(
        <PhoneAccessForm locale="en" returnTo="/en/bookings" />,
      );
      await user.type(
        screen.getByLabelText("Iraqi phone number"),
        "+9647500000000",
      );
      await user.click(
        screen.getByRole("button", { name: "Send verification code" }),
      );
      const codeInput = screen.getByLabelText("Verification code");
      await user.type(codeInput, "123456");
      const verify = screen.getByRole("button", { name: "Verify" });
      await user.click(verify);
      if (depart) await user.click(codeInput);
      await act(async () => resolveVerification({ status: "authenticated" }));
      expect(codeInput).not.toBeInTheDocument();
      expect(verify).not.toBeInTheDocument();
      expect(completePhone).toHaveBeenLastCalledWith("en", "/en/bookings");
      await act(async () => resolveCompletion({ status: "unavailable" }));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Verification is unavailable. Try again.",
      );
      if (depart) {
        expect(screen.getByLabelText("Verification code")).not.toHaveFocus();
        expect(document.body).toHaveFocus();
      } else {
        expect(screen.getByLabelText("Verification code")).toHaveFocus();
      }
      completionView.unmount();
    }

    let resolveSignIn!: (value: {
      status: "challenge_required";
      factorId: string;
      challengeId: string;
    }) => void;
    let resolveMfa!: (value: {
      status: "challenge_expired" | "authenticated";
    }) => void;
    signInAdministrator.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    verifyAdministrator.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMfa = resolve;
        }),
    );
    render(<AdministratorAccessForm locale="en" />);
    const email = screen.getByLabelText("Email");
    expect(email).not.toHaveFocus();
    await user.type(email, "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    for (const status of ["challenge_expired", "authenticated"] as const) {
      const continueButton = screen.getByRole("button", { name: "Continue" });
      await user.click(continueButton);
      await act(async () =>
        resolveSignIn({
          status: "challenge_required",
          factorId: "factor-1",
          challengeId: "challenge-1",
        }),
      );
      expect(continueButton).not.toBeInTheDocument();
      const authenticatorCode = screen.getByLabelText("Authenticator app code");
      expect(authenticatorCode).toHaveFocus();
      await user.type(authenticatorCode, "123456");
      await user.click(screen.getByRole("button", { name: "Verify" }));
      await act(async () => resolveMfa({ status }));
      expect(authenticatorCode).not.toBeInTheDocument();
      if (status === "challenge_expired") {
        expect(screen.getByLabelText("Email")).toHaveFocus();
      } else {
        expect(screen.getByRole("status")).toHaveFocus();
      }
    }
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(["ar", "ckb"] as const)(
    "keeps the %s phone-format example left to right",
    (locale) => {
      render(<PhoneAccessForm locale={locale} />);
      expect(
        screen.getByText("+9647501234567", { selector: "bdi" }),
      ).toHaveAttribute("dir", "ltr");
    },
  );

  it("suppresses repeated phone access requests while preserving result mapping", async () => {
    let resolveRequest!: (value: { status: "invalid_phone" }) => void;
    requestPhone.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    render(<PhoneAccessForm locale="en" />);

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
    render(<PhoneAccessForm locale="en" />);

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

  it("shows a retryable error when requesting a code loses its connection", async () => {
    requestPhone.mockRejectedValue(new Error("connection interrupted"));
    const user = userEvent.setup();
    render(<PhoneAccessForm locale="en" />);
    await user.type(
      screen.getByLabelText("Iraqi phone number"),
      "+9647500000000",
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Verification is unavailable. Try again.",
    );
    expect(
      screen.getByRole("button", { name: "Send verification code" }),
    ).toBeEnabled();
  });

  it("preserves the return destination and supports code expiry, resend and editing the number", async () => {
    requestPhone.mockResolvedValue({ status: "code_sent" });
    verifyPhone.mockResolvedValue({ status: "expired_code" });
    const user = userEvent.setup();
    render(<PhoneAccessForm locale="en" returnTo="/en/bookings" />);
    await user.type(
      screen.getByLabelText("Iraqi phone number"),
      "+9647500000000",
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    expect(screen.getByLabelText("Verification code")).toHaveAttribute(
      "dir",
      "ltr",
    );
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(verifyPhone).toHaveBeenCalledWith({
      phone: "+9647500000000",
      code: "123456",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The code has expired or is invalid.",
    );
    await user.click(screen.getByRole("button", { name: "Send another code" }));
    expect(requestPhone).toHaveBeenCalledTimes(2);
    await user.click(
      screen.getByRole("button", { name: "Change phone number" }),
    );
    expect(screen.getByLabelText("Iraqi phone number")).toHaveValue(
      "+9647500000000",
    );
  });

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

  it.each(["Email", "Password"])(
    "submits administrator credentials once with Enter in the %s field",
    async (field) => {
      signInAdministrator.mockResolvedValue({ status: "invalid_sign_in" });
      const submitSpy = vi.fn();
      document.addEventListener("submit", submitSpy);
      try {
        const user = userEvent.setup();
        render(<AdministratorAccessForm locale="en" />);

        await user.type(screen.getByLabelText("Email"), "admin@example.com");
        await user.type(screen.getByLabelText("Password"), "password");
        await user.click(screen.getByLabelText(field));
        await user.keyboard("{Enter}");

        expect(signInAdministrator).toHaveBeenCalledTimes(1);
        expect(signInAdministrator).toHaveBeenCalledWith({
          email: "admin@example.com",
          password: "password",
        });
        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(submitSpy.mock.calls[0][0].defaultPrevented).toBe(true);
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "The sign-in is invalid or this is not an administrator account.",
        );
      } finally {
        document.removeEventListener("submit", submitSpy);
      }
    },
  );

  it("keeps a malformed administrator email on the existing sign-in error path with Enter", async () => {
    signInAdministrator.mockResolvedValue({ status: "invalid_sign_in" });
    const user = userEvent.setup();
    render(<AdministratorAccessForm locale="en" />);

    await user.type(screen.getByLabelText("Email"), "admin");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.keyboard("{Enter}");

    expect(signInAdministrator).toHaveBeenCalledTimes(1);
    expect(signInAdministrator).toHaveBeenCalledWith({
      email: "admin",
      password: "password",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The sign-in is invalid or this is not an administrator account.",
    );
  });

  it("runs one administrator sign-in for a burst of Enter and click", async () => {
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
    const continueButton = screen.getByRole("button", { name: "Continue" });
    const form = continueButton.closest("form")!;
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
      continueButton.click();
    });

    expect(signInAdministrator).toHaveBeenCalledTimes(1);
    expect(continueButton).toBeDisabled();
    expect(continueButton).toHaveAttribute("aria-busy", "true");

    await act(async () => resolveSignIn({ status: "invalid_sign_in" }));

    expect(continueButton).toBeEnabled();
  });

  it("keeps administrator credentials and codes out of native form submissions", async () => {
    signInAdministrator.mockResolvedValue({
      status: "challenge_required",
      factorId: "factor-1",
      challengeId: "challenge-1",
    });
    const user = userEvent.setup();
    render(<AdministratorAccessForm locale="en" />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect([...new FormData(continueButton.closest("form")!).keys()]).toEqual(
      [],
    );

    await user.click(continueButton);
    await user.type(
      await screen.findByLabelText("Authenticator app code"),
      "123456",
    );
    const verifyForm = screen
      .getByRole("button", { name: "Verify" })
      .closest("form")!;
    expect([...new FormData(verifyForm).keys()]).toEqual([]);
  });

  it.each([
    [
      "challenge",
      {
        status: "challenge_required",
        factorId: "factor-1",
        challengeId: "challenge-1",
      },
    ],
    [
      "enrollment",
      {
        status: "enrollment_required",
        factorId: "factor-1",
        challengeId: "challenge-1",
        qrCode:
          'data:image/svg+xml;utf-8,<?xml version="1.0"?>\n<svg width="21" height="21" xmlns="http://www.w3.org/2000/svg"></svg>\n',
        secret: "SECRET",
      },
    ],
  ])(
    "submits the %s administrator MFA step once with Enter in the code field",
    async (name, signInResult) => {
      signInAdministrator.mockResolvedValue(signInResult);
      verifyAdministrator.mockResolvedValue({ status: "invalid_code" });
      const submitSpy = vi.fn();
      const user = userEvent.setup();
      render(<AdministratorAccessForm locale="en" />);

      await user.type(screen.getByLabelText("Email"), "admin@example.com");
      await user.type(screen.getByLabelText("Password"), "password");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      const codeField = await screen.findByLabelText("Authenticator app code");
      if (name === "enrollment") {
        expect(screen.getByTestId("mfa-secret")).toHaveTextContent("SECRET");
        expect(
          screen.getByRole("img", { name: "Authenticator app setup code" }),
        ).toBeInTheDocument();
      }

      document.addEventListener("submit", submitSpy);
      try {
        await user.type(codeField, "123456");
        await user.keyboard("{Enter}");

        expect(verifyAdministrator).toHaveBeenCalledTimes(1);
        expect(verifyAdministrator).toHaveBeenCalledWith({
          factorId: "factor-1",
          challengeId: "challenge-1",
          code: "123456",
        });
        expect(signInAdministrator).toHaveBeenCalledTimes(1);
        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(submitSpy.mock.calls[0][0].defaultPrevented).toBe(true);
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "The verification code could not be confirmed.",
        );
        expect(screen.getByLabelText("Authenticator app code")).toBeVisible();
        expect(replace).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener("submit", submitSpy);
      }
    },
  );

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
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("runs one administrator verification for a burst of Enter and click", async () => {
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
    await user.type(
      await screen.findByLabelText("Authenticator app code"),
      "123456",
    );
    const verify = screen.getByRole("button", { name: "Verify" });
    const form = verify.closest("form")!;
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
      verify.click();
    });

    expect(verifyAdministrator).toHaveBeenCalledTimes(1);
    expect(verify).toBeDisabled();
    expect(verify).toHaveAttribute("aria-busy", "true");

    await act(async () => resolveVerification({ status: "invalid_code" }));

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
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
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
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("replaces the route with the exact queue only after authenticated MFA", async () => {
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
        returnTo="/en/administrator/reviews"
      />,
    );

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(replace).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Authenticator app code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(replace).toHaveBeenCalledWith("/en/administrator/reviews");
    expect(refresh).toHaveBeenCalledOnce();
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(
      refresh.mock.invocationCallOrder[0],
    );
  });

  it("defensively rejects an unsafe administrator return after authenticated MFA", async () => {
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
        returnTo="/ar/administrator/reviews"
        reviewHref="/en/administrator/owner-applications"
      />,
    );

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Authenticator app code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", {
        name: "Review submitted Owner Applications",
      }),
    ).toHaveAttribute("href", "/en/administrator/owner-applications");
  });

  it("reports an identity mismatch as unavailable after phone verification", async () => {
    requestPhone.mockResolvedValue({ status: "code_sent" });
    verifyPhone.mockResolvedValue({ status: "not_authorized" });
    const user = userEvent.setup();
    render(<PhoneAccessForm locale="en" />);

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

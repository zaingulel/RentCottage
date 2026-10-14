import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/access/actions", () => ({ saveAccountName: vi.fn() }));

import { AccountNameGate } from "./account-name-gate";

function DraftPage() {
  const [draft, setDraft] = useState("");
  return (
    <main>
      <label>
        Draft
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
    </main>
  );
}

describe("first-name gate", () => {
  it("shows only the step while the first name is missing", () => {
    render(
      <AccountNameGate locale="en" missing>
        <p>Page content</p>
      </AccountNameGate>,
    );

    expect(
      screen.getByRole("heading", { name: "Add your first name" }),
    ).toBeVisible();
    expect(screen.getByLabelText("First name")).toBeVisible();
    const page = screen.getByText("Page content");
    expect(page).toBeInTheDocument();
    expect(page).not.toBeVisible();
  });

  it("keeps the page's state while the first-name step shows", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AccountNameGate locale="en" missing={false}>
        <DraftPage />
      </AccountNameGate>,
    );
    expect(
      screen.queryByRole("heading", { name: "Add your first name" }),
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Draft"), "Kept");

    await act(async () =>
      rerender(
        <AccountNameGate locale="en" missing>
          <DraftPage />
        </AccountNameGate>,
      ),
    );
    expect(
      screen.getByRole("heading", { name: "Add your first name" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Draft")).not.toBeVisible();

    await act(async () =>
      rerender(
        <AccountNameGate locale="en" missing={false}>
          <DraftPage />
        </AccountNameGate>,
      ),
    );
    expect(
      screen.queryByRole("heading", { name: "Add your first name" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Draft")).toBeVisible();
    expect(screen.getByLabelText("Draft")).toHaveValue("Kept");
  });
});

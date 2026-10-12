import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ActionButton,
  ActionFocusTarget,
  prepareActionFocusNavigation,
  ActionFeedback,
  ActionLink,
  ChoiceControl,
  Disclosure,
  FormControl,
  OptionGroup,
} from "./interaction-controls";

describe("shared interaction controls", () => {
  it("renders each action as its native accessible interface", () => {
    const onToggle = vi.fn();

    render(
      <>
        <ActionButton kind="primary" width="full" type="submit" pending>
          Continue
        </ActionButton>
        <ActionButton kind="secondary" size="compact" type="button">
          Decrease guests
        </ActionButton>
        <ActionButton
          kind="toggle"
          size="regular"
          type="button"
          pressed
          onClick={onToggle}
        >
          Pool
        </ActionButton>
        <ActionLink kind="primary" width="content" href="/en/results">
          Results
        </ActionLink>
        <ActionLink kind="text" href="/en">
          Back
        </ActionLink>
      </>,
    );

    expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Decrease guests" }),
    ).not.toHaveAttribute("aria-pressed");
    expect(
      screen.getByRole("button", { name: "Decrease guests" }),
    ).not.toHaveAttribute("size");
    expect(screen.getByRole("button", { name: "Pool" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("link", { name: "Results" })).toHaveAttribute(
      "href",
      "/en/results",
    );
    expect(screen.getByRole("link", { name: "Results" })).not.toHaveAttribute(
      "width",
    );
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/en",
    );
  });

  it("keeps form controls native and feedback explicit without colour alone", () => {
    render(
      <>
        <FormControl kind="input" aria-label="Full name" name="name" />
        <FormControl kind="select" aria-label="Area" defaultValue="all">
          <option value="all">All areas</option>
        </FormControl>
        <FormControl kind="textarea" aria-label="Note" rows={4} />
        <FormControl
          kind="input"
          type="file"
          aria-label="Evidence"
          accept="application/pdf"
        />
        <ActionFeedback kind="success">Saved</ActionFeedback>
        <ActionFeedback kind="error">Could not save</ActionFeedback>
      </>,
    );

    expect(screen.getByRole("textbox", { name: "Full name" })).toHaveProperty(
      "tagName",
      "INPUT",
    );
    expect(screen.getByRole("combobox", { name: "Area" })).toHaveProperty(
      "tagName",
      "SELECT",
    );
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty(
      "tagName",
      "TEXTAREA",
    );
    expect(screen.getByLabelText("Evidence")).toHaveAttribute("type", "file");
    expect(screen.getByRole("status")).toHaveTextContent("✓ Saved");
    expect(screen.getByRole("alert")).toHaveTextContent("! Could not save");
  });

  it("renders choices, option groups and disclosures as native named controls", () => {
    const { container } = render(
      <>
        <OptionGroup legend="Amenities" layout="wrap">
          <ChoiceControl kind="checkbox" name="amenity" defaultChecked>
            Pool
          </ChoiceControl>
        </OptionGroup>
        <OptionGroup legend="Enquiry" layout="stack">
          <ChoiceControl
            kind="radio"
            name="enquiry"
            value="dates"
            defaultChecked
          >
            Specific dates
          </ChoiceControl>
          <ChoiceControl kind="radio" name="enquiry" value="flexible">
            Flexible dates
          </ChoiceControl>
        </OptionGroup>
        <Disclosure summary="Filters">
          <p>Filter options</p>
        </Disclosure>
      </>,
    );

    const amenities = screen.getByRole("group", { name: "Amenities" });
    expect(amenities).toHaveProperty("tagName", "FIELDSET");
    expect(amenities).toHaveClass("option-group", "option-group-wrap");
    expect(screen.getByRole("group", { name: "Enquiry" })).toHaveClass(
      "option-group",
      "option-group-stack",
    );

    const pool = screen.getByRole("checkbox", { name: "Pool" });
    expect(pool).toHaveAttribute("type", "checkbox");
    expect(pool).toBeChecked();

    const specific = screen.getByRole("radio", { name: "Specific dates" });
    const flexible = screen.getByRole("radio", { name: "Flexible dates" });
    expect(specific).toHaveAttribute("type", "radio");
    expect(flexible).toHaveAttribute("type", "radio");
    expect(specific).toHaveAttribute("name", "enquiry");
    expect(flexible).toHaveAttribute("name", "enquiry");
    expect(specific).toBeChecked();
    expect(flexible).not.toBeChecked();

    for (const input of [pool, specific, flexible]) {
      expect(input.closest("label")).toHaveClass("choice-control");
    }

    expect(
      container.querySelector("details.disclosure > summary"),
    ).toHaveTextContent("Filters");
  });
});

it("returns owned focus to an explicit enabled successor without reclaiming departure", () => {
  const view = (pending: boolean, disabled: boolean, elsewhere: boolean) => (
    <>
      <ActionButton
        id="owned-source"
        kind="primary"
        width="content"
        pending={pending}
        disabled={disabled}
        focusSuccessorId="owned-result"
      >
        Save
      </ActionButton>
      <h2 id="owned-result" tabIndex={-1}>
        Result
      </h2>
      {!pending && <ActionFocusTarget targetId="owned-result" />}
      {elsewhere && <input aria-label="Elsewhere" />}
    </>
  );
  const { rerender } = render(view(false, false, true));
  const source = screen.getByRole("button", { name: "Save" });
  source.focus();
  fireEvent.click(source);
  rerender(view(true, false, true));
  source.blur();
  rerender(view(false, true, true));
  expect(screen.getByRole("heading", { name: "Result" })).toHaveFocus();

  rerender(view(false, false, true));
  source.focus();
  fireEvent.click(source);
  rerender(view(true, false, true));
  screen.getByRole("textbox", { name: "Elsewhere" }).focus();
  rerender(view(false, false, false));
  expect(source).not.toHaveFocus();
  expect(screen.getByRole("heading", { name: "Result" })).not.toHaveFocus();
});

it("composes React button refs and cleanup while preserving caller handlers and form attributes", () => {
  const objectRef = createRef<HTMLButtonElement>();
  const cleanup = vi.fn();
  const plainCallbackRef = vi.fn<(node: HTMLButtonElement | null) => void>();
  const callbackRef = vi.fn((node: HTMLButtonElement | null) => {
    if (node) return cleanup;
  });
  const calls: string[] = [];
  const { rerender, unmount } = render(
    <>
      <ActionButton
        kind="primary"
        width="full"
        ref={objectRef}
        name="intent"
        value="save"
        form="form-id"
        formNoValidate
        onClickCapture={() => calls.push("capture")}
        onClick={() => calls.push("click")}
      >
        Save ref
      </ActionButton>
      <ActionButton
        kind="toggle"
        size="regular"
        pressed={false}
        ref={callbackRef}
      >
        Toggle ref
      </ActionButton>
      <ActionButton kind="secondary" size="regular" ref={plainCallbackRef}>
        Plain callback ref
      </ActionButton>
    </>,
  );
  const source = screen.getByRole("button", { name: "Save ref" });
  expect(objectRef.current).toBe(source);
  expect(source).not.toHaveAttribute("type");
  expect(source).toHaveAttribute("name", "intent");
  expect(source).toHaveAttribute("value", "save");
  expect(source).toHaveAttribute("form", "form-id");
  expect(source).toHaveAttribute("formnovalidate");
  source.focus();
  fireEvent.click(source);
  expect(calls).toEqual(["capture", "click"]);
  expect(callbackRef).toHaveBeenCalledTimes(1);
  expect(callbackRef).toHaveBeenCalledWith(
    screen.getByRole("button", { name: "Toggle ref" }),
  );
  rerender(
    <ActionButton kind="primary" width="content" ref={objectRef}>
      Save ref
    </ActionButton>,
  );
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(callbackRef).toHaveBeenCalledTimes(1);
  expect(plainCallbackRef).toHaveBeenCalledTimes(2);
  expect(plainCallbackRef).toHaveBeenLastCalledWith(null);
  unmount();
  expect(objectRef.current).toBeNull();
});

it("hands focus only to a requested navigation and binds abort to its source intent", () => {
  let abort = () => {};
  const origin = window.location.pathname;
  const view = (
    stage: "source" | "interim" | "destination",
    marker = "destination",
    pending = false,
    transfer = true,
  ) => (
    <>
      {stage === "source" && (
        <ActionButton
          id="navigate-source"
          kind="secondary"
          size="regular"
          focusSuccessorId="local-step"
          pending={pending}
          onClick={() => {
            if (transfer)
              abort = prepareActionFocusNavigation("navigate-source");
          }}
        >
          Navigate
        </ActionButton>
      )}
      {stage !== "interim" && (
        <h2 id="local-step" tabIndex={-1}>
          Local step
        </h2>
      )}
      <h1 id="destination" tabIndex={-1}>
        Destination
      </h1>
      <ActionFocusTarget targetId="local-step" />
      <ActionFocusTarget targetId={marker} navigation />
    </>
  );
  const { rerender } = render(view("source"));
  const source = screen.getByRole("button", { name: "Navigate" });
  expect(
    screen.getByRole("heading", { name: "Destination" }),
  ).not.toHaveFocus();
  source.focus();
  fireEvent.click(source);
  rerender(view("interim"));
  expect(
    screen.getByRole("heading", { name: "Destination" }),
  ).not.toHaveFocus();
  abort();
  rerender(view("destination"));
  expect(screen.getByRole("heading", { name: "Local step" })).toHaveFocus();

  rerender(view("source"));
  const newer = screen.getByRole("button", { name: "Navigate" });
  newer.focus();
  fireEvent.click(newer);
  const oldAbort = abort;
  fireEvent.click(newer);
  oldAbort();
  window.history.replaceState(null, "", "/navigation-destination");
  rerender(view("destination"));
  expect(screen.getByRole("heading", { name: "Destination" })).toHaveFocus();
  window.history.replaceState(null, "", origin);
  rerender(view("source", "destination", false, false));
  const retained = screen.getByRole("button", { name: "Navigate" });
  retained.focus();
  fireEvent.click(retained);
  retained.blur();
  rerender(view("source", "destination", true, false));
  rerender(view("source", "destination", false, false));
  expect(retained).toHaveFocus();
  prepareActionFocusNavigation("navigate-source");
  window.history.replaceState(null, "", "/late-navigation");
  rerender(view("destination"));
  expect(screen.getByRole("heading", { name: "Destination" })).toHaveFocus();
  window.history.replaceState(null, "", origin);
});

it("captures focused keyboard activation before a caller immediately removes the source", () => {
  const keyCapture = vi.fn();
  const { rerender } = render(
    <>
      <ActionButton
        kind="toggle"
        size="regular"
        pressed={false}
        focusSuccessorId="keyboard-step"
        onKeyDownCapture={keyCapture}
        onKeyDown={() =>
          rerender(
            <>
              <h2 id="keyboard-step" tabIndex={-1}>
                Next step
              </h2>
              <ActionFocusTarget targetId="keyboard-step" />
            </>,
          )
        }
      >
        Continue keyboard
      </ActionButton>
    </>,
  );
  const source = screen.getByRole("button", { name: "Continue keyboard" });
  source.focus();
  fireEvent.keyDown(source, { key: "Enter" });
  expect(keyCapture).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("heading", { name: "Next step" })).toHaveFocus();
});

it("ignores unowned busy controls and unavailable targets during initial and ordinary navigation", () => {
  const origin = window.location.pathname;
  const view = (
    pending: boolean,
    sourceVisible = true,
    targetDisabled = false,
  ) => (
    <>
      <input aria-label="Unowned elsewhere" />
      {sourceVisible && (
        <ActionButton
          id="unowned-source"
          kind="secondary"
          size="regular"
          pending={pending}
          focusSuccessorId={
            targetDisabled ? "disabled-target" : "missing-local"
          }
        >
          Unowned source
        </ActionButton>
      )}
      <fieldset disabled={targetDisabled}>
        <input id="disabled-target" aria-label="Disabled target" />
      </fieldset>
      <h1 id="ordinary-destination" tabIndex={-1}>
        Ordinary destination
      </h1>
      <ActionFocusTarget targetId="missing-local" />
      <ActionFocusTarget targetId="disabled-target" />
      <ActionFocusTarget targetId="ordinary-destination" navigation />
    </>
  );
  const { rerender } = render(view(false));
  const elsewhere = screen.getByRole("textbox", { name: "Unowned elsewhere" });
  elsewhere.focus();
  rerender(view(true));
  expect(elsewhere).toHaveFocus();
  window.history.replaceState(null, "", "/ordinary-destination");
  rerender(view(false));
  expect(elsewhere).toHaveFocus();
  expect(
    screen.getByRole("heading", { name: "Ordinary destination" }),
  ).not.toHaveFocus();
  const source = screen.getByRole("button", { name: "Unowned source" });
  source.focus();
  fireEvent.click(source);
  prepareActionFocusNavigation("different-source");
  rerender(view(true));
  source.blur();
  rerender(view(false, false, true));
  expect(
    screen.getByRole("heading", { name: "Ordinary destination" }),
  ).not.toHaveFocus();
  expect(
    screen.getByRole("textbox", { name: "Disabled target" }),
  ).not.toHaveFocus();
  rerender(view(false, true, true));
  const nextSource = screen.getByRole("button", { name: "Unowned source" });
  nextSource.focus();
  fireEvent.click(nextSource);
  rerender(view(false, false, true));
  expect(
    screen.getByRole("textbox", { name: "Disabled target" }),
  ).not.toHaveFocus();
  rerender(view(false, false, false));
  expect(
    screen.getByRole("textbox", { name: "Disabled target" }),
  ).toHaveFocus();
  window.history.replaceState(null, "", origin);
});

it("permanently cancels focus ownership on every departure signal even after that target disappears", () => {
  const view = (pending: boolean, elsewhere = true) => (
    <>
      <ActionButton
        id="cancel-source"
        kind="primary"
        width="content"
        pending={pending}
        focusSuccessorId="cancel-successor"
      >
        Cancel source
      </ActionButton>
      <h2 id="cancel-successor" tabIndex={-1}>
        Cancel successor
      </h2>
      <ActionFocusTarget targetId="cancel-successor" />
      {elsewhere && <input aria-label="Cancel elsewhere" />}
    </>
  );
  const { rerender } = render(view(false));
  for (const signal of [
    "focusin",
    "Tab",
    "pointerdown",
    "popstate",
    "blur",
    "pagehide",
  ]) {
    rerender(view(false));
    const source = screen.getByRole("button", { name: "Cancel source" });
    source.focus();
    fireEvent.click(source);
    const abort = prepareActionFocusNavigation("cancel-source");
    // jsdom cannot blur disabled controls; the browser case observes native focus loss.
    source.blur();
    rerender(view(true));
    const elsewhere = screen.getByRole("textbox", { name: "Cancel elsewhere" });
    if (signal === "focusin") elsewhere.focus();
    else if (signal === "Tab") fireEvent.keyDown(document, { key: "Tab" });
    else if (signal === "pointerdown") fireEvent.pointerDown(elsewhere);
    else window.dispatchEvent(new Event(signal));
    rerender(view(false, false));
    abort();
    expect(source, signal).not.toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "Cancel successor" }),
    ).not.toHaveFocus();
  }
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ActionButton,
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

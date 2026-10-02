import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CottageLocationFields } from "./cottage-location-fields";

const confirmation = "I checked this point is the cottage";

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("Cottage location fields", () => {
  it.each([
    ["en", "within the supported area", "No map is connected"],
    ["ar", "ضمن المنطقة المدعومة", "لا توجد خريطة متصلة"],
    ["ckb", "لە ناو ناوچەی پشتگیریکراودان", "هیچ نەخشەیەک نەبەستراوەتەوە"],
  ] as const)(
    "reads a valid point back in words in %s",
    (locale, withinArea, noMap) => {
      render(
        <CottageLocationFields
          locale={locale}
          savedLatitude={36.408333}
          savedLongitude={44.385834}
        />,
      );

      const readBack = screen.getByRole("status");
      expect(readBack).toHaveTextContent(withinArea);
      expect(readBack).toHaveTextContent(noMap);
      expect(readBack).toHaveTextContent("36.408333");
      expect(readBack).toHaveTextContent("44.385834");
    },
  );

  it("states the entered point in words", () => {
    render(
      <CottageLocationFields
        locale="en"
        savedLatitude={null}
        savedLongitude={null}
      />,
    );

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    type("Latitude", "36.408333");
    type("Longitude", "44.385834");

    expect(
      screen.getByRole("status", { name: "Exact point check" }),
    ).toHaveTextContent(
      "Latitude 36.408333 north, longitude 44.385834 east. These numbers are within the supported area. No map is connected, so check them against the pin in your own maps app.",
    );
  });

  it("offers to swap a reversed pair and swaps only when asked", () => {
    render(
      <CottageLocationFields
        locale="en"
        savedLatitude={null}
        savedLongitude={null}
      />,
    );
    type("Latitude", "44.385834");
    type("Longitude", "36.408333");

    const swap = screen.getByRole("button", { name: "Swap the two numbers" });
    expect(screen.getByRole("status")).toHaveTextContent("look reversed");
    expect(screen.getByLabelText("Latitude")).toHaveValue("44.385834");
    expect(screen.getByLabelText("Longitude")).toHaveValue("36.408333");
    expect(screen.queryByLabelText(confirmation)).toBeNull();

    fireEvent.click(swap);

    expect(screen.getByLabelText("Latitude")).toHaveValue("36.408333");
    expect(screen.getByLabelText("Longitude")).toHaveValue("44.385834");
    expect(
      screen.queryByRole("button", { name: "Swap the two numbers" }),
    ).toBeNull();
    expect(screen.getByLabelText(confirmation)).not.toBeChecked();
  });

  it("starts confirmed for an unchanged saved point and unticks when either box is edited", () => {
    render(
      <CottageLocationFields
        locale="en"
        savedLatitude={36.408333}
        savedLongitude={44.385834}
      />,
    );
    expect(screen.getByLabelText(confirmation)).toBeChecked();

    type("Longitude", "44.4");
    expect(screen.getByLabelText(confirmation)).not.toBeChecked();

    fireEvent.click(screen.getByLabelText(confirmation));
    expect(screen.getByLabelText(confirmation)).toBeChecked();

    type("Latitude", "36.5");
    expect(screen.getByLabelText(confirmation)).not.toBeChecked();
  });

  it("requires the confirmation for a valid reading and omits it otherwise", () => {
    render(
      <CottageLocationFields
        locale="en"
        savedLatitude={null}
        savedLongitude={null}
      />,
    );
    expect(screen.queryByLabelText(confirmation)).toBeNull();

    type("Latitude", "36.408333");
    expect(screen.queryByLabelText(confirmation)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "such as 36.408333 and 44.385834",
    );

    type("Longitude", "44.385834");
    expect(screen.getByLabelText(confirmation)).toBeRequired();
    expect(screen.getByLabelText(confirmation)).not.toBeChecked();

    type("Longitude", "51.5");
    expect(screen.queryByLabelText(confirmation)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "outside the supported area (latitude 29.0 to 37.4, longitude 38.7 to 49.2)",
    );
  });
});

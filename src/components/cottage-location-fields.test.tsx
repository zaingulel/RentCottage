import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CottageLocationFields } from "./cottage-location-fields";

const confirmation = "I checked this point is the cottage";

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const deviceButton = "Use this device's location";
const proposal = (metres: number) =>
  `This is where this device is now, accurate to about ${metres} metres. It may be your home, not the cottage. Check the numbers before confirming.`;
const roughReading =
  "This reading is rough. Type the numbers from a maps app instead if you can.";

function replaceGeolocation(
  getCurrentPosition: Geolocation["getCurrentPosition"],
) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
}

function positionAccurateTo(accuracy: number) {
  return vi.fn<Geolocation["getCurrentPosition"]>((succeed) =>
    succeed({
      coords: { latitude: 36.4083334, longitude: 44.3858336, accuracy },
    } as GeolocationPosition),
  );
}

function renderEmpty() {
  render(
    <CottageLocationFields
      locale="en"
      savedLatitude={null}
      savedLongitude={null}
    />,
  );
}

function deviceStatus() {
  return screen.getByRole("status", { name: "Device location" });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "geolocation");
});

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

  it("asks for the device location only when the button is pressed", () => {
    const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>();
    replaceGeolocation(getCurrentPosition);
    renderEmpty();
    type("Latitude", "36.408333");

    expect(getCurrentPosition).toHaveBeenCalledTimes(0);
    expect(
      screen.queryByRole("status", { name: "Device location" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: deviceButton }));

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });
    expect(deviceStatus()).toHaveTextContent("Finding this device's location…");
  });

  it("fills both boxes with the device location as an unconfirmed proposal", () => {
    replaceGeolocation(positionAccurateTo(12.4));
    render(
      <CottageLocationFields
        locale="en"
        savedLatitude={36.1}
        savedLongitude={44.1}
      />,
    );
    expect(screen.getByLabelText(confirmation)).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: deviceButton }));

    expect(screen.getByLabelText("Latitude")).toHaveValue("36.408333");
    expect(screen.getByLabelText("Longitude")).toHaveValue("44.385834");
    expect(screen.getByLabelText(confirmation)).not.toBeChecked();
    expect(deviceStatus()).toHaveTextContent(proposal(12));
    expect(
      screen.getByRole("status", { name: "Exact point check" }),
    ).toHaveTextContent("Latitude 36.408333 north, longitude 44.385834 east.");

    type("Latitude", "36.5");
    expect(
      screen.queryByRole("status", { name: "Device location" }),
    ).toBeNull();
  });

  it.each([
    [100, false],
    [101, true],
  ])("calls a reading accurate to %i metres rough: %s", (accuracy, rough) => {
    replaceGeolocation(positionAccurateTo(accuracy));
    renderEmpty();

    fireEvent.click(screen.getByRole("button", { name: deviceButton }));

    expect(deviceStatus()).toHaveTextContent(
      rough ? `${proposal(accuracy)} ${roughReading}` : proposal(accuracy),
    );
    if (!rough) expect(deviceStatus()).not.toHaveTextContent(roughReading);
  });

  it.each([
    [
      1,
      "Location permission was refused. You can still type or paste the numbers.",
    ],
    [
      2,
      "This device could not find its location. You can still type or paste the numbers.",
    ],
    [
      3,
      "Finding the location took too long. Try again outdoors, or type or paste the numbers.",
    ],
  ])(
    "shows the recovery message for geolocation error code %i and keeps typing usable",
    (code, message) => {
      replaceGeolocation((_succeed, fail) =>
        fail?.({ code } as GeolocationPositionError),
      );
      renderEmpty();

      fireEvent.click(screen.getByRole("button", { name: deviceButton }));

      expect(deviceStatus()).toHaveTextContent(message);
      expect(screen.getByLabelText("Latitude")).toBeEnabled();
      expect(screen.getByLabelText("Longitude")).toBeEnabled();
      expect(screen.getByRole("button", { name: deviceButton })).toBeEnabled();
    },
  );

  it("says the browser cannot share its location when geolocation is absent", () => {
    expect("geolocation" in navigator).toBe(false);
    renderEmpty();

    fireEvent.click(screen.getByRole("button", { name: deviceButton }));

    expect(deviceStatus()).toHaveTextContent(
      "This browser cannot share its location. Type or paste the numbers.",
    );
    expect(screen.getByLabelText("Latitude")).toBeEnabled();
    expect(screen.getByLabelText("Longitude")).toBeEnabled();
  });

  it("discards the success of an abandoned request the owner typed over", () => {
    const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>();
    replaceGeolocation(getCurrentPosition);
    renderEmpty();
    type("Longitude", "44.4");

    fireEvent.click(screen.getByRole("button", { name: deviceButton }));
    type("Latitude", "36.5");
    fireEvent.click(screen.getByLabelText(confirmation));

    expect(
      screen.queryByRole("status", { name: "Device location" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: deviceButton })).toBeEnabled();

    act(() =>
      getCurrentPosition.mock.calls[0][0]({
        coords: { latitude: 36.4083334, longitude: 44.3858336, accuracy: 12 },
      } as GeolocationPosition),
    );

    expect(screen.getByLabelText("Latitude")).toHaveValue("36.5");
    expect(screen.getByLabelText("Longitude")).toHaveValue("44.4");
    expect(screen.getByLabelText(confirmation)).toBeChecked();
    expect(
      screen.queryByRole("status", { name: "Device location" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: deviceButton })).toBeEnabled();
  });

  it("shows no message when an abandoned request the owner typed over fails", () => {
    const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>();
    replaceGeolocation(getCurrentPosition);
    renderEmpty();

    fireEvent.click(screen.getByRole("button", { name: deviceButton }));
    type("Latitude", "36.5");
    act(() =>
      getCurrentPosition.mock.calls[0][1]?.({
        code: 1,
      } as GeolocationPositionError),
    );

    expect(
      screen.queryByRole("status", { name: "Device location" }),
    ).toBeNull();
    expect(screen.queryByText(/Location permission was refused/)).toBeNull();
    expect(screen.getByLabelText("Latitude")).toHaveValue("36.5");
    expect(screen.getByRole("button", { name: deviceButton })).toBeEnabled();
  });

  it("discards the result of a request still in flight when the form is submitted", () => {
    const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>();
    replaceGeolocation(getCurrentPosition);
    render(
      <form aria-label="Cottage profile">
        <CottageLocationFields
          locale="en"
          savedLatitude={null}
          savedLongitude={null}
        />
      </form>,
    );
    type("Latitude", "36.5");
    type("Longitude", "44.4");
    fireEvent.click(screen.getByLabelText(confirmation));

    fireEvent.click(screen.getByRole("button", { name: deviceButton }));
    fireEvent.submit(screen.getByRole("form", { name: "Cottage profile" }));

    expect(
      screen.queryByRole("status", { name: "Device location" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: deviceButton })).toBeEnabled();

    act(() =>
      getCurrentPosition.mock.calls[0][0]({
        coords: { latitude: 36.4083334, longitude: 44.3858336, accuracy: 12 },
      } as GeolocationPosition),
    );

    expect(screen.getByLabelText("Latitude")).toHaveValue("36.5");
    expect(screen.getByLabelText("Longitude")).toHaveValue("44.4");
    expect(screen.getByLabelText(confirmation)).toBeChecked();
    expect(
      screen.queryByRole("status", { name: "Device location" }),
    ).toBeNull();
  });
});

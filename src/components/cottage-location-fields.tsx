"use client";

import { useRef, useState } from "react";

import { readExactPoint, type ExactPoint } from "@/cottage-profile/exact-point";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";

import { ActionButton, FormControl } from "./interaction-controls";

const checkId = "cottage-profile-exact-point-check";

type DeviceLocationFailure =
  | "denied"
  | "unavailable"
  | "timed-out"
  | "unsupported";

type DeviceLocation =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "proposed"; accuracyMetres: number }
  | { kind: "failed"; reason: DeviceLocationFailure };

// The W3C Geolocation specification defines exactly these three error codes.
function failureFor(code: 1 | 2 | 3): DeviceLocationFailure {
  switch (code) {
    case 1:
      return "denied";
    case 2:
      return "unavailable";
    case 3:
      return "timed-out";
  }
}

function deviceLocationMessage(
  copy: (typeof cottageProfileMessages)[Locale],
  deviceLocation: Exclude<DeviceLocation, { kind: "idle" }>,
) {
  if (deviceLocation.kind === "locating") return copy.deviceLocationFinding;
  if (deviceLocation.kind === "proposed") {
    const proposal = copy.deviceLocationProposed.replace(
      "{metres}",
      String(deviceLocation.accuracyMetres),
    );
    return deviceLocation.accuracyMetres > 100
      ? `${proposal} ${copy.deviceLocationRough}`
      : proposal;
  }
  switch (deviceLocation.reason) {
    case "denied":
      return copy.deviceLocationDenied;
    case "unavailable":
      return copy.deviceLocationUnavailable;
    case "timed-out":
      return copy.deviceLocationTimedOut;
    case "unsupported":
      return copy.deviceLocationUnsupported;
  }
}

function PointInWords({
  template,
  point,
}: {
  template: string;
  point: ExactPoint;
}) {
  return template.split(/(\{latitude\}|\{longitude\})/).map((part, index) =>
    part === "{latitude}" || part === "{longitude}" ? (
      <bdi key={index} dir="ltr">
        {part === "{latitude}" ? point.latitude : point.longitude}
      </bdi>
    ) : (
      part
    ),
  );
}

export function CottageLocationFields({
  locale,
  savedLatitude,
  savedLongitude,
}: {
  locale: Locale;
  savedLatitude: number | null;
  savedLongitude: number | null;
}) {
  const copy = cottageProfileMessages[locale];
  const [latitudeText, setLatitudeText] = useState(
    savedLatitude === null ? "" : String(savedLatitude),
  );
  const [longitudeText, setLongitudeText] = useState(
    savedLongitude === null ? "" : String(savedLongitude),
  );
  const [confirmed, setConfirmed] = useState(
    savedLatitude !== null && savedLongitude !== null,
  );
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocation>({
    kind: "idle",
  });
  const latestRequest = useRef(0);
  const reading = readExactPoint(latitudeText, longitudeText);
  const invalid = reading.kind !== "empty" && reading.kind !== "valid";

  // A request in flight when the owner edits is abandoned: its result must not replace what they typed.
  function clearDeviceLocation() {
    latestRequest.current += 1;
    setDeviceLocation({ kind: "idle" });
  }

  function requestDeviceLocation() {
    if (!navigator.geolocation) {
      setDeviceLocation({ kind: "failed", reason: "unsupported" });
      return;
    }
    latestRequest.current += 1;
    const request = latestRequest.current;
    setDeviceLocation({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (request !== latestRequest.current) return;
        setLatitudeText(String(Number(coords.latitude.toFixed(6))));
        setLongitudeText(String(Number(coords.longitude.toFixed(6))));
        setConfirmed(false);
        setDeviceLocation({
          kind: "proposed",
          accuracyMetres: Math.round(coords.accuracy),
        });
      },
      (error) => {
        if (request !== latestRequest.current) return;
        setDeviceLocation({
          kind: "failed",
          reason: failureFor(error.code as 1 | 2 | 3),
        });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  return (
    <div className="exact-point-fields">
      <div className="cottage-profile-coordinate-grid">
        <label>
          {copy.latitude}
          <FormControl
            kind="input"
            name="exactLatitude"
            type="text"
            inputMode="decimal"
            dir="ltr"
            aria-describedby={checkId}
            aria-invalid={invalid || undefined}
            value={latitudeText}
            onChange={(event) => {
              setLatitudeText(event.target.value);
              setConfirmed(false);
              clearDeviceLocation();
            }}
          />
        </label>
        <label>
          {copy.longitude}
          <FormControl
            kind="input"
            name="exactLongitude"
            type="text"
            inputMode="decimal"
            dir="ltr"
            aria-describedby={checkId}
            aria-invalid={invalid || undefined}
            value={longitudeText}
            onChange={(event) => {
              setLongitudeText(event.target.value);
              setConfirmed(false);
              clearDeviceLocation();
            }}
          />
        </label>
      </div>
      <ActionButton
        kind="secondary"
        size="compact"
        type="button"
        pending={deviceLocation.kind === "locating"}
        onClick={requestDeviceLocation}
      >
        {copy.deviceLocationUse}
      </ActionButton>
      {deviceLocation.kind === "idle" ? null : (
        <div
          className="exact-point-check"
          role="status"
          aria-label={copy.deviceLocationStatus}
        >
          <p>{deviceLocationMessage(copy, deviceLocation)}</p>
        </div>
      )}
      <div
        id={checkId}
        className="exact-point-check"
        role="status"
        aria-label={copy.pointCheck}
      >
        {reading.kind === "valid" ? (
          <p>
            <PointInWords template={copy.pointValid} point={reading.point} />
          </p>
        ) : reading.kind === "swapped" ? (
          <p className="field-error">{copy.pointReversed}</p>
        ) : reading.kind === "outside-bounds" ? (
          <p className="field-error">{copy.pointOutside}</p>
        ) : reading.kind === "empty" ? null : (
          <p className="field-error">{copy.pointDecimal}</p>
        )}
      </div>
      {reading.kind === "swapped" ? (
        <ActionButton
          kind="secondary"
          size="compact"
          type="button"
          onClick={() => {
            setLatitudeText(String(reading.corrected.latitude));
            setLongitudeText(String(reading.corrected.longitude));
            setConfirmed(false);
            clearDeviceLocation();
          }}
        >
          {copy.pointSwap}
        </ActionButton>
      ) : null}
      {reading.kind === "valid" ? (
        <label className="exact-point-confirmation">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {copy.pointConfirm}
        </label>
      ) : null}
    </div>
  );
}

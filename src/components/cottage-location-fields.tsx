"use client";

import { useState } from "react";

import { readExactPoint, type ExactPoint } from "@/cottage-profile/exact-point";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";

import { ActionButton, FormControl } from "./interaction-controls";

const checkId = "cottage-profile-exact-point-check";

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
  const reading = readExactPoint(latitudeText, longitudeText);
  const invalid = reading.kind !== "empty" && reading.kind !== "valid";

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
            }}
          />
        </label>
      </div>
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

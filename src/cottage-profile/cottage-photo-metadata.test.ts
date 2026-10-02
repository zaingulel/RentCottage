import { describe, expect, it } from "vitest";

import { removeCottagePhotoMetadata } from "./cottage-photo-metadata";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fromHex = (text: string) => new Uint8Array(Buffer.from(text, "hex"));
const textHex = (text: string) => Buffer.from(text, "latin1").toString("hex");

// A fictional location: Null Island (0N 0E), orientation 6, as a 140-byte big-endian TIFF.
const locatedTiff =
  "4d4d002a00000008000201120003000000010006000088250004000000010000002600000000" +
  "000400010002000000024e00000000020005000000030000005c0003000200000002450000000004000500000003000000740000" +
  "0000" +
  "0000000000000001".repeat(6);

const carriedOrientation = (value: number) =>
  `ffe100224578696600004d4d002a0000000800010112000300000001000${value}000000000000`;

const startOfImage = "ffd8";
const endOfImage = "ffd9";
const jfifApp0 = "ffe000104a46494600010100000100010000";
const locatedExifApp1 = `ffe10094457869660000${locatedTiff}`;
const xmpApp1 = `ffe10039${textHex("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Null Island</x>")}`;
const colourProfileApp2 = `ffe20014${textHex("ICC_PROFILE\0")}0101a1b2c3d4`;
const multiPictureApp2 = `ffe2000a${textHex("MPF\0")}4d4d002a`;
const comment = `fffe001c${textHex("Taken at Null Island 0N 0E")}`;
// A marker may be preceded by fill bytes, which belong to no segment.
const fillByte = "ff";
const quantisationTable = "ffdb00060001ff02";
const frameHeader = "ffc0000b080001000101011100";
const scanHeader = "ffda0008010100003f00";
// Entropy-coded data holding a stuffed FF 00 and a restart marker, neither of which is a segment.
const scanData = "a1ff00b2ffd0c3ff00d4";
const trailingVideo = "000000186674797069736f6dffd8ffd9";

const exifApp1 = (tiff: string) =>
  `ffe1${(8 + tiff.length / 2).toString(16).padStart(4, "0")}457869660000${tiff}`;
const wrapped = (segment: string) =>
  startOfImage + segment + quantisationTable + endOfImage;

describe("Cottage photo metadata removal", () => {
  it("removes location, device and capture metadata from a JPEG and keeps its picture data and orientation", () => {
    const photo = fromHex(
      startOfImage +
        jfifApp0 +
        locatedExifApp1 +
        xmpApp1 +
        colourProfileApp2 +
        multiPictureApp2 +
        comment +
        fillByte +
        quantisationTable +
        frameHeader +
        scanHeader +
        scanData +
        endOfImage +
        trailingVideo,
    );
    const expected =
      startOfImage +
      jfifApp0 +
      carriedOrientation(6) +
      colourProfileApp2 +
      quantisationTable +
      frameHeader +
      scanHeader +
      scanData +
      endOfImage;

    const cleaned = removeCottagePhotoMetadata(photo, "image/jpeg");

    if (cleaned.kind !== "cleaned") throw new Error(cleaned.kind);
    expect(hex(cleaned.bytes)).toBe(expected);
    // A caller sends the buffer, so it must hold the cleaned bytes and nothing else.
    expect(hex(new Uint8Array(cleaned.bytes.buffer))).toBe(expected);

    const again = removeCottagePhotoMetadata(cleaned.bytes, "image/jpeg");

    if (again.kind !== "cleaned") throw new Error(again.kind);
    expect(hex(new Uint8Array(again.bytes.buffer))).toBe(expected);
    expect(again.bytes.buffer).not.toBe(cleaned.bytes.buffer);
  });

  it.each([
    [
      "a rotating value in a little-endian block",
      `ffe1002245786966000049492a00080000000100120103000100000003000000${"00".repeat(4)}`,
      carriedOrientation(3),
    ],
    ["the upright value 1", carriedOrientation(1), ""],
    ["a value above the eight defined", carriedOrientation(9), ""],
    ["a value of zero", carriedOrientation(0), ""],
    [
      "no orientation entry",
      "ffe100224578696600004d4d002a000000080001011a000500000001000000000000" +
        "0000",
      "",
    ],
    ["no EXIF block", "", ""],
  ])(
    "carries an orientation only when it rotates the picture: %s",
    (_name, exifApp1, carried) => {
      const cleaned = removeCottagePhotoMetadata(
        fromHex(startOfImage + exifApp1 + quantisationTable + endOfImage),
        "image/jpeg",
      );

      if (cleaned.kind !== "cleaned") throw new Error(cleaned.kind);
      expect(hex(cleaned.bytes)).toBe(
        startOfImage + carried + quantisationTable + endOfImage,
      );
    },
  );

  it.each([
    ["a missing start marker", "00d8ffd9", "image/jpeg"],
    ["no bytes at all", "", "image/jpeg"],
    ["a segment running past the end", "ffd8ffdb00100001ffd9", "image/jpeg"],
    ["a segment cut off inside its length", "ffd8ffdb00", "image/jpeg"],
    ["a segment length below 2", "ffd8ffda0001a1ffd9", "image/jpeg"],
    ["bytes between segments that are no marker", "ffd8a1ffd9", "image/jpeg"],
    [
      "a restart marker where a segment is required",
      "ffd8ffd0ffd9",
      "image/jpeg",
    ],
    ["no end-of-image marker after a segment", "ffd8ffdb000300", "image/jpeg"],
    [
      "no end-of-image marker after scan data",
      `ffd8${scanHeader}${scanData}`,
      "image/jpeg",
    ],
    [
      "an EXIF block cut off inside its TIFF header",
      wrapped(exifApp1("4d4d002a0000")),
      "image/jpeg",
    ],
    [
      "an EXIF block with an unknown byte order",
      wrapped(exifApp1("5858002a000000080000")),
      "image/jpeg",
    ],
    [
      "an EXIF block that is not a TIFF",
      wrapped(exifApp1("4d4d002b000000080000")),
      "image/jpeg",
    ],
    [
      "an EXIF first directory placed past the block",
      wrapped(exifApp1("4d4d002a000000ff0000")),
      "image/jpeg",
    ],
    [
      "an EXIF first directory whose entries run past the block",
      wrapped(exifApp1("4d4d002a000000080002011a00050000000100000000")),
      "image/jpeg",
    ],
    [
      "an orientation entry that is not a SHORT",
      wrapped(exifApp1("4d4d002a0000000800010112000400000001000000060000")),
      "image/jpeg",
    ],
    [
      "an orientation entry holding two values",
      wrapped(exifApp1("4d4d002a0000000800010112000300000002000600060000")),
      "image/jpeg",
    ],
    [
      "a media type other than JPEG",
      startOfImage + quantisationTable + endOfImage,
      "image/png",
    ],
  ])("refuses a JPEG it cannot read: %s", (_name, photo, mediaType) => {
    expect(removeCottagePhotoMetadata(fromHex(photo), mediaType)).toEqual({
      kind: "unreadable",
    });
  });
});

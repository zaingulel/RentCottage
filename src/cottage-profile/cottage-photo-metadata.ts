export type CottagePhotoMetadataRemoval =
  | { kind: "cleaned"; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "unreadable" };

type KeptParts = Uint8Array[] | "unreadable";

const jpegExifPrefix = Uint8Array.of(
  ...[0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00],
);

// A big-endian TIFF whose one directory holds only the orientation tag.
function orientationTiff(orientation: number): Uint8Array {
  return Uint8Array.of(
    ...[0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01],
    ...[0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation],
    ...[0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  );
}

// The orientation worth carrying (2 to 8), read from the first directory of an EXIF block's TIFF.
function readExifOrientation(tiff: Uint8Array): number | "none" | "unreadable" {
  if (tiff.length < 8) return "unreadable";
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const byteOrder = view.getUint16(0);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return "unreadable";
  const littleEndian = byteOrder === 0x4949;
  if (view.getUint16(2, littleEndian) !== 42) return "unreadable";
  const directory = view.getUint32(4, littleEndian);
  if (directory + 2 > tiff.length) return "unreadable";
  const entriesEnd =
    directory + 2 + view.getUint16(directory, littleEndian) * 12;
  if (entriesEnd > tiff.length) return "unreadable";
  for (let entry = directory + 2; entry < entriesEnd; entry += 12) {
    if (view.getUint16(entry, littleEndian) !== 0x0112) continue;
    const isOneShort =
      view.getUint16(entry + 2, littleEndian) === 3 &&
      view.getUint32(entry + 4, littleEndian) === 1;
    if (!isOneShort) return "unreadable";
    const orientation = view.getUint16(entry + 8, littleEndian);
    // 1 and undefined values rotate nothing in a browser, so there is nothing to carry.
    return orientation >= 2 && orientation <= 8 ? orientation : "none";
  }
  return "none";
}

function startsWith(segment: Uint8Array, identifier: string): boolean {
  for (let index = 0; index < identifier.length; index += 1) {
    if (segment[4 + index] !== identifier.charCodeAt(index)) return false;
  }
  return true;
}

function keepsJpegSegment(marker: number, segment: Uint8Array): boolean {
  if (marker === 0xfe) return false;
  if (marker < 0xe0 || marker > 0xef) return true;
  return (
    (marker === 0xe0 && startsWith(segment, "JFIF\0")) ||
    (marker === 0xe2 && startsWith(segment, "ICC_PROFILE\0")) ||
    (marker === 0xee && startsWith(segment, "Adobe"))
  );
}

// Stuffed FF 00, restart markers and fill bytes are entropy-coded data, not the next segment.
function nextJpegMarker(bytes: Uint8Array, from: number): number {
  let at = bytes.indexOf(0xff, from);
  while (at !== -1) {
    const next = bytes[at + 1];
    if (next === undefined) return -1;
    if (next === 0xff) at += 1;
    else if (next === 0x00 || (next >= 0xd0 && next <= 0xd7))
      at = bytes.indexOf(0xff, at + 2);
    else return at;
  }
  return -1;
}

function keptJpegParts(bytes: Uint8Array): KeptParts {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return "unreadable";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept = [bytes.subarray(0, 2)];
  let exifSeen = false;
  let position = 2;
  while (bytes[position] === 0xff) {
    const marker = bytes[position + 1];
    if (marker === 0xff) {
      position += 1;
      continue;
    }
    if (marker === 0xd9) {
      kept.push(bytes.subarray(position, position + 2));
      return kept;
    }
    // Markers that carry no length cannot stand where a segment is required.
    const hasLength =
      marker !== undefined && marker > 0x01 && (marker < 0xd0 || marker > 0xd8);
    if (!hasLength || position + 4 > bytes.length) return "unreadable";
    const length = view.getUint16(position + 2);
    const end = position + 2 + length;
    if (length < 2 || end > bytes.length) return "unreadable";
    const segment = bytes.subarray(position, end);
    if (marker === 0xe1 && !exifSeen && startsWith(segment, "Exif\0\0")) {
      exifSeen = true;
      const orientation = readExifOrientation(segment.subarray(10));
      if (orientation === "unreadable") return "unreadable";
      if (orientation !== "none")
        kept.push(jpegExifPrefix, orientationTiff(orientation));
    } else if (keepsJpegSegment(marker, segment)) {
      kept.push(segment);
    }
    position = end;
    if (marker === 0xda) {
      const next = nextJpegMarker(bytes, position);
      if (next === -1) return "unreadable";
      kept.push(bytes.subarray(position, next));
      position = next;
    }
  }
  return "unreadable";
}

export function removeCottagePhotoMetadata(
  bytes: Uint8Array,
  mediaType: string,
): CottagePhotoMetadataRemoval {
  const kept = mediaType === "image/jpeg" ? keptJpegParts(bytes) : "unreadable";
  if (kept === "unreadable") return { kind: "unreadable" };
  const cleaned = new Uint8Array(
    kept.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of kept) {
    cleaned.set(part, offset);
    offset += part.length;
  }
  return { kind: "cleaned", bytes: cleaned };
}

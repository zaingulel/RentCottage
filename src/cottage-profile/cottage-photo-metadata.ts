export type CottagePhotoMetadataRemoval =
  | { kind: "cleaned"; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "unreadable" };

type CleanedLength = number | "unreadable";

type CleanedPhoto = { bytes: Uint8Array<ArrayBuffer>; written: number };

function write(cleaned: CleanedPhoto, part: Uint8Array): void {
  cleaned.bytes.set(part, cleaned.written);
  cleaned.written += part.length;
}

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
  return marker === 0xe2 && startsWith(segment, "ICC_PROFILE\0");
}

// The JFIF and Adobe header blocks are rewritten to their standard 14 and 12 payload bytes.
const jfifApp0Header = Uint8Array.of(0xff, 0xe0, 0x00, 0x10);
const jfifNoThumbnail = Uint8Array.of(0x00, 0x00);
const adobeApp14Header = Uint8Array.of(0xff, 0xee, 0x00, 0x0e);

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

function writeCleanedJpeg(
  bytes: Uint8Array,
  cleaned: CleanedPhoto,
): CleanedLength {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return "unreadable";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  write(cleaned, bytes.subarray(0, 2));
  let exifSeen = false;
  let position = 2;
  while (bytes[position] === 0xff) {
    const marker = bytes[position + 1];
    if (marker === 0xff) {
      position += 1;
      continue;
    }
    if (marker === 0xd9) {
      write(cleaned, bytes.subarray(position, position + 2));
      return cleaned.written;
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
      if (orientation !== "none") {
        write(cleaned, jpegExifPrefix);
        write(cleaned, orientationTiff(orientation));
      }
    } else if (marker === 0xe0 && startsWith(segment, "JFIF\0")) {
      if (length < 16) return "unreadable";
      // Identifier, version, units and densities; the thumbnail and anything after it are dropped.
      write(cleaned, jfifApp0Header);
      write(cleaned, segment.subarray(4, 16));
      write(cleaned, jfifNoThumbnail);
    } else if (marker === 0xee && startsWith(segment, "Adobe")) {
      if (length < 14) return "unreadable";
      // Identifier, version, both flag words and the colour transform.
      write(cleaned, adobeApp14Header);
      write(cleaned, segment.subarray(4, 16));
    } else if (keepsJpegSegment(marker, segment)) {
      write(cleaned, segment);
    }
    position = end;
    if (marker === 0xda) {
      const next = nextJpegMarker(bytes, position);
      if (next === -1) return "unreadable";
      write(cleaned, bytes.subarray(position, next));
      position = next;
    }
  }
  return "unreadable";
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const keptPngChunkTypes = new Set(
  "IHDR PLTE IDAT IEND tRNS gAMA cHRM sRGB iCCP cICP mDCV cLLI sBIT bKGD pHYs acTL fcTL fdAT".split(
    " ",
  ),
);

// The CRC-32 a PNG chunk carries, taken over its type and data.
function pngChecksum(bytes: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      checksum = checksum & 1 ? (checksum >>> 1) ^ 0xedb88320 : checksum >>> 1;
  }
  return ~checksum >>> 0;
}

const pngExifChunkLength = 38;

function pngExifChunk(orientation: number): Uint8Array {
  const chunk = new Uint8Array(pngExifChunkLength);
  chunk.set([0x00, 0x00, 0x00, 0x1a, 0x65, 0x58, 0x49, 0x66]);
  chunk.set(orientationTiff(orientation), 8);
  new DataView(chunk.buffer).setUint32(34, pngChecksum(chunk.subarray(4, 34)));
  return chunk;
}

function writeCleanedPng(
  bytes: Uint8Array,
  cleaned: CleanedPhoto,
): CleanedLength {
  if (!pngSignature.every((byte, index) => bytes[index] === byte))
    return "unreadable";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  write(cleaned, bytes.subarray(0, 8));
  let exifSeen = false;
  let position = 8;
  // A chunk is a length, a type, the data and a checksum; the checksum is copied, not verified.
  while (position + 12 <= bytes.length) {
    const end = position + 12 + view.getUint32(position);
    if (end > bytes.length) return "unreadable";
    const type = String.fromCharCode(
      ...bytes.subarray(position + 4, position + 8),
    );
    if (keptPngChunkTypes.has(type)) {
      write(cleaned, bytes.subarray(position, end));
      if (type === "IEND") return cleaned.written;
    } else if ((view.getUint8(position + 4) & 0x20) === 0) {
      // An upper-case first letter marks a chunk the picture cannot be decoded without.
      return "unreadable";
    } else if (type === "eXIf" && !exifSeen) {
      exifSeen = true;
      const orientation = readExifOrientation(
        bytes.subarray(position + 8, end - 4),
      );
      if (orientation === "unreadable") return "unreadable";
      if (orientation !== "none") write(cleaned, pngExifChunk(orientation));
    }
    position = end;
  }
  return "unreadable";
}

const webpPictureChunkTypes = new Set(["ALPH", "VP8 ", "VP8L"]);
const keptWebpChunkTypes = new Set(["ICCP", "ANIM", ...webpPictureChunkTypes]);

// The chunk code EXIF and the little-endian size of the 26-byte orientation TIFF.
const webpExifHeader = Uint8Array.of(
  ...[0x45, 0x58, 0x49, 0x46, 0x1a, 0x00, 0x00, 0x00],
);

function fourCharacterCode(bytes: Uint8Array, position: number): string {
  return String.fromCharCode(...bytes.subarray(position, position + 4));
}

// A frame is a 16-byte header then sub-chunks framed like top-level chunks; only its picture is kept.
function writeCleanedWebpFrame(
  bytes: Uint8Array,
  view: DataView,
  position: number,
  payloadEnd: number,
  cleaned: CleanedPhoto,
): CleanedLength {
  if (position + 24 > payloadEnd) return "unreadable";
  const sizeAt = cleaned.written + 4;
  write(cleaned, bytes.subarray(position, position + 24));
  for (let at = position + 24; at < payloadEnd; ) {
    if (at + 8 > payloadEnd) return "unreadable";
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2);
    if (end > payloadEnd) return "unreadable";
    if (webpPictureChunkTypes.has(fourCharacterCode(bytes, at)))
      write(cleaned, bytes.subarray(at, end));
    at = end;
  }
  new DataView(cleaned.bytes.buffer).setUint32(
    sizeAt,
    cleaned.written - sizeAt - 4,
    true,
  );
  return cleaned.written;
}

function writeCleanedWebp(
  bytes: Uint8Array,
  cleaned: CleanedPhoto,
): CleanedLength {
  if (
    fourCharacterCode(bytes, 0) !== "RIFF" ||
    fourCharacterCode(bytes, 8) !== "WEBP"
  )
    return "unreadable";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  const containerEnd = riffSize + 8;
  if (riffSize < 4 || containerEnd > bytes.length) return "unreadable";
  write(cleaned, bytes.subarray(0, 12));
  let exifSeen = false;
  // The XMP flag (0x04) always goes; the EXIF flag (0x08) goes unless an orientation is carried.
  let clearedFlags = 0x0c;
  // VP8X flags are rewritten in the cleaned photo once the walk knows which metadata stays.
  let extendedHeaderAt: number | undefined;
  let position = 12;
  while (position < containerEnd) {
    if (position + 8 > containerEnd) return "unreadable";
    const size = view.getUint32(position + 4, true);
    // An odd-sized payload is followed by one pad byte.
    const end = position + 8 + size + (size % 2);
    if (end > containerEnd) return "unreadable";
    const code = fourCharacterCode(bytes, position);
    if (code === "VP8X") {
      // The extended header has a fixed 10-byte payload and appears once.
      if (extendedHeaderAt !== undefined || size !== 10) return "unreadable";
      extendedHeaderAt = cleaned.written;
      write(cleaned, bytes.subarray(position, end));
    } else if (code === "ANMF") {
      const payloadEnd = position + 8 + size;
      if (
        writeCleanedWebpFrame(bytes, view, position, payloadEnd, cleaned) ===
        "unreadable"
      )
        return "unreadable";
    } else if (keptWebpChunkTypes.has(code)) {
      write(cleaned, bytes.subarray(position, end));
    } else if (code === "EXIF" && !exifSeen) {
      exifSeen = true;
      const payload = bytes.subarray(position + 4, position + 8 + size);
      // Some writers put the JPEG identifier before the TIFF.
      const orientation = readExifOrientation(
        payload.subarray(startsWith(payload, "Exif\0\0") ? 10 : 4),
      );
      if (orientation === "unreadable") return "unreadable";
      if (orientation !== "none") {
        write(cleaned, webpExifHeader);
        write(cleaned, orientationTiff(orientation));
        clearedFlags = 0x04;
      }
    }
    position = end;
  }
  if (extendedHeaderAt !== undefined)
    cleaned.bytes[extendedHeaderAt + 8] &= ~clearedFlags;
  new DataView(cleaned.bytes.buffer).setUint32(4, cleaned.written - 8, true);
  return cleaned.written;
}

function writeCleanedPhoto(
  bytes: Uint8Array,
  mediaType: string,
  cleaned: CleanedPhoto,
): CleanedLength {
  if (mediaType === "image/jpeg") return writeCleanedJpeg(bytes, cleaned);
  if (mediaType === "image/png") return writeCleanedPng(bytes, cleaned);
  if (mediaType === "image/webp") return writeCleanedWebp(bytes, cleaned);
  return "unreadable";
}

export function removeCottagePhotoMetadata(
  bytes: Uint8Array,
  mediaType: string,
): CottagePhotoMetadataRemoval {
  // Every other write is no longer than the disjoint range of the input it replaces, and at most one
  // orientation block is written, the PNG eXIf chunk being the longest.
  const cleaned = {
    bytes: new Uint8Array(bytes.length + pngExifChunkLength),
    written: 0,
  };
  const written = writeCleanedPhoto(bytes, mediaType, cleaned);
  if (written === "unreadable") return { kind: "unreadable" };
  // A copy of exactly the cleaned bytes, because the media route sends the whole underlying buffer.
  return { kind: "cleaned", bytes: cleaned.bytes.slice(0, written) };
}

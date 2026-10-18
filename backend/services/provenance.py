"""
Clarity Mesh — Provenance, Container & Integrity Inspection
============================================================
Extracts chain-of-custody anchors and provenance signals from stored media
using ONLY the Python standard library (no new dependencies):

* SHA-256 integrity hash of the exact stored bytes,
* JPEG EXIF IFD0 tags (Make / Model / Software / DateTime) via a minimal,
  bounds-checked TIFF parser,
* PNG tEXt / iTXt / zTXt text chunks,
* ISO-BMFF (MP4/MOV) ``ftyp`` major brand and ``mvhd`` creation time,
* C2PA / JUMBF byte-marker presence (presence ONLY — this module never
  claims to validate a content-credential signature).

Every sub-section reports an honest status.  A missing, truncated or
unsupported structure is reported as such — never guessed, never silently
dropped.  The response is JSON-serialisable and safe to persist with an
analysis record.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# JPEG markers
_SOI = b"\xff\xd8"
_SOS = b"\xff\xda"
_EOI = b"\xff\xd9"

# TIFF IFD0 tags we care about (all ASCII)
_TIFF_ASCII_TAGS = {
    0x010F: "make",
    0x0110: "model",
    0x0131: "software",
    0x0132: "datetime",
    0x013B: "artist",
}

# PNG text keywords surfaced to the UI
_PNG_KEYWORDS = {
    "software",
    "author",
    "creation time",
    "title",
    "description",
    "comment",
    "source",
}

# MP4/MOV epoch: seconds begin 1904-01-01T00:00:00Z
_MP4_EPOCH_OFFSET = 2082844800

# Read windows for large files (header + trailer), mirroring forensic_engine.
_HEAD_WINDOW = 262144  # 256 KB
_TAIL_WINDOW = 65536   # 64 KB

_SHA256_CHUNK = 1024 * 1024


class ProvenanceError(RuntimeError):
    """Raised only for programmer errors; extraction failures are reported."""


def sha256_file(path: Path) -> str:
    """Streaming SHA-256 of the exact bytes on disk."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_SHA256_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_windows(path: Path) -> tuple[bytes, int]:
    """Return (head + tail sample bytes, total size)."""
    size = path.stat().st_size
    with open(path, "rb") as handle:
        head = handle.read(min(size, _HEAD_WINDOW))
        tail = b""
        if size > _HEAD_WINDOW:
            handle.seek(max(0, size - _TAIL_WINDOW))
            tail = handle.read()
    return head + tail, size


# ---------------------------------------------------------------------------
# JPEG EXIF (TIFF IFD0) — minimal, bounds-checked parser
# ---------------------------------------------------------------------------
def _parse_tiff_ifd0(tiff: bytes) -> dict[str, str]:
    """Extract ASCII tags from a TIFF IFD0 block. Returns {} on any anomaly."""
    if len(tiff) < 8:
        return {}
    order = tiff[0:2]
    if order == b"II":
        endianness = "<"
    elif order == b"MM":
        endianness = ">"
    else:
        return {}
    try:
        magic = struct.unpack(endianness + "H", tiff[2:4])[0]
        if magic != 42:
            return {}
        ifd_offset = struct.unpack(endianness + "I", tiff[4:8])[0]
        if ifd_offset + 2 > len(tiff):
            return {}
        entry_count = struct.unpack(endianness + "H", tiff[ifd_offset:ifd_offset + 2])[0]
        # 4096 entries is far beyond any real camera IFD — treat as corrupt.
        if entry_count > 4096:
            return {}
    except struct.error:
        return {}

    out: dict[str, str] = {}
    for i in range(entry_count):
        base = ifd_offset + 2 + i * 12
        entry = tiff[base:base + 12]
        if len(entry) < 12:
            break
        try:
            tag, dtype, count = struct.unpack(endianness + "HHI", entry[0:8])
            value_raw = entry[8:12]
        except struct.error:
            break
        if tag not in _TIFF_ASCII_TAGS or dtype != 2 or count == 0:
            continue
        if count <= 4:
            data = value_raw[:count]
        else:
            (value_offset,) = struct.unpack(endianness + "I", value_raw)
            if value_offset + count > len(tiff):
                continue  # out of bounds — skip, never trust partial data
            data = tiff[value_offset:value_offset + count]
        text = data.split(b"\x00", 1)[0].decode("utf-8", errors="replace").strip()
        if text:
            out[_TIFF_ASCII_TAGS[tag]] = text
    return out


def _extract_jpeg_exif(head: bytes) -> dict[str, Any]:
    """Walk JPEG segments and parse the first APP1/Exif block found."""
    if not head.startswith(_SOI):
        return {"status": "not_applicable", "reason": "Not a JPEG byte stream."}
    pos = 2
    end = len(head)
    while pos + 4 <= end:
        if head[pos] != 0xFF:
            pos += 1
            continue
        marker = head[pos + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            pos += 2
            continue
        if marker in (0xDA, 0xD9):  # SOS / EOI — no APP1 before them
            break
        try:
            (seg_len,) = struct.unpack(">H", head[pos + 2:pos + 4])
        except struct.error:
            break
        if seg_len < 2:
            break
        segment = head[pos + 4:pos + 2 + seg_len]
        if marker == 0xE1 and segment.startswith(b"Exif\x00\x00"):
            tags = _parse_tiff_ifd0(segment[6:])
            if tags:
                return {"status": "extracted", "tags": tags}
            return {
                "status": "present_unreadable",
                "reason": "EXIF APP1 block found but the TIFF IFD could not be parsed.",
            }
        pos += 2 + seg_len
    return {"status": "absent", "reason": "No EXIF APP1 block found in the JPEG segments."}


def _extract_xmp_creator(head: bytes) -> str | None:
    """Best-effort XMP CreatorTool extraction from an XMP packet."""
    match = re.search(rb"<xmp:CreatorTool>([^<]{1,200})</xmp:CreatorTool>", head)
    if match:
        return match.group(1).decode("utf-8", errors="replace").strip()
    return None


# ---------------------------------------------------------------------------
# PNG text chunks
# ---------------------------------------------------------------------------
def _extract_png_text(head: bytes) -> dict[str, Any]:
    if not head.startswith(b"\x89PNG\r\n\x1a\n"):
        return {"status": "not_applicable", "reason": "Not a PNG byte stream."}
    out: dict[str, str] = {}
    pos = 8
    seen = 0
    try:
        while pos + 8 <= len(head) and seen < 64:
            (length,) = struct.unpack(">I", head[pos:pos + 4])
            ctype = head[pos + 4:pos + 8]
            if length > 16 * 1024 * 1024:
                break
            data = head[pos + 8:pos + 8 + length]
            if len(data) < length:
                break  # truncated window — stop, report what we have
            seen += 1
            if ctype == b"IEND":
                break
            if ctype == b"tEXt":
                keyword, _, text = data.partition(b"\x00")
                key = keyword.decode("latin-1", errors="replace").strip().lower()
                if key in _PNG_KEYWORDS:
                    out[key] = text.decode("latin-1", errors="replace").strip()[:500]
            elif ctype == b"zTXt":
                keyword, _, rest = data.partition(b"\x00")
                key = keyword.decode("latin-1", errors="replace").strip().lower()
                if key in _PNG_KEYWORDS and len(rest) >= 2:
                    try:
                        text = zlib.decompress(rest[1:]).decode("utf-8", errors="replace")
                        out[key] = text.strip()[:500]
                    except zlib.error:
                        pass  # corrupt compression — omit, do not guess
            elif ctype == b"iTXt":
                keyword, _, rest = data.partition(b"\x00")
                key = keyword.decode("latin-1", errors="replace").strip().lower()
                # rest: comp flag(1) comp method(1) lang(\0) translated(\0) text
                if key in _PNG_KEYWORDS and len(rest) >= 2:
                    try:
                        lang_end = rest.index(b"\x00", 2)
                        trans_end = rest.index(b"\x00", lang_end + 1)
                        text = rest[trans_end + 1:]
                        if rest[0] == 1:  # compressed
                            text = zlib.decompress(text)
                        out[key] = text.decode("utf-8", errors="replace").strip()[:500]
                    except (ValueError, zlib.error):
                        pass
            pos += 12 + length
    except struct.error:
        pass
    if out:
        return {"status": "extracted", "tags": out}
    return {
        "status": "absent",
        "reason": "No recognised PNG text chunks found (or none within the scan window).",
    }


# ---------------------------------------------------------------------------
# ISO-BMFF (MP4 / MOV) container facts
# ---------------------------------------------------------------------------
def _mp4_time_to_iso(seconds: int) -> str | None:
    if seconds <= 0:
        return None
    try:
        stamp = datetime.fromtimestamp(
            seconds - _MP4_EPOCH_OFFSET, tz=timezone.utc
        )
    except (OverflowError, OSError, ValueError):
        return None
    if stamp.year < 1970 or stamp.year > 2200:
        return None  # implausible values are reported as absent, never guessed
    return stamp.isoformat().replace("+00:00", "Z")


def _extract_mp4_container(sample: bytes) -> dict[str, Any]:
    container: dict[str, Any] = {}

    # ftyp box is always the first box in a well-formed ISO-BMFF file.
    if len(sample) >= 12 and sample[4:8] == b"ftyp":
        try:
            (box_size,) = struct.unpack(">I", sample[0:4])
        except struct.error:
            box_size = 0
        container["major_brand"] = sample[8:12].decode("latin-1", errors="replace").strip()
        if 16 <= box_size <= len(sample):
            compatible = []
            for off in range(16, box_size - 3, 4):
                brand = sample[off:off + 4].decode("latin-1", errors="replace").strip()
                if brand:
                    compatible.append(brand)
            if compatible:
                container["compatible_brands"] = compatible[:12]
    else:
        container["ftyp"] = "absent"

    # mvhd may sit anywhere inside moov — scan the sample for its type tag.
    idx = sample.find(b"mvhd")
    if idx >= 4:
        try:
            (box_size,) = struct.unpack(">I", sample[idx - 4:idx])
            payload = sample[idx + 4:idx - 4 + box_size]
            version = payload[0]
            creation = 0
            timescale = 0
            if version == 0 and len(payload) >= 20:
                creation, _modification, timescale, _duration = struct.unpack(
                    ">IIII", payload[4:20]
                )
            elif version == 1 and len(payload) >= 28:
                creation, _modification = struct.unpack(">QQ", payload[4:20])
                timescale = struct.unpack(">I", payload[20:24])[0]
            if timescale > 0 and creation > 0:
                iso = _mp4_time_to_iso(creation)
                if iso:
                    container["creation_time_utc"] = iso
        except (struct.error, IndexError):
            pass
    else:
        container["mvhd"] = "absent"

    if not container:
        return {
            "status": "absent",
            "reason": "No ftyp/mvhd boxes found within the scan window.",
        }
    container["status"] = "extracted"
    return container


# ---------------------------------------------------------------------------
# C2PA / JUMBF marker presence (presence only — never a validation claim)
# ---------------------------------------------------------------------------
def _detect_c2pa_markers(sample: bytes) -> dict[str, Any]:
    marker_found = b"c2pa" in sample or b"jumb" in sample.lower()
    return {
        "marker_found": marker_found,
        "note": (
            "Byte-marker presence only. This check does NOT validate any C2PA "
            "signature, certificate chain or manifest claim — it only reports "
            "that C2PA/JUMBF container bytes were observed in the file header "
            "or trailer window."
        ),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def extract_provenance(path: str | Path, media_kind: str = "unknown") -> dict[str, Any]:
    """
    Build the provenance / chain-of-custody block for one stored file.

    Never raises for malformed media: each section carries its own honest
    status so the UI can render exactly what was (and was not) observed.
    """
    p = Path(path)
    base: dict[str, Any] = {
        "status": "completed",
        "media_kind": media_kind,
        "hash_algorithm": "sha256",
    }

    try:
        if not p.is_file() or p.stat().st_size == 0:
            return {
                **base,
                "status": "failed",
                "error": "Source file is missing or empty — integrity hash could not be computed.",
            }
        sample, size = _read_windows(p)
        base["size_bytes"] = size
        base["sha256"] = sha256_file(p)
    except OSError as exc:
        return {**base, "status": "failed", "error": f"Cannot read stored file: {exc}"}

    base["c2pa"] = _detect_c2pa_markers(sample)

    ext = p.suffix.lower()
    if ext in (".jpg", ".jpeg"):
        base["exif"] = _extract_jpeg_exif(sample)
        creator = _extract_xmp_creator(sample)
        if creator:
            base["xmp_creator_tool"] = creator
        base["container"] = {"status": "not_applicable", "reason": "JPEG (JFIF/Exif) image."}
        base["png_text"] = {"status": "not_applicable", "reason": "Not a PNG."}
    elif ext == ".png":
        base["png_text"] = _extract_png_text(sample)
        base["exif"] = {"status": "not_applicable", "reason": "PNG has no JPEG EXIF APP1 block."}
        base["container"] = {"status": "not_applicable", "reason": "PNG image."}
    elif ext in (".mp4", ".mov", ".m4v", ".3gp"):
        base["container"] = _extract_mp4_container(sample)
        base["exif"] = {"status": "not_applicable", "reason": "ISO-BMFF video container."}
        base["png_text"] = {"status": "not_applicable", "reason": "Not a PNG."}
    elif ext in (".webp", ".gif", ".bmp"):
        base["exif"] = {"status": "not_applicable", "reason": f"Format '{ext}' has no EXIF APP1 block."}
        base["container"] = {"status": "not_applicable", "reason": f"Format '{ext}' container."}
        base["png_text"] = {"status": "not_applicable", "reason": "Not a PNG."}
    else:
        unknown = ext or "no extension"
        base["exif"] = {"status": "not_applicable", "reason": f"Unknown format '{unknown}'."}
        base["container"] = {"status": "not_applicable", "reason": f"Unknown format '{unknown}'."}
        base["png_text"] = {"status": "not_applicable", "reason": f"Unknown format '{unknown}'."}

    return base


def canonical_record_hash(record: dict[str, Any]) -> str:
    """Deterministic SHA-256 over a history record's canonical JSON form."""
    canonical = json.dumps(record, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


__all__ = [
    "ProvenanceError",
    "canonical_record_hash",
    "extract_provenance",
    "sha256_file",
]


"""
Clarity Mesh — Provenance & chain-of-custody extraction tests.
Covers the stdlib JPEG EXIF / PNG text / MP4 container parsers, the SHA-256
integrity hash, C2PA marker detection and honest failure states.
"""

from __future__ import annotations

import hashlib
import re
import struct
from pathlib import Path

from services.provenance import canonical_record_hash, extract_provenance, sha256_file


# ---------------------------------------------------------------------------
# Synthetic file builders
# ---------------------------------------------------------------------------
def build_tiff_ifd0(tags: dict[int, str]) -> bytes:
    """Little-endian TIFF with one ASCII IFD0 entry per tag."""
    entries = sorted(tags.items())
    n = len(entries)
    ifd_size = 2 + n * 12 + 4
    data_area = b""
    encoded = []
    for tag, value in entries:
        raw = value.encode("utf-8") + b"\x00"
        encoded.append((tag, raw))
    offset = 8 + ifd_size
    entry_bytes = b""
    for tag, raw in encoded:
        if len(raw) <= 4:
            value_field = raw.ljust(4, b"\x00")
        else:
            value_field = struct.pack("<I", offset)
            data_area += raw
            offset += len(raw)
        entry_bytes += struct.pack("<HHI", tag, 2, len(raw)) + value_field
    header = b"II" + struct.pack("<HI", 42, 8)
    ifd = struct.pack("<H", n) + entry_bytes + struct.pack("<I", 0)
    return header + ifd + data_area


def synthetic_jpeg(tags: dict[int, str] | None = None) -> bytes:
    if tags is None:
        return b"\xff\xd8\xff\xd9"  # bare SOI/EOI, no APP1
    tiff = build_tiff_ifd0(tags)
    payload = b"Exif\x00\x00" + tiff
    return b"\xff\xd8" + b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload + b"\xff\xd9"


def png_chunk(ctype: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + ctype + data + b"\x00\x00\x00\x00"


def synthetic_png(keyword: str = "Software", text: str = "ClarityMeshTest") -> bytes:
    ihdr = struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"tEXt", keyword.encode("latin-1") + b"\x00" + text.encode("latin-1"))
        + png_chunk(b"IEND", b"")
    )


def synthetic_mp4(creation_seconds_from_1904: int = 2082844800 + 1700000000) -> bytes:
    ftyp = struct.pack(">I", 24) + b"ftyp" + b"isom" + b"\x00\x00\x00\x00" + b"isom" + b"iso2"
    mvhd_payload = (
        b"\x00\x00\x00\x00"  # version 0 + flags
        + struct.pack(">IIII", creation_seconds_from_1904, 0, 1000, 10000)
        + b"\x00" * 80
    )
    mvhd = struct.pack(">I", 8 + len(mvhd_payload)) + b"mvhd" + mvhd_payload
    moov = struct.pack(">I", 8 + len(mvhd)) + b"moov" + mvhd
    return ftyp + moov


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_jpeg_exif_and_sha256(tmp_path: Path):
    data = synthetic_jpeg({0x010F: "ClarityCam", 0x0110: "Model-X1", 0x0131: "Firmware 1.0"})
    path = tmp_path / "photo.jpg"
    path.write_bytes(data)

    result = extract_provenance(path, media_kind="image")
    assert result["status"] == "completed"
    assert result["sha256"] == hashlib.sha256(data).hexdigest()
    assert result["sha256"] == sha256_file(path)
    assert len(result["sha256"]) == 64
    assert result["size_bytes"] == len(data)
    assert result["exif"]["status"] == "extracted"
    assert result["exif"]["tags"]["make"] == "ClarityCam"
    assert result["exif"]["tags"]["model"] == "Model-X1"
    assert result["exif"]["tags"]["software"] == "Firmware 1.0"
    assert result["c2pa"]["marker_found"] is False


def test_jpeg_without_exif_reports_absent(tmp_path: Path):
    path = tmp_path / "plain.jpg"
    path.write_bytes(synthetic_jpeg())
    result = extract_provenance(path, media_kind="image")
    assert result["exif"]["status"] == "absent"


def test_png_text_chunk_extraction(tmp_path: Path):
    path = tmp_path / "img.png"
    path.write_bytes(synthetic_png())
    result = extract_provenance(path, media_kind="image")
    assert result["png_text"]["status"] == "extracted"
    assert result["png_text"]["tags"]["software"] == "ClarityMeshTest"
    assert result["exif"]["status"] == "not_applicable"


def test_mp4_ftyp_and_mvhd_creation_time(tmp_path: Path):
    path = tmp_path / "clip.mp4"
    path.write_bytes(synthetic_mp4())
    result = extract_provenance(path, media_kind="video")
    container = result["container"]
    assert container["status"] == "extracted"
    assert container["major_brand"] == "isom"
    assert "iso2" in container.get("compatible_brands", [])
    assert container["creation_time_utc"].endswith("Z")
    assert re.match(r"^\d{4}-\d{2}-\d{2}T", container["creation_time_utc"])


def test_c2pa_marker_detected(tmp_path: Path):
    payload = synthetic_jpeg()[:-2] + b"c2pa" + b"\xff\xd9"
    path = tmp_path / "cred.jpg"
    path.write_bytes(payload)
    result = extract_provenance(path, media_kind="image")
    assert result["c2pa"]["marker_found"] is True
    # The note must never claim signature validation.
    assert "does NOT validate" in result["c2pa"]["note"]


def test_missing_file_reports_honest_failure(tmp_path: Path):
    result = extract_provenance(tmp_path / "gone.jpg", media_kind="image")
    assert result["status"] == "failed"
    assert "error" in result
    assert "sha256" not in result


def test_canonical_record_hash_is_deterministic_and_sensitive():
    record = {"id": 1, "visual_score": 0.5, "status": "processed"}
    same = {"status": "processed", "id": 1, "visual_score": 0.5}
    assert canonical_record_hash(record) == canonical_record_hash(same)
    assert re.fullmatch(r"[0-9a-f]{64}", canonical_record_hash(record))
    changed = dict(record, visual_score=0.6)
    assert canonical_record_hash(changed) != canonical_record_hash(record)

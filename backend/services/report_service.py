"""
Clarity Mesh — Forensic PDF Report Service (reportlab)
=======================================================
Renders an analyst-ready PDF for one stored analysis record, including an
explicit **chain-of-custody** section:

* SHA-256 of the exact source file bytes (recomputed at generation time —
  honestly reported as unavailable when the upload has been removed),
* a deterministic integrity hash of the history record itself (canonical
  JSON, SHA-256),
* generation timestamp (UTC), operator identity and the generating
  service identity.

Every score in the report is the recorded detector output; nothing is
recomputed or reinterpreted, and the uncalibrated-score disclaimer is
printed on the document itself.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from services.provenance import canonical_record_hash, sha256_file

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"

SERVICE_NAME = "Clarity Mesh API"
SERVICE_VERSION = "0.2.0"

_DISCLAIMER = (
    "All scores in this report are UNCALIBRATED model outputs recorded at "
    "analysis time. They are relative forensic indicators, not probabilities, "
    "and neither a 'real' nor a 'deepfake' classification constitutes proof "
    "of authenticity or manipulation. A 'real' result does not prove a file "
    "is authentic; a 'deepfake' result does not prove manipulation. "
    "Deepfake detection is probabilistic by nature — treat every result in "
    "this document as an estimate and corroborate with independent evidence."
)

_CUSTODY_NOTE = (
    "Chain-of-custody hashes in this report were computed by the Clarity Mesh "
    "backend at report-generation time from the bytes it holds. To verify, "
    "recompute the SHA-256 of your own copy of the source file and compare it "
    "with the source-file hash below. The record-integrity hash covers the "
    "canonical JSON of the stored analysis row and detects any change to the "
    "recorded detector results."
)


def compute_chain_of_custody(record: dict[str, Any], operator: dict[str, Any]) -> dict[str, Any]:
    """Build the chain-of-custody block for one history record."""
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    custody: dict[str, Any] = {
        "generated_at_utc": generated_at,
        "generated_by_service": f"{SERVICE_NAME} {SERVICE_VERSION}",
        "operator": {
            "id": operator.get("id"),
            "email": operator.get("email"),
            "name": operator.get("name"),
            "role": operator.get("role"),
        },
        "hash_algorithm": "sha256",
        "record_integrity_sha256": canonical_record_hash(record),
        "record_integrity_scope": "canonical JSON (sorted keys) of the stored analysis record",
        "note": _CUSTODY_NOTE,
    }

    stored_name = record.get("stored_name")
    source: dict[str, Any] = {"stored_name": stored_name}
    if not stored_name or Path(stored_name).name != stored_name:
        source.update({"available": False, "reason": "No sanitized stored filename on the record."})
    else:
        path = UPLOADS_DIR / stored_name
        try:
            if path.is_file() and path.stat().st_size > 0:
                source.update({
                    "available": True,
                    "sha256": sha256_file(path),
                    "size_bytes": path.stat().st_size,
                    "recomputed_at_utc": generated_at,
                })
            else:
                source.update({
                    "available": False,
                    "reason": "Source file is no longer present in the uploads store.",
                })
        except OSError as exc:
            source.update({"available": False, "reason": f"Cannot read source file: {exc}"})
    custody["source_file"] = source
    return custody


# ---------------------------------------------------------------------------
# PDF rendering
# ---------------------------------------------------------------------------
def _fmt_score(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "— (no score produced)"
    if number != number or number in (float("inf"), float("-inf")):
        return "— (no score produced)"
    return f"{number:.4f}"


def _detector_rows(record: dict[str, Any]) -> list[list[str]]:
    rows = [["Detector block", "Status", "Score", "Classification"]]
    for label, prefix in (
        ("Visual face forensics (EfficientNet-B7)", "visual"),
        ("Audio anti-spoofing (wav2vec2)", "audio"),
        ("AI still-image probe (CLIP)", "ai_image"),
    ):
        block_status = record.get(f"{prefix}_status") or "—"
        if block_status == "completed":
            score = _fmt_score(record.get(f"{prefix}_score"))
        else:
            score = "— (block not completed)"
        rows.append([
            label,
            str(block_status),
            score,
            str(record.get(f"{prefix}_classification") or "—"),
        ])
    mm_status = record.get("multimodal_status") or "—"
    if mm_status == "completed":
        fused = _fmt_score(record.get("fused_score"))
    else:
        fused = "— (fusion not completed)"
    rows.append([
        "Multimodal fusion / calibrated ensemble",
        str(mm_status),
        fused,
        str(record.get("multimodal_classification") or "—"),
    ])
    return rows


def build_report_pdf(record: dict[str, Any], custody: dict[str, Any]) -> bytes:
    """Render the chain-of-custody PDF for one record. Returns PDF bytes."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"Clarity Mesh Forensic Report #{record.get('id', '?')}",
        author="Clarity Mesh",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CmTitle", parent=styles["Title"], fontSize=18, textColor=colors.HexColor("#0F172A")
    )
    heading_style = ParagraphStyle(
        "CmHeading", parent=styles["Heading2"], fontSize=12,
        textColor=colors.HexColor("#0E7490"), spaceBefore=10, spaceAfter=4,
    )
    body = ParagraphStyle("CmBody", parent=styles["Normal"], fontSize=9, leading=12)
    mono = ParagraphStyle(
        "CmMono", parent=styles["Normal"], fontSize=7.5, leading=10,
        fontName="Courier",
    )
    small = ParagraphStyle("CmSmall", parent=styles["Normal"], fontSize=8, leading=11,
                           textColor=colors.HexColor("#475569"))

    story: list[Any] = []
    story.append(Paragraph("Clarity Mesh — Forensic Analysis Report", title_style))
    story.append(Paragraph(
        f"Report for analysis record #{record.get('id', '?')} — generated "
        f"{custody.get('generated_at_utc', 'unknown')} by "
        f"{custody.get('operator', {}).get('email', 'unknown operator')}.",
        small,
    ))
    story.append(Spacer(1, 6))

    # 1. Evidence record ----------------------------------------------------
    story.append(Paragraph("1. Evidence record", heading_style))
    identity = [
        ["Analysis ID", str(record.get("id", "—"))],
        ["Recorded at (UTC)", str(record.get("created_at", "—"))],
        ["Original filename", str(record.get("original_name") or "—")],
        ["Sanitized stored name", str(record.get("stored_name") or "—")],
        ["Media type", str(record.get("media_type") or "—")],
        ["Faces detected", str(record.get("faces_detected")
                                if record.get("faces_detected") is not None else "—")],
        ["Pipeline status", str(record.get("status") or "—")],
    ]
    table = Table(identity, colWidths=[55 * mm, 100 * mm])
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#E2E8F0")),
    ]))
    story.append(table)

    # 2. Detector results ---------------------------------------------------
    story.append(Paragraph("2. Recorded detector results", heading_style))
    story.append(Paragraph(
        "Scores below are the values stored when the analysis ran; they are "
        "not recomputed for this report.", small,
    ))
    story.append(Spacer(1, 3))
    det = Table(_detector_rows(record), colWidths=[62 * mm, 32 * mm, 38 * mm, 30 * mm])
    det.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0E7490")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]))
    story.append(det)

    # 3. Chain of custody ---------------------------------------------------
    story.append(Paragraph("3. Chain of custody", heading_style))
    source = custody.get("source_file", {})
    if source.get("available"):
        source_line = [
            ["Source file SHA-256", Paragraph(str(source.get("sha256", "—")), mono)],
            ["Source file size", f"{source.get('size_bytes', 0)} bytes"],
            ["Hash recomputed at", str(source.get("recomputed_at_utc", "—"))],
        ]
    else:
        source_line = [
            ["Source file SHA-256",
             Paragraph(f"UNAVAILABLE — {source.get('reason', 'source file not readable')}", body)],
        ]
    custody_rows = [
        ["Hash algorithm", str(custody.get("hash_algorithm", "sha256"))],
        *source_line,
        ["Record integrity SHA-256",
         Paragraph(str(custody.get("record_integrity_sha256", "—")), mono)],
        ["Integrity scope", str(custody.get("record_integrity_scope", "—"))],
        ["Generated at (UTC)", str(custody.get("generated_at_utc", "—"))],
        ["Generated by", str(custody.get("generated_by_service", "—"))],
        ["Operator", (
            f"{custody.get('operator', {}).get('name', '—')} "
            f"<{custody.get('operator', {}).get('email', '—')}> "
            f"({custody.get('operator', {}).get('role', '—')})"
        )],
    ]
    cust = Table(custody_rows, colWidths=[45 * mm, 110 * mm])
    cust.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#E2E8F0")),
    ]))
    story.append(cust)
    story.append(Spacer(1, 4))
    story.append(Paragraph(str(custody.get("note", _CUSTODY_NOTE)), small))

    # 4. Interpretation limits ----------------------------------------------
    story.append(Paragraph("4. Interpretation limits", heading_style))
    story.append(Paragraph(_DISCLAIMER, body))

    doc.build(story)
    return buffer.getvalue()


__all__ = ["UPLOADS_DIR", "build_report_pdf", "compute_chain_of_custody"]



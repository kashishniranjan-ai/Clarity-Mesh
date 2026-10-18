"""
Clarity Mesh — Report Routes
==============================
``GET /api/reports/{analysis_id}/pdf`` — download a PDF forensic report
for one stored analysis record, including the chain-of-custody section
(source-file SHA-256 recompute + record-integrity hash + operator identity).
Requires authentication and is rate limited; exports are audit-logged.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response

from services.audit_store import log_audit_event
from services.auth_deps import get_client_ip, get_current_user
from services.history_store import HistoryStoreError, get_analysis
from services.rate_limit import limiter
from services.report_service import build_report_pdf, compute_chain_of_custody

router = APIRouter()


@router.get("/{analysis_id}/pdf")
@limiter.limit("20/minute")
async def download_analysis_report(
    analysis_id: int,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Download the chain-of-custody PDF report for one analysis record."""
    try:
        record = get_analysis(analysis_id)
    except HistoryStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"History store unavailable: {exc}",
        ) from exc
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Analysis #{analysis_id} does not exist.",
        )

    custody = compute_chain_of_custody(record, current_user)
    pdf_bytes = build_report_pdf(record, custody)

    log_audit_event(
        action="REPORT_EXPORTED",
        user=current_user,
        target=f"analysis:{analysis_id}",
        ip_address=get_client_ip(request),
        details={
            "pdf_bytes": len(pdf_bytes),
            "source_file_available": custody.get("source_file", {}).get("available"),
            "record_integrity_sha256": custody.get("record_integrity_sha256"),
        },
    )

    filename = f"clarity-mesh-report-{analysis_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
            "X-Clarity-Record-Integrity-Sha256": str(custody.get("record_integrity_sha256", "")),
        },
    )

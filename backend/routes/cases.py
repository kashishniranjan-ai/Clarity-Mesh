"""Investigation case management endpoints.

Phase 4 additions:
- Case comments (POST/GET/DELETE)
- Analyst assignment (PATCH /{case_id}/assign)
- Chain-of-custody events on all case mutations
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from services.audit_store import log_audit_event
from services.auth_deps import get_client_ip, get_current_user
from services.case_comments import (
    CommentStoreError,
    add_comment,
    delete_comment,
    list_comments,
)
from services.case_store import (
    CaseStoreError,
    assign_case,
    create_case,
    delete_case,
    get_case,
    link_analysis,
    list_cases,
    unlink_analysis,
    update_case,
)
from services.chain_of_custody import (
    ChainOfCustodyError,
    append_custody_event,
    list_custody_events,
    verify_chain,
)

router = APIRouter(dependencies=[Depends(get_current_user)])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class CreateCase(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    summary: str = Field(default="", max_length=2000)
    priority: Literal["low", "medium", "high", "critical"] = "medium"


class UpdateCase(BaseModel):
    status: Literal["open", "in_review", "resolved"] | None = None
    priority: Literal["low", "medium", "high", "critical"] | None = None
    summary: str | None = Field(default=None, max_length=2000)


class AssignCase(BaseModel):
    analyst_email: str = Field(min_length=3, max_length=255)
    analyst_name: str = Field(default="", max_length=140)


class CreateComment(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


# ---------------------------------------------------------------------------
# Case CRUD
# ---------------------------------------------------------------------------

@router.get("")
def cases_list():
    try:
        return {"items": list_cases()}
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("", status_code=201)
def cases_create(
    body: CreateCase,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    try:
        case = create_case(body.title, body.summary, body.priority)
        log_audit_event(
            action="CASE_CREATED",
            user=current_user,
            target=str(case.get("id")),
            ip_address=get_client_ip(request),
            details={"title": body.title, "priority": body.priority},
        )
        # Chain-of-custody event
        try:
            append_custody_event(
                action="CASE_CREATED",
                actor=current_user,
                target=f"case:{case.get('id')}",
                details={"title": body.title, "priority": body.priority},
            )
        except ChainOfCustodyError:
            pass  # custody logging must never block business logic
        return case
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/{case_id}")
def case_detail(case_id: int):
    try:
        item = get_case(case_id)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Investigation case not found.")
    # Attach comments and custody events to the case detail
    try:
        item["comments"] = list_comments(case_id)
    except CommentStoreError:
        item["comments"] = []
    try:
        item["custody_events"] = list_custody_events(target=f"case:{case_id}", limit=50)
    except ChainOfCustodyError:
        item["custody_events"] = []
    return item


@router.patch("/{case_id}")
def case_update(
    case_id: int,
    body: UpdateCase,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    try:
        updates = body.model_dump(exclude_unset=True)
        item = update_case(case_id, **updates)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Investigation case not found.")

    log_audit_event(
        action="CASE_UPDATED",
        user=current_user,
        target=str(case_id),
        ip_address=get_client_ip(request),
        details=updates,
    )
    try:
        append_custody_event(
            action="CASE_UPDATED",
            actor=current_user,
            target=f"case:{case_id}",
            details=updates,
        )
    except ChainOfCustodyError:
        pass
    return item


# ---------------------------------------------------------------------------
# Case assignment
# ---------------------------------------------------------------------------

@router.patch("/{case_id}/assign")
def case_assign(
    case_id: int,
    body: AssignCase,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Assign or reassign a case to an analyst."""
    try:
        item = assign_case(case_id, body.analyst_email, body.analyst_name)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Investigation case not found.")

    log_audit_event(
        action="CASE_ASSIGNED",
        user=current_user,
        target=str(case_id),
        ip_address=get_client_ip(request),
        details={
            "assigned_to": body.analyst_email,
            "assigned_name": body.analyst_name,
        },
    )
    try:
        append_custody_event(
            action="CASE_ASSIGNED",
            actor=current_user,
            target=f"case:{case_id}",
            details={
                "assigned_to": body.analyst_email,
                "assigned_name": body.analyst_name,
            },
        )
    except ChainOfCustodyError:
        pass
    return item


# ---------------------------------------------------------------------------
# Evidence linking
# ---------------------------------------------------------------------------

@router.post("/{case_id}/analyses/{analysis_id}")
def case_add_analysis(
    case_id: int,
    analysis_id: int,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    try:
        item = link_analysis(case_id, analysis_id)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Case or analysis record not found.")

    log_audit_event(
        action="CASE_LINK_ANALYSIS",
        user=current_user,
        target=f"case:{case_id}/analysis:{analysis_id}",
        ip_address=get_client_ip(request),
    )
    try:
        append_custody_event(
            action="EVIDENCE_LINKED",
            actor=current_user,
            target=f"case:{case_id}",
            details={"analysis_id": analysis_id},
        )
    except ChainOfCustodyError:
        pass
    return item


@router.delete("/{case_id}/analyses/{analysis_id}")
def case_remove_analysis(
    case_id: int,
    analysis_id: int,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    try:
        item = unlink_analysis(case_id, analysis_id)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Investigation case not found.")

    log_audit_event(
        action="CASE_UNLINK_ANALYSIS",
        user=current_user,
        target=f"case:{case_id}/analysis:{analysis_id}",
        ip_address=get_client_ip(request),
    )
    try:
        append_custody_event(
            action="EVIDENCE_UNLINKED",
            actor=current_user,
            target=f"case:{case_id}",
            details={"analysis_id": analysis_id},
        )
    except ChainOfCustodyError:
        pass
    return item


# ---------------------------------------------------------------------------
# Case deletion
# ---------------------------------------------------------------------------

@router.delete("/{case_id}")
def case_delete(
    case_id: int,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    try:
        deleted = delete_case(case_id)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Investigation case not found.")

    log_audit_event(
        action="CASE_DELETED",
        user=current_user,
        target=str(case_id),
        ip_address=get_client_ip(request),
    )
    try:
        append_custody_event(
            action="CASE_DELETED",
            actor=current_user,
            target=f"case:{case_id}",
        )
    except ChainOfCustodyError:
        pass
    return {"deleted": True, "id": case_id}


# ---------------------------------------------------------------------------
# Case comments
# ---------------------------------------------------------------------------

@router.get("/{case_id}/comments")
def case_comments_list(case_id: int):
    """Get all comments for a case (chronological order)."""
    try:
        case = get_case(case_id)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if case is None:
        raise HTTPException(status_code=404, detail="Investigation case not found.")
    try:
        return {"items": list_comments(case_id)}
    except CommentStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/{case_id}/comments", status_code=201)
def case_comment_create(
    case_id: int,
    body: CreateComment,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Add a comment to a case."""
    try:
        comment = add_comment(case_id, current_user, body.body)
    except CommentStoreError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail="Investigation case not found.") from exc
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    log_audit_event(
        action="CASE_COMMENT_ADDED",
        user=current_user,
        target=f"case:{case_id}/comment:{comment['id']}",
        ip_address=get_client_ip(request),
    )
    try:
        append_custody_event(
            action="COMMENT_ADDED",
            actor=current_user,
            target=f"case:{case_id}",
            details={"comment_id": comment["id"], "body_preview": body.body[:120]},
        )
    except ChainOfCustodyError:
        pass
    return comment


@router.delete("/{case_id}/comments/{comment_id}")
def case_comment_delete(
    case_id: int,
    comment_id: int,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Delete a specific comment (author or admin only)."""
    try:
        deleted = delete_comment(comment_id, current_user)
    except CommentStoreError as exc:
        if "only the comment author" in str(exc).lower():
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Comment not found.")

    log_audit_event(
        action="CASE_COMMENT_DELETED",
        user=current_user,
        target=f"case:{case_id}/comment:{comment_id}",
        ip_address=get_client_ip(request),
    )
    return {"deleted": True, "comment_id": comment_id}


# ---------------------------------------------------------------------------
# Chain of custody
# ---------------------------------------------------------------------------

@router.get("/{case_id}/custody")
def case_custody_timeline(case_id: int, limit: int = 100):
    """Return the chain-of-custody timeline for a specific case."""
    try:
        case = get_case(case_id)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if case is None:
        raise HTTPException(status_code=404, detail="Investigation case not found.")
    try:
        events = list_custody_events(target=f"case:{case_id}", limit=limit)
        verification = verify_chain()
        return {
            "items": events,
            "case_id": case_id,
            "chain_intact": verification.get("intact", True),
            "verification": verification,
        }
    except ChainOfCustodyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


"""Investigation case management endpoints."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from services.audit_store import log_audit_event
from services.auth_deps import get_client_ip, get_current_user
from services.case_store import (
    CaseStoreError,
    create_case,
    delete_case,
    get_case,
    link_analysis,
    list_cases,
    unlink_analysis,
    update_case,
)

router = APIRouter(dependencies=[Depends(get_current_user)])


class CreateCase(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    summary: str = Field(default="", max_length=2000)
    priority: Literal["low", "medium", "high", "critical"] = "medium"


class UpdateCase(BaseModel):
    status: Literal["open", "in_review", "resolved"] | None = None
    priority: Literal["low", "medium", "high", "critical"] | None = None
    summary: str | None = Field(default=None, max_length=2000)


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
    return item


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
    return item


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
    return {"deleted": True, "id": case_id}

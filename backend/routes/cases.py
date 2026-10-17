"""Investigation case management endpoints."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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

router = APIRouter()


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
def cases_create(body: CreateCase):
    try:
        return create_case(body.title, body.summary, body.priority)
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
def case_update(case_id: int, body: UpdateCase):
    try:
        item = update_case(case_id, **body.model_dump(exclude_unset=True))
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Investigation case not found.")
    return item


@router.post("/{case_id}/analyses/{analysis_id}")
def case_add_analysis(case_id: int, analysis_id: int):
    try:
        item = link_analysis(case_id, analysis_id)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Case or analysis record not found.")
    return item


@router.delete("/{case_id}/analyses/{analysis_id}")
def case_remove_analysis(case_id: int, analysis_id: int):
    try:
        item = unlink_analysis(case_id, analysis_id)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Investigation case not found.")
    return item


@router.delete("/{case_id}")
def case_delete(case_id: int):
    try:
        deleted = delete_case(case_id)
    except CaseStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Investigation case not found.")
    return {"deleted": True, "id": case_id}

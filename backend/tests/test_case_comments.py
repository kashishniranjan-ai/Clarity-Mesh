"""Tests for case comments, case assignments, and custody tracking."""

import pytest
from services.case_comments import (
    CommentStoreError,
    add_comment,
    delete_comment,
    list_comments,
)
from services.case_store import assign_case, create_case, delete_case, get_case


def test_add_and_list_comments_service():
    """Verify adding comments to an existing case and listing them."""
    case = create_case("Disinformation Campaign", "Investigation of deepfake audio", "high")
    case_id = case["id"]

    author = {"id": "usr-1", "email": "analyst@clarity.mesh", "name": "Agent Fox"}
    c1 = add_comment(case_id, author, "Initial spectral analysis shows synthesized vocoder envelope.")
    assert c1["id"] is not None
    assert c1["case_id"] == case_id
    assert c1["author_email"] == "analyst@clarity.mesh"

    c2 = add_comment(case_id, author, "Flagged for supervisor review.")
    assert c2["id"] is not None

    comments = list_comments(case_id)
    assert len(comments) == 2
    comment_ids = {c["id"] for c in comments}
    assert c1["id"] in comment_ids and c2["id"] in comment_ids


def test_comment_on_nonexistent_case_raises():
    """Attempting to comment on a non-existent case raises CommentStoreError."""
    author = {"id": "usr-1", "email": "analyst@clarity.mesh", "name": "Agent Fox"}
    with pytest.raises(CommentStoreError):
        add_comment(999999, author, "This case does not exist.")


def test_delete_comment_author_and_admin_permissions():
    """Author and admin can delete comments; other users are rejected."""
    case = create_case("Audio Phishing", "CEO voice impersonation", "critical")
    case_id = case["id"]

    author = {"id": "usr-1", "email": "analyst@clarity.mesh", "role": "analyst", "name": "Fox"}
    c = add_comment(case_id, author, "Suspicious frequency cutoff at 8kHz.")

    other_user = {"id": "usr-2", "email": "other@clarity.mesh", "role": "analyst", "name": "Dana"}
    with pytest.raises(CommentStoreError, match="author or an admin"):
        delete_comment(c["id"], other_user)


    # Author can delete
    assert delete_comment(c["id"], author) is True
    assert list_comments(case_id) == []

    # Admin can delete another user's comment
    c2 = add_comment(case_id, author, "Second comment.")
    admin_user = {"id": "admin-1", "email": "root@clarity.mesh", "role": "admin", "name": "Director"}
    assert delete_comment(c2["id"], admin_user) is True


def test_case_deletion_cascades_to_comments():
    """Deleting a case must delete all linked comments (foreign key cascade)."""
    case = create_case("Cascade Test", "Testing FK cascade", "low")
    case_id = case["id"]

    author = {"id": "usr-1", "email": "analyst@clarity.mesh", "name": "Fox"}
    add_comment(case_id, author, "Comment to be cascaded.")

    assert len(list_comments(case_id)) == 1

    delete_case(case_id)
    assert list_comments(case_id) == []


def test_case_assignment():
    """Assigning a case updates assigned_to and assigned_name."""
    case = create_case("Unassigned Incident", "Triage required", "medium")
    case_id = case["id"]
    assert case.get("assigned_to") is None

    assigned = assign_case(case_id, "specialist@clarity.mesh", "Agent Mulder")
    assert assigned["assigned_to"] == "specialist@clarity.mesh"
    assert assigned["assigned_name"] == "Agent Mulder"

    fetched = get_case(case_id)
    assert fetched["assigned_to"] == "specialist@clarity.mesh"


def test_case_comments_and_custody_api(client):
    """API endpoints for comments, assignment, and custody timeline."""
    # 1. Create a case
    res = client.post("/api/cases", json={"title": "Election Deepfake", "summary": "Viral synthetic clip", "priority": "high"})
    assert res.status_code == 201
    case = res.json()
    case_id = case["id"]

    # 2. Add comment
    res_comment = client.post(f"/api/cases/{case_id}/comments", json={"body": "Analysis completed. 98% visual confidence."})
    assert res_comment.status_code == 201
    comment = res_comment.json()
    assert comment["body"] == "Analysis completed. 98% visual confidence."

    # 3. List comments
    res_list = client.get(f"/api/cases/{case_id}/comments")
    assert res_list.status_code == 200
    assert len(res_list.json()["items"]) == 1

    # 4. Assign case
    res_assign = client.patch(f"/api/cases/{case_id}/assign", json={"analyst_email": "lead@clarity.mesh", "analyst_name": "Lead Investigator"})
    assert res_assign.status_code == 200
    assert res_assign.json()["assigned_to"] == "lead@clarity.mesh"

    # 5. Custody timeline
    res_custody = client.get(f"/api/cases/{case_id}/custody")
    assert res_custody.status_code == 200
    custody_data = res_custody.json()
    assert custody_data["case_id"] == case_id
    assert custody_data["chain_intact"] is True
    assert len(custody_data["items"]) >= 2  # CASE_CREATED, COMMENT_ADDED, CASE_ASSIGNED

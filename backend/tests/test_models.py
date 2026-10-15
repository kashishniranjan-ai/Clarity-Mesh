def test_list_models(client):
    """The model registry exposes every registered detector."""
    response = client.get("/api/models")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 4
    ids = {d["id"] for d in data["detectors"]}
    assert ids == {"visual", "audio", "ai_image", "multimodal"}


def test_model_endpoint_fields(client):
    """Each model entry carries the documented contract keys."""
    for _id in ("visual", "audio", "ai_image", "multimodal"):
        response = client.get(f"/api/models/{_id}")
        assert response.status_code == 200, _id
        entry = response.json()
        assert entry["id"] == _id
        assert entry["score_direction"]
        assert "threshold" in entry
        assert "failure_states" in entry


def test_unknown_model_returns_404(client):
    response = client.get("/api/models/nope")
    assert response.status_code == 404


def test_models_route_requires_no_ml_imports(client):
    """The registry endpoint must not load weights or models."""
    response = client.get("/api/models")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 4
    for entry in body["detectors"]:
        assert "id" in entry
        assert "score_direction" in entry


def test_history_item_roundtrip(client):
    """Persisted analyses remain readable by id after a model run."""
    response = client.post(
        "/api/analyze",
        files=[("file", ("sample.png", b"fake-image-bytes", "image/png"))],
    )
    assert response.status_code == 200
    analysis_id = response.json()["id"]

    fetched = client.get(f"/api/history/{analysis_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == analysis_id


def test_history_item_404_when_absent(client):
    response = client.get("/api/history/999999")
    assert response.status_code == 404


def test_history_503_on_storage_failure(client, monkeypatch):
    """A broken store answers with an honest HTTP 503, not a traceback."""

    def _broken_list(limit: int = 50):
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(
        "services.history_store.list_analyses", _broken_list
    )

    response = client.get("/api/history")
    assert response.status_code == 503
    body = response.json()
    assert "unavailable" in body["detail"].lower()

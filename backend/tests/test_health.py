def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_me_requires_auth(client):
    response = client.get("/api/me")
    assert response.status_code == 401

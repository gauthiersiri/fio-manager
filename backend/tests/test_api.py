from .conftest import FIO_LOGS, FIO_RESULT


def test_validation(client, spec):
    bad = dict(spec, file_size_gi=9)           # 9*2 > 0.9*10
    assert client.post("/api/runs", json=bad).status_code == 422
    assert client.post("/api/runs", json=dict(spec, volume_mode="Block")).status_code == 422
    assert client.post("/api/runs", json=dict(spec, name="")).status_code == 422


def test_storageclasses_presets_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/storageclasses").json()[0]["name"] == "fast"
    assert len(client.get("/api/presets").json()) >= 5


def test_crud_and_conflicts(client, spec, kube):
    r = client.post("/api/runs", json=spec)
    assert r.status_code == 201
    run = r.json()
    assert run["state"] == "draft" and run["pvc_name"].startswith("fio-")
    rid = run["id"]
    assert client.get("/api/runs").json()[0]["id"] == rid
    assert client.put(f"/api/runs/{rid}", json=dict(spec, name="renamed")).json()["name"] == "renamed"

    started = client.post(f"/api/runs/{rid}/start").json()
    assert started["state"] == "provisioning" and started["attempt"] == 1
    assert kube.pvcs and kube.jobs and kube.configmaps
    assert client.post(f"/api/runs/{rid}/start").status_code == 409
    assert client.put(f"/api/runs/{rid}", json=spec).status_code == 409
    assert client.delete(f"/api/runs/{rid}").status_code == 409

    stopped = client.post(f"/api/runs/{rid}/stop").json()
    assert stopped["state"] == "stopped" and not kube.jobs
    assert client.post(f"/api/runs/{rid}/stop").status_code == 409
    assert client.get(f"/api/runs/{rid}/logs").text == "hello from fio\n"  # stored copy

    assert client.delete(f"/api/runs/{rid}").status_code == 204
    assert not kube.pvcs and not kube.configmaps
    assert client.get(f"/api/runs/{rid}").status_code == 404


def test_full_lifecycle_with_results(client, internal, mgr, kube, spec):
    rid = client.post("/api/runs", json=spec).json()["id"]
    client.post(f"/api/runs/{rid}/start")
    job = client.get(f"/api/runs/{rid}").json()["job_name"]
    token = kube.token

    kube.pod_phase = "Running"
    mgr.reconcile(rid)
    assert client.get(f"/api/runs/{rid}").json()["state"] == "running"
    assert client.get(f"/api/runs/{rid}/logs").text == "hello from fio\n"  # live

    url = f"/internal/runs/{rid}/results"
    payload = {"result": FIO_RESULT, "logs": FIO_LOGS}
    assert internal.post(url, json=payload).status_code == 403
    assert internal.post(url, json=payload, headers={"Authorization": "Bearer nope"}).status_code == 403
    auth = {"Authorization": f"Bearer {token}"}
    assert internal.post(url, json={"logs": FIO_LOGS}, headers=auth).status_code == 204  # progress
    assert client.get(f"/api/runs/{rid}/metrics").json()["time"] == [1, 2]
    assert internal.post(url, json=payload, headers=auth).status_code == 204

    kube.job_state[job] = "succeeded"
    mgr.reconcile(rid)
    run = client.get(f"/api/runs/{rid}").json()
    assert run["state"] == "succeeded" and run["has_results"] and run["finished_at"]
    assert run["summary"]["read"]["iops"] == 2560.0
    assert client.get(f"/api/runs/{rid}/results/download").json()["jobs"]
    assert "attachment" in client.get(f"/api/runs/{rid}/logs/download").headers["content-disposition"]
    cmp = client.get(f"/api/compare?ids={rid}").json()
    assert cmp[0]["summary"]["read"]["iops"] == 2560.0 and cmp[0]["metrics"]["time"] == [1, 2]
    # finished runs reject pushes
    assert internal.post(url, json=payload, headers=auth).status_code == 409

    # restart = new attempt, results cleared
    again = client.post(f"/api/runs/{rid}/start").json()
    assert again["attempt"] == 2 and not again["has_results"] and again["summary"] is None


def test_job_failure(client, mgr, kube, spec):
    rid = client.post("/api/runs", json=spec).json()["id"]
    client.post(f"/api/runs/{rid}/start")
    kube.job_state[client.get(f"/api/runs/{rid}").json()["job_name"]] = "failed"
    mgr.reconcile(rid)
    assert client.get(f"/api/runs/{rid}").json()["state"] == "failed"


def test_job_vanished(client, mgr, kube, spec):
    rid = client.post("/api/runs", json=spec).json()["id"]
    client.post(f"/api/runs/{rid}/start")
    kube.jobs.clear()
    mgr.reconcile(rid)
    assert client.get(f"/api/runs/{rid}").json()["state"] == "failed"


def test_missing_results_message(client, mgr, kube, spec):
    rid = client.post("/api/runs", json=spec).json()["id"]
    client.post(f"/api/runs/{rid}/start")
    kube.job_state[client.get(f"/api/runs/{rid}").json()["job_name"]] = "succeeded"
    mgr.reconcile(rid)
    run = client.get(f"/api/runs/{rid}").json()
    assert run["state"] == "succeeded" and "no results" in run["message"]
    assert client.get(f"/api/runs/{rid}/results/download").status_code == 404

#!/usr/bin/env python3
"""Local review API. Notes are drafts; only explicit human decisions certify data."""
import argparse
import fcntl
import hashlib
import json
import os
import secrets
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from record_review import ROOT, read_events, reviewed

CHECKS = {"source", "species", "host", "location", "date", "lineage"}


def read_notes(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def live_records():
    # Reload source evidence before a decision so another edit cannot receive a stale approval.
    from build_resource import collect
    binding = ROOT / "Data/curation/map_review_inputs.json"
    for name, expected in json.loads(binding.read_text()).items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest() != expected:
            raise ValueError("Source inputs changed. Rebuild the site, then review the current record.")
    return collect()


class ReviewStore:
    def __init__(self, folder, provider=live_records):
        self.folder = Path(folder)
        self.provider = provider
        self.ledger = self.folder / "reviews.jsonl"
        self.notes = self.folder / "review_notes.jsonl"
        self.lock = threading.RLock()

    def records(self):
        events = read_events(self.ledger)
        return [reviewed(r, events, r.get("origin") == "existing_resource") for r in self.provider()]

    def detail(self, rid):
        record = next((r for r in self.records() if r["record_id"] == rid), None)
        if not record:
            raise ValueError("Record not found")
        events = [e for e in read_notes(self.notes) if e["record_id"] == rid]
        resolved = {e["resolves"] for e in events if e.get("resolves")}
        notes = [{**e, "resolved": e.get("note_id") in resolved,
                  "current_version": e["fingerprint"] == record["fingerprint"]} for e in events]
        issues = [e for e in notes if e["kind"] in {"question", "correction"} and not e["resolved"] and e["current_version"]]
        return dict(record=record, notes=notes, open_issues=len(issues),
                    history=[e for e in read_events(self.ledger) if e["record_id"] == rid])

    def write(self, payload):
        self.folder.mkdir(parents=True, exist_ok=True)
        # Serialize both browser and CLI notes without erasing earlier decisions.
        with self.lock, (self.folder/".review.lock").open("a") as lockfile:
            fcntl.flock(lockfile, fcntl.LOCK_EX)
            detail = self.detail(payload.get("record_id"))
            record = detail["record"]
            if payload.get("fingerprint") != record["fingerprint"]:
                raise ValueError("This record changed. Refresh and inspect its current version before saving.")
            author = str(payload.get("author", "")).strip()
            if not author or len(author) > 150:
                raise ValueError("Enter the name of the person saving this decision or note.")
            stamp = datetime.now(timezone.utc).isoformat()
            action = payload.get("action")
            if action == "note":
                kind = payload.get("kind", "note")
                if kind not in {"note", "question", "correction", "resolution"}:
                    raise ValueError("Unknown note type")
                text = str(payload.get("text", "")).strip()
                if not text or len(text) > 20000:
                    raise ValueError("Enter a note (maximum 20,000 characters).")
                role = payload.get("author_role", "human")
                if role not in {"human", "assistant"}:
                    raise ValueError("Unknown author role")
                resolves = payload.get("resolves", "")
                if resolves and kind != "resolution":
                    raise ValueError("Only a human resolution can close a question or correction.")
                if kind == "resolution":
                    if role != "human" or not any(n["note_id"] == resolves and n["current_version"] and
                        n["kind"] in {"question", "correction"} and not n["resolved"] for n in detail["notes"]):
                        raise ValueError("A human reviewer must resolve an existing issue for this version.")
                event = dict(note_id=uuid.uuid4().hex,record_id=record["record_id"],fingerprint=record["fingerprint"],
                             author=author,author_role=role,timestamp=stamp,kind=kind,text=text,
                             evidence=str(payload.get("evidence", ""))[:4000],field=str(payload.get("field", ""))[:200],
                             proposed_value=str(payload.get("proposed_value", ""))[:8000],resolves=resolves)
                target = self.notes
            elif action in {"verify", "revoke", "release", "withdraw"}:
                if payload.get("author_role", "human") != "human" or payload.get("attest") is not True:
                    raise ValueError("Only an explicit human decision can change verification or release.")
                note = str(payload.get("text", "")).strip()
                if not note:
                    raise ValueError("Describe the source checked or the reason for this decision.")
                if action == "verify":
                    if not isinstance(payload.get("checks"),dict) or not all(payload["checks"].get(k) is True for k in CHECKS):
                        raise ValueError("Check each field against its source, retaining documented unknowns.")
                    if detail["open_issues"]:
                        raise ValueError("Resolve the questions or proposed corrections for this record first.")
                if action == "release" and record["verification_status"] != "verified":
                    raise ValueError("Verify this exact record before release.")
                event = dict(record_id=record["record_id"],fingerprint=record["fingerprint"],action=action,
                             reviewer=author,timestamp=stamp,note=note,checks=payload.get("checks", {}),
                             interface="local_review_workspace")
                target = self.ledger
            else:
                raise ValueError("Unknown action")
            with target.open("a") as handle:
                handle.write(json.dumps(event, ensure_ascii=False)+"\n")
                handle.flush()
                os.fsync(handle.fileno())
            return self.detail(record["record_id"])


class ReviewServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, port, store, docs=ROOT/"docs", rebuild=True):
        self.store, self.docs = store, Path(docs)
        self.token = secrets.token_urlsafe(32)
        self.build = {"status":"idle"}
        self.build_lock = threading.Lock()
        self.rebuild_enabled = rebuild
        super().__init__(("127.0.0.1", port), ReviewHandler)

    def schedule_build(self):
        if not self.rebuild_enabled or not self.build_lock.acquire(blocking=False):
            return
        self.build = {"status":"building"}
        def job():
            stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            log=ROOT/"validation"/f"review-build-{stamp}.log"
            try:
                with log.open("w") as stream:
                    result=subprocess.run(["bash","scripts/build_site.sh"],cwd=ROOT,
                        env={**os.environ,"PYTHON":sys.executable},stdout=stream,stderr=subprocess.STDOUT)
                self.build={"status":"complete" if result.returncode == 0 else "failed", "log":str(log.relative_to(ROOT))}
            except Exception as error:
                self.build={"status":"failed","error":str(error)}
            finally:
                self.build_lock.release()
        threading.Thread(target=job,daemon=True).start()


class ReviewHandler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(args[2].docs),**kwargs)

    def local_request(self, mutation=False):
        allowed={f"127.0.0.1:{self.server.server_port}",f"localhost:{self.server.server_port}"}
        host=self.headers.get("Host", "")
        if host not in allowed or self.client_address[0] != "127.0.0.1":
            return False
        origin=self.headers.get("Origin")
        if origin and origin != "http://"+host:
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            return False
        return not mutation or (origin == "http://"+host and secrets.compare_digest(self.headers.get("X-Review-Token", ""),self.server.token))

    def respond(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Content-Length",str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if not self.local_request():
            return self.respond(403,{"error":"Local review requests only"})
        url=urlsplit(self.path)
        if not url.path.startswith("/api/review/"):
            # Prevent symlinks in docs from exposing the private review ledger.
            target=Path(self.translate_path(url.path)).resolve()
            if not target.is_relative_to(self.server.docs.resolve()):
                return self.respond(403,{"error":"Outside website directory"})
            return super().do_GET()
        try:
            query={k:v[0] for k,v in parse_qs(url.query).items()}
            if url.path == "/api/review/session":
                return self.respond(200,dict(token=self.server.token,build=self.server.build))
            with self.server.store.lock:
                if url.path == "/api/review/record":
                    return self.respond(200,self.server.store.detail(query.get("id")))
                if url.path == "/api/review/records":
                    rows=self.server.store.records()
                    words=query.get("q", "").lower().split()
                    dataset=query.get("dataset", "")
                    status=query.get("status", "")
                    notes=read_notes(self.server.store.notes)
                    resolved={n.get("resolves") for n in notes if n.get("resolves")}
                    versions={r["record_id"]:r["fingerprint"] for r in rows}
                    issue_ids={n["record_id"] for n in notes if n["kind"] in {"question","correction"} and n["note_id"] not in resolved
                               and n["fingerprint"] == versions.get(n["record_id"])}
                    filtered=[r for r in rows if (not dataset or r["dataset"] == dataset) and
                              (not status or (status == "issues" and r["record_id"] in issue_ids) or
                               r["verification_status"] == status or r["publication_status"] == status) and
                              all(w in json.dumps(r,ensure_ascii=False).lower() for w in words)]
                    filtered.sort(key=lambda r:(not bool(r.get("added_date")),r.get("reference", ""),r["record_id"]))
                    page=max(0,int(query.get("page",0))); size=30
                    fields=["record_id","dataset","species","country","reference","accession","reported_lineage","verification_status","publication_status"]
                    return self.respond(200,dict(total=len(filtered),page=page,pages=max(1,(len(filtered)+size-1)//size),
                        verified=sum(r["verification_status"] == "verified" for r in rows),records=[{k:r.get(k,"") for k in fields} for r in filtered[page*size:(page+1)*size]]))
            return self.respond(404,{"error":"Endpoint not found"})
        except (ValueError,KeyError,OSError) as error:
            return self.respond(409,{"error":str(error)})

    def do_POST(self):
        if not self.local_request(mutation=True):
            return self.respond(403,{"error":"Refresh the local workspace before saving."})
        if urlsplit(self.path).path != "/api/review/action":
            return self.respond(404,{"error":"Endpoint not found"})
        try:
            length=int(self.headers.get("Content-Length",0))
            if not 0 < length <= 60000:
                raise ValueError("Request size is invalid")
            payload=json.loads(self.rfile.read(length))
            if not isinstance(payload,dict):
                raise ValueError("Expected a review action")
            with self.server.store.lock:
                if self.server.build["status"] == "building":
                    raise ValueError("The local site is rebuilding. Wait for completion before another change.")
                result=self.server.store.write(payload)
                if payload.get("action") != "note":
                    self.server.schedule_build()
            return self.respond(200,{**result,"build":self.server.build})
        except (ValueError,KeyError,OSError) as error:
            return self.respond(409,{"error":str(error)})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode",choices=["serve","note"])
    parser.add_argument("--port",type=int,default=8765)
    parser.add_argument("--record-id")
    parser.add_argument("--fingerprint")
    parser.add_argument("--author",default="Codex")
    parser.add_argument("--kind",choices=["note","question","correction"],default="note")
    parser.add_argument("--text")
    parser.add_argument("--evidence",default="")
    parser.add_argument("--field",default="")
    parser.add_argument("--proposed-value",default="")
    args=parser.parse_args()
    store=ReviewStore(ROOT/"Data/curation")
    if args.mode == "note":
        result=store.write(dict(action="note",record_id=args.record_id,fingerprint=args.fingerprint,
            author=args.author,author_role="assistant",kind=args.kind,text=args.text or "",evidence=args.evidence,
            field=args.field,proposed_value=args.proposed_value))
        print(f"Saved an assistant note for {result['record']['record_id']}; no verification changed.")
    else:
        server=ReviewServer(args.port,store)
        print(f"Review workspace: http://127.0.0.1:{args.port}/review.html",flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()

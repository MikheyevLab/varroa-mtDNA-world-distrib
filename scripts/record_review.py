#!/usr/bin/env python3
"""Manual certification is an append-only decision about an exact record version."""
import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = ROOT / "Data/curation/reviews.jsonl"
REGISTRY = ROOT / "Data/curation/registry.json"
REVIEW_FIELDS = {"fingerprint", "verification_status", "verified_by", "verified_at",
                 "verification_note", "publication_status"}


def fingerprint(record):
    # Source labels, coordinates and provenance all participate in certification.
    content = {k: v for k, v in record.items() if k not in REVIEW_FIELDS}
    raw = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def read_events(path=LEDGER):
    if not path.exists():
        return []
    events = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    for event in events:
        if event["action"] not in {"verify", "revoke", "release", "withdraw"}:
            raise ValueError("Unknown review action; refusing to publish")
        if not event.get("reviewer", "").strip() or not event.get("timestamp"):
            raise ValueError("Review log requires a named reviewer and timestamp")
    return events


def reviewed(record, events, baseline=False):
    result = {**record, "fingerprint": fingerprint(record)}
    history = [e for e in events if e["record_id"] == record["record_id"]]
    checks = [e for e in history if e["action"] in {"verify", "revoke"}]
    decision = checks[-1] if checks else None
    status = "not_verified"
    if decision and decision["action"] == "verify":
        status = "verified" if decision["fingerprint"] == result["fingerprint"] else "needs_recheck"
    result.update(verification_status=status, verified_by="", verified_at="", verification_note="")
    if decision:
        result.update(verified_by=decision["reviewer"], verified_at=decision["timestamp"],
                      verification_note=decision.get("note", ""))
    publications = [e for e in history if e["action"] in {"release", "withdraw"}]
    if publications:
        event = publications[-1]
        published = (event["action"] == "release" and status == "verified"
                     and event["fingerprint"] == result["fingerprint"])
    else:
        published = baseline  # Retain existing public evidence; do not imply it is certified.
    result["publication_status"] = "published" if published else "pending_review"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["packet", "verify", "revoke", "release", "withdraw"])
    parser.add_argument("record_id", nargs="?")
    parser.add_argument("--fingerprint", help="Exact hash from the review packet; rejects stale decisions")
    parser.add_argument("--reviewer", help="Name of the person who actually performed the review")
    parser.add_argument("--note", default="")
    parser.add_argument("--output", type=Path, help="New TSV review-packet path (never overwritten)")
    args = parser.parse_args()
    records = json.loads(REGISTRY.read_text())["records"]
    if args.action == "packet":
        if not args.output:
            parser.error("packet requires --output")
        columns = ["record_id", "dataset", "fingerprint", "verification_status", "publication_status",
                   "species", "host", "country", "reported_lineage", "reference", "source_url", "source_json"]
        with args.output.open("x", newline="") as handle:
            writer = csv.DictWriter(handle, columns, delimiter="\t")
            writer.writeheader()
            writer.writerows({k: (json.dumps(r.get("source", {}), ensure_ascii=False) if k == "source_json"
                                  else r.get(k, "")) for k in columns} for r in records)
        print(f"Wrote {len(records)} records for review. No certifications changed.")
        return
    if not args.record_id or not args.reviewer or not args.fingerprint:
        parser.error("decisions require record_id, --reviewer and --fingerprint")
    record = next((r for r in records if r["record_id"] == args.record_id), None)
    if not record or args.fingerprint != record["fingerprint"]:
        parser.error("record or fingerprint does not match; rebuild and review the current packet")
    current = reviewed(record, read_events(), record.get("origin") == "existing_resource")
    if args.action == "release" and current["verification_status"] != "verified":
        parser.error("release requires manual verification of this exact record first")
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    event = dict(record_id=args.record_id, fingerprint=args.fingerprint, action=args.action,
                 reviewer=args.reviewer.strip(), note=args.note,
                 timestamp=datetime.now(timezone.utc).isoformat())
    with LEDGER.open("a") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    print("Decision recorded. Rebuild the resource to update its badges and public files.")


if __name__ == "__main__":
    main()

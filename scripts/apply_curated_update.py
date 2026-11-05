#!/usr/bin/env python3
"""Apply the supplied 2026 evidence rows without rewriting historical CSV bytes."""
import csv
import hashlib
import io
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPDATE = ROOT / "Data/updates/2026-11-05"
BASE = "574d3064534320379bcb43adb410d7cff11ba7d0"


def parse(text):
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    rows = list(reader)
    assert all(None not in r and all(v is not None for v in r.values()) for r in rows)
    return reader.fieldnames, rows


def load_blocks():
    blocks = re.findall(r"```csv\n(.*?)```", (UPDATE / "curated_handoff.txt").read_text(), re.S)
    assert len(blocks) == 4
    return dict(zip(("P", "C", "A", "W"), (parse(b) for b in blocks)))


def main():
    blocks = load_blocks()
    report = {"baseline_commit": BASE, "tables": {}, "potential_record_differences": []}
    for kind, filename, expected in [("P", "mappingpoints_Varroareview05022020.csv", 108),
                                      ("C", "mappingcountry_Varroareview05022020.csv", 5)]:
        path = ROOT / "Data" / filename
        before = path.read_bytes()
        header, existing = parse(before.decode("utf-8-sig"))
        add_header, additions = blocks[kind]
        assert header == add_header and len(additions) == expected
        baseline = subprocess.check_output(["git", "show", f"{BASE}:Data/{filename}"], cwd=ROOT)
        base_header, base_rows = parse(baseline.decode("utf-8-sig"))
        assert header == base_header
        # Reconcile by complete records, even if this is run against a later checkout.
        old_counts, current_counts = Counter(tuple(r.values()) for r in base_rows), Counter(tuple(r.values()) for r in existing)
        assert not old_counts - current_counts, "Baseline records were changed or removed; review before applying."
        seen = set(current_counts)
        pending = []
        for number, row in enumerate(additions, 1):
            key = tuple(row[h] for h in header)
            if key in seen:
                continue
            # Flag comparable scientific records, but never collapse distinct studies or hosts.
            identity = [h for h in header if h not in ("Description", "Source")]
            accessions = set(re.findall(r"\b(?:[A-Z]{1,3}\d{5,9})\b", row["Description"]))
            for j, old in enumerate(existing, 1):
                same_fields = all(old[h] == row[h] for h in identity)
                shared = accessions.intersection(re.findall(r"\b(?:[A-Z]{1,3}\d{5,9})\b", old["Description"]))
                if same_fields or shared:
                    report["potential_record_differences"].append({
                        "input": f"{kind}{number}", "existing_data_row": j,
                        "reason": "same scientific fields; different citation/accession" if same_fields else "shared accession",
                        "shared_accessions": sorted(shared), "existing_description": old["Description"],
                        "addition_description": row["Description"], "action": "retained as separate attributed evidence"})
            pending.append(row)
            seen.add(key)
        if pending:
            buffer = io.StringIO(newline="")
            writer = csv.DictWriter(buffer, fieldnames=header, lineterminator="\r\n")
            writer.writerows(pending)
            # Append UTF-8 bytes; preserve the original header, BOM, quoting and line endings.
            with path.open("ab") as stream:
                if not before.endswith((b"\n", b"\r")):
                    stream.write(b"\r\n")
                stream.write(buffer.getvalue().encode("utf-8"))
        after = path.read_bytes()
        assert after.startswith(before)
        report["tables"][kind] = {"before": len(existing), "added": len(pending),
            "after": len(existing) + len(pending), "BOM_preserved": after[:3] == baseline[:3],
            "baseline_records_preserved": True, "sha256": hashlib.sha256(after).hexdigest()}
    # Save the separate inputs so map annotations and workbook reconstruction stay reproducible.
    for kind, name in [("P", "point_additions.csv"), ("C", "country_additions.csv"),
                       ("A", "archive_annotations.csv"), ("W", "workbook_crosswalk.csv")]:
        header, rows = blocks[kind]
        with (UPDATE / name).open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=header)
            writer.writeheader()
            writer.writerows(rows)
    points = blocks["P"][1]
    report["point_additions"] = {"coordinate_pairs": len({(r["coord.X"], r["coord.Y"]) for r in points}),
        "precision": dict(Counter(r["Coord.type"] for r in points)),
        "mt_assigned": sum(bool(r["Haplogroup"]) for r in points),
        "nuclear_only": sum(r["GROUP"] == "VD_nuclear_evidence" for r in points)}
    assert report["point_additions"] == {"coordinate_pairs": 85, "precision": {"exact": 48, "approximate": 60}, "mt_assigned": 98, "nuclear_only": 10}
    out = ROOT / "validation/2026-11-05"
    out.mkdir(parents=True, exist_ok=True)
    label = "application" if any(t["added"] for t in report["tables"].values()) else "reapplication"
    (out / f"{label}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "potential_record_differences"}, indent=2))
    print(f"Potential differences retained for review: {len(report['potential_record_differences'])}")


if __name__ == "__main__":
    main()

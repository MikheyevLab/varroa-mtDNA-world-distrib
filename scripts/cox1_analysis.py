#!/usr/bin/env python3
"""Private, reproducible COX1 comparison; no inferred label becomes verified."""
import argparse
import csv
import hashlib
import io
import json
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

from sequence_intake import read_fasta


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_once(path, text):
    path = Path(path)
    if path.exists():
        if path.read_text() != text:
            raise ValueError(f"Refusing to replace {path}; choose a new run_id")
    else:
        path.write_text(text)


def fasta(rows):
    return "".join(f">{sid}\n{seq}\n" for sid, seq in rows.items())


def tsv(rows, columns):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, columns, delimiter="\t")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue()


def validate_references(alignment, metadata, review):
    decision = json.loads(Path(review).read_text())
    if not decision.get("approved") or not decision.get("reviewer") or not decision.get("reviewed_at"):
        raise ValueError("Reference alignment and naming crosswalk need explicit manual approval")
    if decision.get("alignment_sha256") != digest(alignment) or decision.get("metadata_sha256") != digest(metadata):
        raise ValueError("References changed since approval; review the exact new files")
    refs = read_fasta(alignment)
    rows = list(csv.DictReader(io.StringIO(Path(metadata).read_text()), delimiter="\t"))
    ids = [r["sequence_id"] for r in rows]
    if len(set(ids)) != len(ids) or set(ids) != set(refs) or len(refs) < 3:
        raise ValueError("At least three reference tips, each with exactly one naming record, are required")
    if len({len(seq) for seq in refs.values()}) != 1 or any(set(seq) - set("ACGTRYSWKMBDHVN-") for seq in refs.values()):
        raise ValueError("References must be an aligned DNA window of equal length")
    if any(not r.get("canonical_lineage") or not r.get("reference") for r in rows):
        raise ValueError("Each reference needs a lineage label and citation")
    return refs, rows


def prepare(args):
    refs, metadata = validate_references(args.references, args.metadata, args.review)
    intake = Path(args.intake)
    queries = read_fasta(intake / "sequences.fasta")
    checks = list(csv.DictReader(io.StringIO((intake / "qc.tsv").read_text()), delimiter="\t"))
    passed = {r["sequence_id"] for r in checks if r["status"] == "candidate_pass"}
    queries = {k:v for k,v in queries.items() if k in passed}
    if not queries:
        raise ValueError("No sequences pass intake QC; inspect the quarantine reasons")
    if set(queries) & set(refs):
        raise ValueError("Query and reference IDs must be distinct")
    paths = [intake / p for p in ["sequences.fasta", "records.json", "qc.tsv", "manifest.json"]]
    paths += [Path(args.references), Path(args.metadata), Path(args.review)]
    manifest = dict(inputs={str(p):digest(p) for p in paths}, reference_ids=list(refs), query_ids=list(queries),
                    method="COX1 reference-window comparison; manual interpretation required")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    write_once(out / "inputs.json", json.dumps(manifest, indent=2))
    write_once(out / "references.fasta", fasta(refs))
    write_once(out / "queries.fasta", fasta(queries))


def align(args):
    out = Path(args.out)
    if (out / "aligned.fasta").exists():
        raise ValueError("Alignment already exists; preserve it and use a new run_id")
    command = ["mafft", "--auto", "--thread", str(args.threads), "--adjustdirectionaccurately", "--addfragments",
               str(out / "queries.fasta"), "--mapout", str(out / "references.fasta")]
    # mapout keeps the reference window and records discarded query insertions.
    result = subprocess.run(command, text=True, capture_output=True)
    write_once(out / "mafft.log", result.stderr)
    result.check_returncode()
    write_once(out / "aligned.fasta", result.stdout)
    write_once(out / "mafft_command.json", json.dumps(command))


def compare(args):
    out = Path(args.out)
    alignment = read_fasta(out / "aligned.fasta")
    manifest = json.loads((out / "inputs.json").read_text())
    # MAFFT prefixes reversed sequences with _R_; retain this orientation in the QC output.
    reverse = {sid[3:] for sid in alignment if sid.startswith("_R_")}
    aligned = {}
    for sid, seq in alignment.items():
        key = sid[3:] if sid.startswith("_R_") else sid
        if key in aligned:
            raise ValueError("Orientation normalization caused duplicate sequence IDs")
        aligned[key] = seq
    if set(aligned) != set(manifest["reference_ids"] + manifest["query_ids"]) or len({len(s) for s in aligned.values()}) != 1:
        raise ValueError("Alignment lost IDs or has unequal sequence lengths")
    if any(sid in reverse for sid in manifest["reference_ids"]):
        raise ValueError("A reference was reverse-complemented; check the curated alignment orientation")
    meta = {r["sequence_id"]:r for r in csv.DictReader(io.StringIO(Path(args.metadata).read_text()), delimiter="\t")}
    keep = {sid:aligned[sid] for sid in manifest["reference_ids"]}
    comparisons, checks = [], []
    for sid in manifest["query_ids"]:
        seq = aligned[sid]
        informative = sum(c in "ACGT" for c in seq)
        nongap = sum(c != "-" for c in seq)
        ambiguity = (nongap-informative)/max(1,nongap)
        candidates = []
        for rid in manifest["reference_ids"]:
            pairs = [(a,b) for a,b in zip(seq,aligned[rid]) if a in "ACGT" and b in "ACGT"]
            overlap = len(pairs)
            if overlap >= args.min_overlap:
                mismatch = sum(a != b for a,b in pairs)
                candidates.append((Fraction(mismatch,overlap),rid,overlap,mismatch))
        status = "eligible_for_tree" if candidates and ambiguity <= args.max_ambiguity else "unresolved_insufficient_overlap_or_quality"
        if status == "eligible_for_tree":
            keep[sid] = seq
        checks.append(dict(sequence_id=sid, status=status, orientation="reverse_complemented" if sid in reverse else "as_supplied",
                           informative_sites=informative, ambiguity_fraction=round(ambiguity,6)))
        best = min((c[0] for c in candidates), default=None)
        nearest = [c for c in candidates if c[0] == best]
        lineages = sorted({meta[c[1]]["canonical_lineage"] for c in nearest})
        for distance,rid,overlap,mismatch in sorted(candidates):
            comparisons.append(dict(sequence_id=sid, reference_id=rid, reference_lineage=meta[rid]["canonical_lineage"],
                overlap_sites=overlap, mismatches=mismatch, p_distance=float(distance), nearest_tie=distance==best,
                candidate_labels=";".join(lineages), interpretation="unresolved_quality" if status != "eligible_for_tree" else "unresolved_tied_labels" if len(lineages)>1 else "provisional_similarity_only",
                verification_status="not_verified"))
    write_once(out / "overlap_qc.tsv", tsv(checks, ["sequence_id","status","orientation","informative_sites","ambiguity_fraction"]))
    write_once(out / "reference_comparisons.tsv", tsv(comparisons, ["sequence_id","reference_id","reference_lineage","overlap_sites","mismatches","p_distance","nearest_tie","candidate_labels","interpretation","verification_status"]))
    if len(keep) <= len(manifest["reference_ids"]):
        raise ValueError("No query has enough homologous overlap; QC files saved, tree withheld")
    write_once(out / "tree_input.fasta", fasta(keep))


def tree(args):
    out = Path(args.out)
    if (out / "tree.treefile").exists():
        raise ValueError("A completed tree already exists; choose a new run_id")
    program = shutil.which("iqtree2") or shutil.which("iqtree")
    if not program:
        raise ValueError("IQ-TREE is unavailable; run Snakemake with --use-conda")
    command = [program,"-s",str(out/"tree_input.fasta"),"-st","DNA","-m","MFP","-bb","1000","-alrt","1000",
               "-bnni","-nt",str(args.threads),"-seed",str(args.seed),"-keep-ident","-pre",str(out/"tree")]
    write_once(out / "iqtree_command.json", json.dumps(command))
    subprocess.run(command, check=True)  # No -redo: IQ-TREE can resume an interrupted run.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step", choices=["prepare","align","compare","tree"])
    parser.add_argument("--out", required=True)
    for flag in ["intake","references","metadata","review"]:
        parser.add_argument("--"+flag)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20261105)
    parser.add_argument("--min-overlap", type=int, default=300)
    parser.add_argument("--max-ambiguity", type=float, default=.02)
    args = parser.parse_args()
    if args.threads < 1 or args.min_overlap < 1 or not 0 <= args.max_ambiguity <= 1:
        parser.error("Invalid thread, overlap or ambiguity setting")
    globals()[args.step](args)


if __name__ == "__main__":
    main()

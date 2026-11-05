#!/usr/bin/env python3
"""Build an unverified COX1 tree for local review, without approving lineage names."""
import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

from cox1_analysis import digest, fasta, tsv, write_once
from sequence_intake import read_fasta
from phylogeny_record_links import write_links

ANCHOR = "AF106899.1"


def accessions(text):
    """Expand explicit accession ranges; retain compressed catalogue suffixes."""
    result, previous = set(), None
    for token in re.split(r"[,;\s]+", text.strip()):
        match = re.fullmatch(r"([A-Z]+_?)(\d+)(?:\.\d+)?(?:[-–]([A-Z]+_?)?(\d+))?", token)
        if match:
            prefix, digits, end_prefix, end = match.groups()
            previous = (prefix, digits)
            if end:
                if end_prefix and end_prefix != prefix:
                    raise ValueError("Mixed-prefix accession range")
                end = digits[:-len(end)] + end if len(end) < len(digits) else end
                if not 0 <= int(end)-int(digits) <= 10000:
                    raise ValueError("Invalid accession range")
                result.update(prefix + str(i).zfill(len(digits)) for i in range(int(digits), int(end)+1))
            else:
                result.add(prefix + digits)
        elif token.isdigit() and previous:
            prefix, digits = previous
            result.add(prefix + digits[:-len(token)] + token)
    return result


def annotations(path):
    """Labels are source annotations, never sequence-inferred assignments."""
    result = defaultdict(list)
    for row in json.loads(Path(path).read_text())["records"]:
        if row["dataset"] == "reference":
            ids = accessions(row["accession"])
            label = row["reported_lineage"] or row.get("canonical_lineage", "")
        elif row["dataset"] == "map":
            desc = row["source"].get("Description", "")
            tokens = re.findall(r"\b[A-Z]{1,3}_?\d{5,9}(?:[-–](?:[A-Z]{1,3}_?)?\d{2,9})?\b", desc)
            ids = accessions(" ".join(tokens))
            label = row["reported_lineage"]
        else:
            continue
        for accession in ids:
            item = dict(record_id=row["record_id"], label=label, reference=row["reference"],
                        country=row.get("country", ""), host=row.get("host", ""),
                        catalogue_label=row.get("canonical_lineage", ""))
            if item not in result[accession]:
                result[accession].append(item)
    return result


def prepare(args):
    out = Path(args.out)
    intake = Path(args.intake)
    rows = json.loads((intake / "records.json").read_text())["records"]
    seqs = read_fasta(intake / "sequences.fasta")
    if len({r["accession"] for r in rows}) != len(rows):
        raise ValueError("Deduplicate accession versions before analysis")
    ann = annotations(args.catalogue)
    candidates, backbone, metadata = {}, {}, {}
    for row in rows:
        ac = row["accession"]
        row["source_annotations"] = ann.get(ac.split(".")[0], [])
        metadata[ac] = row
        if row["source"]["automated_qc"] != "candidate_pass":
            continue
        seq = seqs[row["record_id"]]
        # Historical sequences span the comparison window across Varroa species.
        if ac.split(".")[0] in {"AF"+str(i) for i in range(106893,106911)} | {"AF107260","AF107261","NC_004454"}:
            backbone[ac] = seq
        else:
            candidates[ac] = seq
    if ANCHOR not in backbone or "NC_004454.2" not in backbone or len(backbone[ANCHOR]) != 458 or len(backbone) < 10:
        raise ValueError("Historical COX1 coordinate anchors are incomplete")
    out.mkdir(parents=True, exist_ok=True)
    manifest = dict(status="draft_not_manually_verified", anchor=ANCHOR, window_bases=458,
                    minimum_overlap=args.min_overlap, max_ambiguity=.02, maximum_anchor_p_distance=.15, intake=str(intake),
                    naming="Reported source labels only; no canonical lineage assigned", 
                    inputs={str(p):digest(p) for p in [intake/"sequences.fasta",intake/"records.json",intake/"manifest.json",Path(args.catalogue)]})
    write_once(out/"inputs.json", json.dumps(manifest, indent=2))
    write_once(out/"metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2))
    write_once(out/"backbone_unaligned.fasta", fasta(backbone))
    write_once(out/"queries.fasta", fasta(candidates))
    print(json.dumps(dict(records=len(rows), candidates=len(candidates), backbone=len(backbone))))


def run_logged(command, output, log):
    if output.exists():
        raise ValueError(f"Preserving {output}; use a new run directory")
    with output.open("x") as stdout, log.open("x") as stderr:
        subprocess.run(command, stdout=stdout, stderr=stderr, text=True, check=True)
    write_once(output.with_suffix(".command.json"), json.dumps(command, indent=2))


def align(args):
    out = Path(args.out)
    run_logged(["mafft","--progress",str((out/"backbone_progress.log").resolve()),"--auto","--thread",str(args.threads),"--adjustdirectionaccurately",
                str(out/"backbone_unaligned.fasta")], out/"backbone_aligned.fasta",out/"backbone_mafft.log")
    run_logged(["mafft","--progress",str((out/"fragments_progress.log").resolve()),"--auto","--thread",str(args.threads),"--adjustdirectionaccurately","--addfragments",
                str(out/"queries.fasta"),"--mapout",str(out/"backbone_aligned.fasta")],out/"aligned.fasta",out/"fragments_mafft.log")


def select_window(aligned, anchor):
    positions = [i for i,c in enumerate(aligned[anchor]) if c != "-"]
    if len(positions) != 458:
        raise ValueError("Coordinate anchor changed length")
    return {k:"".join(v[i] for i in positions) for k,v in aligned.items()}, positions


def summarize(args):
    out = Path(args.out)
    manifest = json.loads((out/"inputs.json").read_text())
    metadata = json.loads((out/"metadata.json").read_text())
    raw = read_fasta(out/"aligned.fasta")
    aligned = {k.removeprefix("_R_"):v for k,v in raw.items()}
    expected = {ac for ac,r in metadata.items() if r["source"]["automated_qc"] == "candidate_pass"}
    if len(aligned) != len(raw) or set(aligned) != expected or len({len(s) for s in aligned.values()}) != 1:
        raise ValueError("Alignment IDs or lengths differ from inputs")
    window, positions = select_window(aligned, manifest["anchor"])
    anchors = [a for a in window if a.startswith("AF10")]
    passed, checks = {}, []
    # Match the coordinate anchor's annotated frame after trimming to its window.
    frame = int(metadata[ANCHOR]["source"]["feature"]["codon_start"])-1
    for ac,row in metadata.items():
        seq = window.get(ac, "")
        coverage = sum(c in "ACGT" for c in seq)
        nongap = sum(c != "-" for c in seq)
        ambiguous = sum(c not in "ACGT-" for c in seq)/max(1,nongap)
        stop = any(seq[i:i+3] in {"TAA","TAG"} for i in range(frame,len(seq)-3,3))
        distances = []
        for ref in anchors:
            pairs = [(a,b) for a,b in zip(seq,window[ref]) if a in "ACGT" and b in "ACGT"]
            if len(pairs) >= manifest["minimum_overlap"]:
                distances.append(sum(a != b for a,b in pairs)/len(pairs))
        closest = min(distances,default=1)
        status = row["source"]["automated_qc"]
        if status == "candidate_pass":
            status = "included" if coverage >= manifest["minimum_overlap"] and ambiguous <= .02 and not stop else "insufficient_window_overlap" if coverage < manifest["minimum_overlap"] else "ambiguous_window" if ambiguous > .02 else "stop_in_aligned_window"
            if status == "included" and closest > manifest["maximum_anchor_p_distance"]:
                status = "divergent_alignment_needs_review"
        if status == "included":
            passed[ac] = seq
        checks.append(dict(accession=ac,status=status,window_sites=coverage,window_length=458,
                           ambiguity_fraction=round(ambiguous,6),nearest_anchor_p_distance=round(closest,6),reverse_complemented="_R_"+ac in raw))
    groups = defaultdict(list)
    for ac,seq in passed.items():
        groups[seq].append(ac)
    # Exact aligned strings only; missing data are never treated as matching bases.
    patterns, membership = {}, {}
    for seq,members in sorted(groups.items(), key=lambda item: sorted(item[1])[0]):
        gid = "G_"+hashlib.sha256(seq.encode()).hexdigest()[:12]
        patterns[gid] = seq
        membership[gid] = sorted(members)
    if len(patterns) < 4:
        raise ValueError("Too few distinct sequences for a tree")
    counts = Counter(r["status"] for r in checks)
    summary = dict(records=len(metadata), included=len(passed), excluded=len(metadata)-len(passed),
                   sequence_groups=len(patterns), window_length=458, min_overlap=manifest["minimum_overlap"],
                   qc_counts=counts, species=dict(Counter(metadata[a]["species"] for a in passed)),
                   invariant_sites=sum(len({s[i] for s in patterns.values() if s[i] in "ACGT"}) == 1 for i in range(458)))
    write_once(out/"window_alignment.fasta",fasta(passed))
    write_once(out/"tree_input.fasta",fasta(patterns))
    write_once(out/"groups.json",json.dumps(membership,indent=2))
    write_once(out/"window_qc.tsv",tsv(checks,list(checks[0])))
    write_once(out/"window_columns.json",json.dumps([i+1 for i in positions]))
    write_once(out/"summary.json",json.dumps(summary,indent=2))
    # A comparison is descriptive; keep all closest-reference ties and overlap sizes.
    refs = [a for a in passed if any(n["record_id"].startswith("R") for n in metadata[a]["source_annotations"])]
    comparisons = []
    for ac in passed:
        if not any(n["label"] == "type T" for n in metadata[ac]["source_annotations"]):
            continue
        for ref in refs:
            pairs = [(a,b) for a,b in zip(passed[ac],passed[ref]) if a in "ACGT" and b in "ACGT"]
            if len(pairs) < manifest["minimum_overlap"]:
                continue
            comparisons.append(dict(accession=ac, reference_accession=ref,
                reported_reference_labels="; ".join(sorted({n["label"] for n in metadata[ref]["source_annotations"] if n["record_id"].startswith("R")})),
                overlap=len(pairs), mismatches=sum(a != b for a,b in pairs), status="not_manually_verified"))
    write_once(out/"taiwan_reference_comparisons.tsv",tsv(comparisons,["accession","reference_accession","reported_reference_labels","overlap","mismatches","status"]))
    print(json.dumps(summary,indent=2))


def bundle(args):
    from Bio import Phylo
    out = Path(args.out)
    tree = Phylo.read(out/"tree.treefile", "newick")
    groups = json.loads((out/"groups.json").read_text())
    if {t.name for t in tree.get_terminals()} != set(groups):
        raise ValueError("Tree tips differ from analyzed sequence groups")
    metadata = json.loads((out/"metadata.json").read_text())
    summary = json.loads((out/"summary.json").read_text())
    report = (out/"tree.iqtree").read_text()
    model = re.search(r"Best-fit model according to BIC:\s*(\S+)",report)
    if not model:
        raise ValueError("Completed ModelFinder report is required")
    tree.ladderize()
    def encode(clade):
        value = dict(name=clade.name or "", length=clade.branch_length or 0)
        if clade.is_terminal():
            value["members"] = groups[clade.name]
        else:
            value["children"] = [encode(c) for c in clade.clades]
            value["support"] = clade.name or str(clade.confidence or "")
        return value
    members = {}
    for ac in sorted({a for ids in groups.values() for a in ids}):
        r = metadata[ac]
        members[ac] = dict(accession=ac,species=r["species"],country=r["country"],host=r["host"],
            reference=r["reference"],source_url=r["source_url"],reported_lineage=r["reported_lineage"],
            source_annotations=r["source_annotations"],verification_status="not_verified")
    payload = dict(status="draft_not_manually_verified",run_id=out.name,summary=summary,model=model.group(1),
                   tree=encode(tree.root),members=members,method=dict(alignment="MAFFT 7.526",inference="IQ-TREE 2.3.6",
                   window="458 bases in AF106899.1 coordinates",rooting="Unrooted inference; drawing root is arbitrary",
                   bootstrap=1000,sh_alrt=1000,seed=20261105))
    write_once(out/"tree.json",json.dumps(payload,ensure_ascii=False))
    write_links(out/"tree.json", out/"metadata.json", out/"record_links.json")
    dest = Path(args.preview)
    dest.mkdir(parents=True,exist_ok=True)
    # This ignored directory is a localhost preview, not a released dataset.
    for filename in ["tree.json","tree.treefile","tree.iqtree","tree.log","window_alignment.fasta","tree_input.fasta","window_qc.tsv","taiwan_reference_comparisons.tsv","inputs.json","groups.json","record_links.json"]:
        target = dest/filename
        if target.exists() and digest(target) != digest(out/filename):
            raise ValueError("Preserve earlier review bundles in a separate folder")
        if not target.exists():
            shutil.copy2(out/filename,target)
    print(json.dumps(dict(preview=str(dest),tips=len(groups),model=model.group(1))))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step",choices=["prepare","align","summarize","bundle"])
    parser.add_argument("--out",required=True)
    parser.add_argument("--intake")
    parser.add_argument("--catalogue",default="docs/data/records.json")
    parser.add_argument("--threads",type=int,default=4)
    parser.add_argument("--min-overlap",type=int,default=400)
    parser.add_argument("--preview",default="docs/data/phylogeny-review/cox1_20261105")
    args = parser.parse_args()
    globals()[args.step](args)


if __name__ == "__main__":
    main()

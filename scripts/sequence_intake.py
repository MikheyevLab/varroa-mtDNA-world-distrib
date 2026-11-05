#!/usr/bin/env python3
"""Collect COX1 candidates into a new review folder; never write public data."""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
QUERY = 'Varroa[Organism] AND (COX1[Gene Name] OR COI[Gene Name] OR CO1[Gene Name] OR "cytochrome oxidase subunit I"[Title] OR "cytochrome c oxidase subunit I"[Title] OR mitochondrion[Title])'
DNA = set("ACGTRYSWKMBDHVN")


def read_fasta(path):
    records, name, parts = {}, None, []
    for line in Path(path).read_text().splitlines():
        if line.startswith(">"):
            if name:
                records[name] = "".join(parts).upper()
            name = line[1:].split()[0]
            if not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name in records:
                raise ValueError("FASTA identifiers must be unique letters, digits, dots, underscores or hyphens")
            parts = []
        elif line.strip():
            if name is None:
                raise ValueError("Sequence before FASTA header")
            parts.append(line.strip())
    if name:
        records[name] = "".join(parts).upper()
    if not records:
        raise ValueError("Empty FASTA")
    return records


def qc(sequence, min_length=300, max_length=2000, max_ambiguity=0.02, codon_start=None):
    issues = []
    if set(sequence) - DNA:
        issues.append("invalid_DNA_characters")
    if not min_length <= len(sequence) <= max_length:
        issues.append("length_outside_configured_range")
    ambiguity = sum(base not in "ACGT" for base in sequence) / max(1, len(sequence))
    if ambiguity > max_ambiguity:
        issues.append("too_many_ambiguous_bases")
    # Code 5 (invertebrate mitochondria): TGA is tryptophan, not a stop codon.
    if codon_start in {1, 2, 3}:
        codons = [sequence[i:i+3] for i in range(codon_start-1, len(sequence)-2, 3)]
        if any(c in {"TAA", "TAG"} for c in codons[:-1]):
            issues.append("internal_stop_in_annotated_frame")
    return issues


def request(endpoint, parameters):
    values = {**parameters, "tool":"varroa_evidence_atlas"}
    if os.getenv("NCBI_EMAIL"):
        values["email"] = os.environ["NCBI_EMAIL"]
    if os.getenv("NCBI_API_KEY"):
        values["api_key"] = os.environ["NCBI_API_KEY"]
    data = urllib.parse.urlencode(values).encode()
    # Stay below the unauthenticated NCBI limit, including when a key is present.
    for attempt in range(4):
        time.sleep(0.4 if attempt == 0 else 2 ** attempt)
        try:
            with urllib.request.urlopen(urllib.request.Request(BASE + endpoint, data=data), timeout=90) as response:
                return response.read()
        except (OSError, ValueError):
            if attempt == 3:
                raise RuntimeError(f"NCBI {endpoint} failed after retries; raw completed batches are retained") from None


def is_cox1(qualifiers):
    gene = re.sub(r"[^A-Z0-9]", "", qualifiers.get("gene", "").upper())
    product = qualifiers.get("product", "").lower()
    return gene in {"COX1", "COI", "CO1", "COXI"} or bool(re.search(r"cytochrome(?: c)? (?:oxidase|c oxidase) subunit (?:i|1)\b", product))


def genbank_records(xml, run_id, stamp):
    root = ET.fromstring(xml)
    if root.find(".//ERROR") is not None:
        raise ValueError("NCBI returned an error instead of sequence records")
    for entry in root.findall("GBSeq"):
        get = lambda key: entry.findtext("GBSeq_" + key, "")
        accession, full = get("accession-version"), get("sequence").upper()
        features, source = [], {}
        for feature in entry.findall("./GBSeq_feature-table/GBFeature"):
            quals = {q.findtext("GBQualifier_name"): q.findtext("GBQualifier_value", "")
                     for q in feature.findall("./GBFeature_quals/GBQualifier")}
            if feature.findtext("GBFeature_key") == "source":
                source = quals
            if feature.findtext("GBFeature_key") in {"gene", "CDS"} and is_cox1(quals):
                features.append((feature, quals))
        coding = [f for f in features if f[0].findtext("GBFeature_key") == "CDS"]
        features = coding or features
        reason, extracted, feature_info = "", "", {}
        if len(features) != 1:
            reason = "no_unique_annotated_COX1_feature"
        else:
            feature, quals = features[0]
            feature_info = {"location":feature.findtext("GBFeature_location", ""), **quals}
            intervals = feature.findall("./GBFeature_intervals/GBInterval")
            if len(intervals) != 1:
                reason = "compound_or_missing_location_needs_review"
            else:
                interval = intervals[0]
                start, end = interval.findtext("GBInterval_from"), interval.findtext("GBInterval_to")
                remote = interval.findtext("GBInterval_accession", accession)
                if not start or not end or remote.split(".")[0] != accession.split(".")[0]:
                    reason = "unsupported_feature_coordinates"
                else:
                    start, end = int(start), int(end)
                    if not 1 <= min(start,end) <= max(start,end) <= len(full):
                        reason = "feature_outside_sequence"
                    else:
                        extracted = full[min(start,end)-1:max(start,end)]
                        comp = interval.find("GBInterval_iscomp")
                        if start > end or (comp is not None and comp.get("value") == "true"):
                            extracted = extracted.translate(str.maketrans("ACGTRYSWKMBDHVN", "TGCAYRSWMKVHDBN"))[::-1]
        issues = [reason] if reason else qc(extracted, codon_start=int(feature_info.get("codon_start", "1")) if coding else None)
        refs = [r.findtext("GBReference_title", "") for r in entry.findall("./GBSeq_references/GBReference")]
        date_iso = lambda text: datetime.strptime(text, "%d-%b-%Y").date().isoformat() if text else ""
        sid = "Q_" + hashlib.sha256((run_id + accession).encode()).hexdigest()[:16]
        record = dict(record_id=sid, dataset="ncbi", species=get("organism"), host=source.get("host", ""),
            country=source.get("geo_loc_name", source.get("country", "")), collection_year=source.get("collection_date", ""),
            reported_lineage=source.get("haplotype", ""), reference="; ".join(refs), accession=accession,
            source_url=f"https://www.ncbi.nlm.nih.gov/nuccore/{accession}", added_date=stamp[:10],
            ncbi_created=date_iso(get("create-date")), ncbi_updated=date_iso(get("update-date")), snapshot_date=stamp[:10],
            source=dict(definition=get("definition"), gene="COX1" if extracted else "Unresolved", qualifiers=source,
                feature=feature_info, sequence_sha256=hashlib.sha256(extracted.encode()).hexdigest() if extracted else "",
                full_sequence_sha256=hashlib.sha256(full.encode()).hexdigest(), length=len(extracted),
                automated_qc=";".join(issues) or "candidate_pass", translation_check="annotated_frame" if coding else "not_checked",
                retrieved_at=stamp, marker_status="annotated_COX1_candidate" if extracted else "requires_manual_extraction"))
        yield record, extracted, issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["ncbi", "paper"])
    parser.add_argument("--run-id", required=True, help="New folder name; reuse is refused")
    parser.add_argument("--query", default=QUERY)
    parser.add_argument("--accessions", type=Path, help="One full accession per line; no compressed accession lists")
    parser.add_argument("--limit", type=int, help="Optional pilot cap; omit for the complete query")
    parser.add_argument("--fasta", type=Path)
    parser.add_argument("--metadata", type=Path, help="Paper TSV: sequence_id, reference, source_url, reported_lineage, species, host, country")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("run-id must use letters, numbers, underscores or hyphens")
    if args.limit is not None and args.limit < 1:
        parser.error("limit must be positive")
    if args.mode == "paper" and (not args.fasta or not args.metadata):
        parser.error("paper intake requires --fasta and --metadata")
    dest = ROOT / "Data/intake" / args.run_id
    dest.mkdir(parents=True, exist_ok=False)
    raw = dest / "raw"
    raw.mkdir()
    stamp = datetime.now(timezone.utc).isoformat()
    rows, sequences, checks = [], {}, []
    manifest = dict(run_id=args.run_id, retrieved_at=stamp, mode=args.mode, publication_status="pending_review")
    if args.mode == "ncbi":
        if args.accessions:
            ids = [v.strip() for v in args.accessions.read_text().splitlines() if v.strip()]
            if any(not re.fullmatch(r"[A-Za-z]+_?\d+(?:\.\d+)?", a) for a in ids):
                raise ValueError("Use complete accessions, not abbreviated ranges")
            ids = list(dict.fromkeys(ids))
            shutil.copy2(args.accessions, raw / "requested_accessions.txt")
        else:
            ids = []
            offset, count = 0, None
            while count is None or offset < count:
                xml = request("esearch.fcgi", dict(db="nuccore", term=args.query, retstart=offset, retmax=500, sort="Date Released"))
                (raw / f"search_{offset:08d}.xml").write_bytes(xml)
                result = ET.fromstring(xml)
                count = int(result.findtext("Count"))
                batch = [e.text for e in result.findall("./IdList/Id")]
                ids.extend(batch)
                offset += len(batch)
                if not batch and offset < count:
                    raise ValueError("Incomplete NCBI pagination")
                if args.limit and len(ids) >= args.limit:
                    break
            manifest.update(query=args.query, query_total=count)
        requested = ids[:args.limit] if args.limit else ids
        manifest.update(requested_count=len(requested), pilot_limit=args.limit, complete_query=not args.limit)
        for index in range(0, len(requested), 100):
            xml = request("efetch.fcgi", dict(db="nuccore", id=",".join(requested[index:index+100]), rettype="gb", retmode="xml"))
            (raw / f"genbank_{index:08d}.xml").write_bytes(xml)
            batch = list(genbank_records(xml, args.run_id, stamp))
            if len(batch) != len(requested[index:index+100]):
                raise ValueError("NCBI fetch count differs from requested batch; nothing released")
            for record, sequence, issues in batch:
                rows.append(record)
                if sequence:
                    sequences[record["record_id"]] = sequence
                checks.append(dict(sequence_id=record["record_id"], status=";".join(issues) or "candidate_pass"))
    else:
        original = read_fasta(args.fasta)
        metadata = list(csv.DictReader(io.StringIO(args.metadata.read_text()), delimiter="\t"))
        ids = [r.get("sequence_id") for r in metadata]
        if len(set(ids)) != len(ids) or set(ids) != set(original):
            raise ValueError("Each FASTA ID needs exactly one metadata row")
        shutil.copy2(args.fasta, raw / "paper.fasta")
        shutil.copy2(args.metadata, raw / "paper_metadata.tsv")
        for meta in metadata:
            if not meta.get("reference", "").strip() or not meta.get("source_url", "").startswith(("https://", "http://")):
                raise ValueError("Every paper sequence needs a citation and source URL")
            old_id = meta["sequence_id"]
            sid = "Q_" + hashlib.sha256((args.run_id + old_id).encode()).hexdigest()[:16]
            sequence = original[old_id]
            issues = qc(sequence)
            row = {k: meta.get(k, "") for k in ["species", "host", "country", "reported_lineage", "reference", "source_url"]}
            row.update(record_id=sid, dataset="sequence", accession=meta.get("accession", ""), added_date=stamp[:10],
                source=dict(original_id=old_id, metadata=meta, sequence_sha256=hashlib.sha256(sequence.encode()).hexdigest(),
                    length=len(sequence), automated_qc=";".join(issues) or "candidate_pass", marker_status="paper_reported_COX1",
                    translation_check="not_checked_no_annotated_frame", retrieved_at=stamp))
            rows.append(row)
            sequences[sid] = sequence
            checks.append(dict(sequence_id=sid, status=";".join(issues) or "candidate_pass"))
    (dest / "records.json").write_text(json.dumps(dict(records=rows), ensure_ascii=False, indent=2))
    (dest / "sequences.fasta").write_text("".join(f">{sid}\n{seq}\n" for sid, seq in sequences.items()))
    with (dest / "qc.tsv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, ["sequence_id", "status"], delimiter="\t")
        writer.writeheader()
        writer.writerows(checks)
    manifest.update(records=len(rows), sequences=len(sequences),
        raw_files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in raw.iterdir()})
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Queued {len(rows)} records and {len(sequences)} sequences in {dest}; none published or verified.")


if __name__ == "__main__":
    main()

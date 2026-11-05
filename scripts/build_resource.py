#!/usr/bin/env python3
"""Build static resource pages from source records and explicit manual decisions."""
import csv
import hashlib
import html
import json
import re
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook  # Read the workbook; never modify its cells.
from record_review import ROOT, reviewed, read_events, REVIEW_FIELDS

DOCS = ROOT / "docs"
DATA = DOCS / "data"
CURATION = ROOT / "Data/curation"


def clean(value):
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    return str(value)


def normalized(rid, dataset, source, **values):
    return dict(record_id=rid, dataset=dataset, origin="existing_resource", source=source, **values)


def collect():
    records = []
    for raw in json.loads((CURATION / "map_records.json").read_text()):
        row = {k: v for k, v in raw.items() if k not in REVIEW_FIELDS}
        records.append(normalized(row["record_id"], "map", row, species=row["Species"], host=row["Host"],
            country=row["Location"], locality="" if str(row.get("Region", "")).startswith("Year:") else row.get("Region", ""), collection_year=row["Year"],
            reported_lineage=row["reported_mt"], reference=row["reference"],
            added_date="2026-11-05" if row["is_new"] else "", source_url="", accession=""))
    workbook = load_workbook(ROOT / "Data/Database_mtDNA_updated_2026.xlsx", read_only=True, data_only=True)
    sheets = [("ncbi", "Table Data S1_Genbank_02Oct2021", "N"),
              ("literature", "Table Data S2_Data_papers", "L"),
              ("reference", "Table DataS3_Haplotype_Cox1_458", "R")]
    for dataset, sheet, prefix in sheets:
        rows = workbook[sheet].iter_rows(values_only=True)
        header = [clean(v) or f"Notes_{i+1}" for i, v in enumerate(next(rows))]
        for number, cells in enumerate(rows, 2):
            source = {k: clean(v) for k, v in zip(header, cells)}
            if not any(source.values()):
                continue
            source["workbook_sheet"] = sheet
            source["workbook_row"] = number
            if dataset == "ncbi":
                accession = source["Accession"]
                values = dict(species=source["Species"], host=source["Host"], country=source["Country"],
                    collection_year=source["Collection_date"], reported_lineage=source["Haplogroup identity"],
                    reference=source["Title"], accession=accession, added_date="", ncbi_created=source["Create date"],
                    ncbi_updated=source["Update date"], snapshot_date="2021-10-02",
                    source_url=f"https://www.ncbi.nlm.nih.gov/nuccore/{accession}")
            elif dataset == "literature":
                values = dict(species=source["Species"], host=source["Host"], country=source["Country"],
                    locality=source["Region"], collection_year=source["Year"], reported_lineage=source["Haplogroup_reported"],
                    reference=source["Reference"], accession="", added_date="2026-11-05" if number >= 933 else "",
                    source_url="https://doi.org/" + source["DOI"].removeprefix("https://doi.org/") if source["DOI"] else "")
            else:
                values = dict(species=source["Varroa species"], host=source["Host"], country="", collection_year="",
                    reported_lineage=source["Haplotype original ID"], canonical_lineage=source["Mitochondrial Haplogroup"],
                    reference=source["Reference"], accession=source["Genbank accessions"], added_date="", source_url="")
            records.append(normalized(f"{prefix}{number-1}", dataset, source, **values))
    workbook.close()
    # Importers can only supply evidence. Reserved review fields are discarded.
    seen = {r["record_id"] for r in records}
    for path in sorted((ROOT / "Data/intake").glob("*/records.json")):
        for raw in json.loads(path.read_text())["records"]:
            row = {k: v for k, v in raw.items() if k not in REVIEW_FIELDS}
            if row["record_id"] in seen:
                raise ValueError(f"Duplicate record ID {row['record_id']}: resolve in the review queue")
            if row["dataset"] not in {"ncbi", "literature", "sequence"}:
                raise ValueError("Unsupported imported dataset")
            row["origin"] = "import_queue"
            row["intake_path"] = str(path.relative_to(ROOT))
            seen.add(row["record_id"])
            records.append(row)
    return records


def write_tsv(path, rows):
    columns = ["record_id", "dataset", "verification_status", "verified_by", "verified_at", "verification_note",
               "fingerprint", "species", "host", "country", "locality", "collection_year", "reported_lineage",
               "canonical_lineage", "accession", "reference", "source_url", "added_date", "ncbi_created",
               "ncbi_updated", "snapshot_date", "publication_status", "source_json"]
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, columns, delimiter="\t")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(row["source"], ensure_ascii=False) if k == "source_json"
                             else row.get(k, "") for k in columns})


def page_document(name, title, body, asset_prefix="assets", head_before=""):
    # Every public page, including the R-rendered Maps page, uses this same shell.
    links = [("index", "Home"), ("records", "Records"), ("maps", "Maps"), ("phylogeny", "Phylogeny")]
    nav = "".join(f'<a href="{file}.html" {"aria-current=page" if file == name else ""}>{label}</a>' for file, label in links)
    scripts = f'<script src="{asset_prefix}/resource.js" defer></script><script src="{asset_prefix}/local_review.js" defer></script>'
    if name == "index":
        # Old bookmarked map URLs retain their filters, location and anchors.
        scripts += '<script>if(new URLSearchParams(location.search).has("host")||new URLSearchParams(location.search).has("scope")||["#explore-the-evidence","#new-evidence-locations-only","#what-changed-in-november-2026","#data-and-original-review"].includes(location.hash)){location.replace("maps.html"+location.search+location.hash);}</script>'
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Varroa mites observation atlas</title><meta name="description" content="Explore Varroa mitochondrial evidence, source records and manually reviewed lineage interpretations.">
{head_before}<link rel="stylesheet" href="{asset_prefix}/resource.css">{scripts}</head><body data-page="{name}">
<a class="skip" href="#main">Skip to content</a><header class="site-header"><a class="wordmark" href="index.html">Varroa mites observation atlas</a><nav aria-label="Resource navigation">{nav}</nav></header>
<main id="main">{body}</main><footer><span>Curated by Maeva A. Techer</span><span>Built on <a href="https://doi.org/10.1016/j.pt.2020.04.004">Traynor et al. (2020)</a> · Please cite the original studies.</span><a href="https://github.com/MikheyevLab/varroa-mtDNA-world-distrib">Data & methods ↗</a></footer></body></html>'''


def page(name, title, body):
    (DOCS / f"{name}.html").write_text(page_document(name, title, body))


def build_map_template():
    # Pandoc fills its dependency/style slots before embedding the shared layout.
    head = """$for(header-includes)$
$header-includes$
$endfor$
$if(highlighting-css)$<style type="text/css">$highlighting-css$</style>$endif$
$for(css)$<link rel="stylesheet" href="$css$">$endfor$
<script src="docs/assets/map_page.js" defer></script>
"""
    body = "$for(include-before)$$include-before$$endfor$\n$body$\n$for(include-after)$$include-after$$endfor$"
    (ROOT / "scripts/templates/maps-layout.html").write_text(
        page_document("maps", "Maps", body, asset_prefix="docs/assets", head_before=head))


def build_pages(summary):
    build_map_template()
    page("index", "Home", f'''
<section class="home-intro"><h1 class="sr-only">Varroa mites observation atlas</h1><p class="home-description">Find Varroa records and mitochondrial lineages worldwide.</p><div class="home-illustration-row"><figure class="hero-illustration"><img src="assets/beekeeper.png" width="840" height="800" alt="Hand-drawn beekeepers inspecting a hive among bees and flowers"></figure><svg class="illustration-arrow" viewBox="0 0 80 36" aria-hidden="true"><path d="M4 18H72M60 6L72 18L60 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><figure class="hero-illustration"><img src="assets/varroa-illustration.jpeg" width="1216" height="1000" alt="Hand-drawn dorsal view of a reddish-brown Varroa mite"></figure></div><div class="hero-actions"><a class="button primary" href="maps.html">Explore the map atlas ↗</a><a class="button" href="records.html">Browse all records</a><a class="button" href="submit.html">Missing a record?</a></div></section>
<div class="editorial-grid"><section><div class="section-heading"><h2>Latest evidence</h2><a href="records.html?dataset=literature">All papers ↗</a></div><div id="paper-feed" class="feed" aria-live="polite">Loading…</div></section>
<section><div class="section-heading"><h2>Latest NCBI records</h2><a href="records.html?dataset=ncbi">All NCBI records ↗</a></div><p class="muted" id="ncbi-snapshot">Snapshot · 2 October 2021</p><div id="ncbi-feed" class="feed" aria-live="polite">Loading…</div></section></div>''')
    page("records", "Records", '''<section class="page-intro"><div class="page-heading"><h1>Every record has a source.</h1></div><p class="lede">Search the complete published register, inspect the original fields and download your selection as TSV.</p><p class="muted">These datasets overlap: a literature row, map observation and GenBank accession may describe related evidence. Their totals are not counts of independent mites. The NCBI snapshot includes mitochondrial markers beyond COX1.</p></section>
<section class="record-browser" aria-label="Record browser"><div class="record-filters"><label>Search records<input id="record-search" type="search" placeholder="Place, accession, lineage, study…"></label><label>Dataset<select id="record-dataset"><option value="">All datasets</option><option value="map">Map evidence</option><option value="literature">Literature records</option><option value="ncbi">NCBI snapshot</option><option value="reference">Reference naming catalogue</option><option value="sequence">Imported sequences</option></select></label><label>Manual verification<select id="record-verification"><option value="">All statuses</option><option value="verified">Manually verified</option><option value="not_verified">Not yet verified</option><option value="needs_recheck">Needs recheck</option></select></label><label>Sort by<select id="record-sort"><option value="id">Record ID</option><option value="added">Latest additions</option><option value="ncbi">Latest NCBI creation date</option><option value="country">Country</option></select></label></div>
<div class="table-actions"><p id="record-count" role="status">Loading records…</p><button id="download-filtered" class="button" disabled>Download filtered TSV</button><a class="button" href="data/records.tsv" download>Complete register TSV</a></div><p class="muted">Only explicit manual decisions grant verification. Published legacy records remain “Not yet verified” until certified; pending imports are excluded from this register.</p>
<div class="table-scroll"><table><caption class="sr-only">Published evidence records</caption><thead><tr><th>Record / dataset</th><th>Species / host</th><th>Country / locality</th><th>Reported lineage</th><th>Source</th><th>Manual verification</th></tr></thead><tbody id="record-rows"></tbody></table></div><div class="pagination"><button id="previous-page">Previous</button><span id="page-number"></span><button id="next-page">Next</button></div></section>
<dialog id="record-detail"><button class="dialog-close" aria-label="Close record details">×</button><div id="detail-content"></div></dialog>''')
    page("phylogeny", "Phylogeny", (ROOT / "scripts/templates/phylogeny.html").read_text())
    page("review", "Record review", (ROOT / "scripts/templates/review.html").read_text())
    page("submit", "Missing a record?", (ROOT / "scripts/templates/submit.html").read_text())


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    CURATION.mkdir(parents=True, exist_ok=True)
    events = read_events()
    records = [reviewed(r, events, r["origin"] == "existing_resource") for r in collect()]
    if len({r["record_id"] for r in records}) != len(records):
        raise ValueError("Record identifiers must be unique")
    registry = dict(schema_version=1, records=records)
    (CURATION / "registry.json").write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n")
    public = [r for r in records if r["publication_status"] == "published"]
    summary = {name: sum(r["dataset"] == name for r in public) for name in ["map", "literature", "ncbi", "reference"]}
    summary["verified"] = sum(r["verification_status"] == "verified" for r in public)
    # Citation display metadata is separate from the source records and their certification hashes.
    bibliography = json.loads((ROOT / "Data/bibliography.json").read_text())
    (DATA / "records.json").write_text(json.dumps(dict(schema_version=1, summary=summary, records=public,
                                                     bibliography=bibliography), ensure_ascii=False))
    write_tsv(DATA / "records.tsv", public)
    map_status = [{k: r[k] for k in ["record_id", "fingerprint", "verification_status", "verified_by", "verified_at", "verification_note", "publication_status"]}
                  for r in records if r["dataset"] == "map"]
    (CURATION / "map_review.json").write_text(json.dumps(map_status, ensure_ascii=False, indent=2))
    # A direct R Markdown render must also detect reviews built against stale source files.
    dependencies = ["Data/mappingpoints_Varroareview05022020.csv", "Data/mappingcountry_Varroareview05022020.csv",
        "Data/updates/2026-11-05/workbook_crosswalk.csv", "Data/updates/2026-11-05/archive_annotations.csv",
        "Data/updates/2026-11-05/archive_legacy_links.csv", "scripts/map_helpers.R", "scripts/build_resource.py"]
    (CURATION / "map_review_inputs.json").write_text(json.dumps(
        {p:hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in dependencies}, indent=2))
    build_pages(summary)
    print(json.dumps(dict(published=len(public), pending=len(records)-len(public), **summary)))


if __name__ == "__main__":
    main()

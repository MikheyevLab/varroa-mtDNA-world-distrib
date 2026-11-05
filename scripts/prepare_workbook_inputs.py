#!/usr/bin/env python3
"""Prepare literal workbook rows and explicit archive-to-legacy annotation links.

Requires openpyxl only to READ the frozen workbook. Workbook authoring uses JS.
"""
import csv
import json
import re
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
UPDATE = ROOT / "Data/updates/2026-11-05"


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def main():
    blocks = {k: read_csv(UPDATE / f) for k, f in [
        ("P", "point_additions.csv"), ("C", "country_additions.csv"), ("A", "archive_annotations.csv")]}
    rows = []
    for extra in read_csv(UPDATE / "workbook_crosswalk.csv"):
        key = extra["input"]
        record = blocks[key[0]][int(key[1:]) - 1]
        coordinates = [None] * 4
        if key[0] != "C":
            offset = 0 if record["Coord.type"] == "exact" else 2
            coordinates[offset:offset + 2] = [float(record["coord.X"]), float(record["coord.Y"])]
        doi = re.findall(r"https://doi.org/(\S+)", record["Description"])[-1].rstrip(".")
        note = record["Description"].removeprefix(extra["reference"] + ". ")
        year = record["Year"]
        year = None if year == "NA" else int(year) if year.isdigit() else year
        rows.append([extra["reference"], "Varroa destructor", record["Host"], year,
                     record["Location"], extra["region"], extra["reported_mt"] or None,
                     extra["mt_assay"] or None, None, int(extra["N"]) if extra["N"] else None,
                     extra["accession"] or None, *coordinates, doi, note, None, None])
    assert len(rows) == 127
    (UPDATE / "workbook_rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")

    # These links were reviewed against the S2 rows named in the supplied crosswalk.
    # They connect locality + collection host + original citation, never assert specimen reuse.
    links = [(1,54,19),(1,654,27),(2,62,29),(3,649,14),(3,927,15),
             (4,650,12),(4,928,13),(5,652,1),(5,932,2),(6,646,9),(6,930,11),
             (7,647,37),(8,447,46),(9,94,52),(10,920,180),(11,923,162),
             (12,917,171),(13,911,181),(14,448,468)]
    literature = openpyxl.load_workbook(ROOT / "Data/Database_mtDNA_updated_2021.xlsx")["Table Data S2_Data_papers"]
    references = set()
    for values in list(literature.values)[1:] + [tuple(row) for row in rows]:
        if values[0] and values[15]:
            for doi in re.findall(r"10\.\d{4,9}/[^\s;]+", str(values[15])):
                references.add((str(values[0]).strip(), doi.rstrip(".,")))
    with (UPDATE / "reference_links.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["reference", "doi"])
        writer.writerows(sorted(references))
    points = read_csv(ROOT / "Data/mappingpoints_Varroareview05022020.csv")
    annotations = []
    for archive_id, s2_row, point_row in links:
        archive, legacy = blocks["A"][archive_id - 1], points[point_row - 1]
        source = [cell.value for cell in literature[s2_row]]
        assert source[0].strip() in legacy["Description"]
        assert archive["Host"] == legacy["Host"] == source[2]
        assert legacy["Region"] == source[5] and legacy["Year"] == str(source[3])
        # Explicitly retain conflicting archive coordinates and lineage labels for review.
        distance = max(abs(float(archive[c]) - float(legacy[c])) for c in ("coord.X", "coord.Y"))
        review = []
        if distance > .01:
            review.append("georeferences differ; retained without correction")
        if archive["GROUP"] != legacy["GROUP"]:
            review.append("lineage calls differ; retained without correction")
        if archive["Year"] != legacy["Year"]:
            review.append("collection years differ or legacy interval is uncertain")
        if archive_id == 7:
            review.append("four-gene subtypes differ between sources")
        annotations.append({"archive_input": f"A{archive_id}", "s2_row": s2_row,
            "point_data_row": point_row, "legacy_description": legacy["Description"],
            "legacy_region": legacy["Region"], "host": legacy["Host"],
            "legacy_year": legacy["Year"], "review": "; ".join(review) or "individual reuse unresolved"})
    with (UPDATE / "archive_legacy_links.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(annotations[0]))
        writer.writeheader()
        writer.writerows(annotations)
    print(f"Prepared {len(rows)} workbook rows and {len(annotations)} reviewed locality/host annotation links.")


if __name__ == "__main__":
    main()

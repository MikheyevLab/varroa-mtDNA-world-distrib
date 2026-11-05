#!/usr/bin/env python3
"""Independently compare all baseline cells/features and all 127 appended rows."""
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
baseline_path = ROOT / "Data/Database_mtDNA_updated_2021.xlsx"
final_path = ROOT / "Data/Database_mtDNA_updated_2026.xlsx"
a, b = (openpyxl.load_workbook(path) for path in (baseline_path, final_path))
assert a.sheetnames == b.sheetnames
for sheet in a:
    updated = b[sheet.title]
    for row in sheet:
        for cell in row:
            new = updated[cell.coordinate]
            assert cell.value == new.value, (sheet.title, cell.coordinate, "value changed")
            assert cell._style == new._style, (sheet.title, cell.coordinate, "style changed")
    assert sheet.freeze_panes == updated.freeze_panes
    assert sheet.auto_filter == updated.auto_filter
    assert sheet.sheet_format == updated.sheet_format
expected = json.loads((ROOT / "Data/updates/2026-11-05/workbook_rows.json").read_text())
assert list(b["Table Data S2_Data_papers"].values)[932:] == [tuple(row) for row in expected]
with zipfile.ZipFile(baseline_path) as za, zipfile.ZipFile(final_path) as zb:
    assert za.namelist() == zb.namelist()
    changed = [name for name in za.namelist() if za.read(name) != zb.read(name)]
    assert set(changed) == {"xl/worksheets/sheet3.xml", "xl/styles.xml"}
base_commit = "574d3064534320379bcb43adb410d7cff11ba7d0"
for name in ("Data/Database_mtDNA_updated_2021.xlsx", "docs/index.html"):
    original = subprocess.check_output(["git", "show", f"{base_commit}:{name}"], cwd=ROOT)
    current = (ROOT / ("docs/before-2026-update.html" if name.endswith("html") else name)).read_bytes()
    assert current == original
report = {"original_sheet_names_preserved": True, "baseline_value_differences": 0,
    "baseline_style_differences": 0, "freeze_panes_preserved": True,
    "changed_package_parts": changed, "appended_rows": len(expected), "appended_range": "A933:S1059",
    "all_added_cells_match_crosswalk": True, "2021_workbook_byte_identical": True,
    "before_HTML_byte_identical": True, "workbook_sha256": hashlib.sha256(final_path.read_bytes()).hexdigest()}
(ROOT / "validation/2026-11-05/workbook_validation.json").write_text(json.dumps(report, indent=2) + "\n")
print("PASS: baseline values, styles, native features and all 127 workbook additions.")

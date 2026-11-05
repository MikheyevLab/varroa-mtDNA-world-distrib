#!/usr/bin/env python3
"""Keep all original XLSX parts, appending only the artifact-authored literature rows.

Artifact export preserves values but normalizes historical styles and freeze panes.
This packaging step retains those original features byte for byte, and uses inline
strings for the new cells so the frozen shared-string table also stays untouched.
"""
import copy
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
Q = lambda tag: f"{{{NS}}}{tag}"
ET.register_namespace("", NS)
ROOT = Path(__file__).resolve().parents[1]


def main():
    source = ROOT / "Data/Database_mtDNA_updated_2021.xlsx"
    generated = Path(sys.argv[1])
    destination = ROOT / "Data/Database_mtDNA_updated_2026.xlsx"
    with zipfile.ZipFile(source) as baseline, zipfile.ZipFile(generated) as authored:
        shared = ET.fromstring(authored.read("xl/sharedStrings.xml"))
        strings = ["".join(si.itertext()) for si in shared]
        sheet_path = "xl/worksheets/sheet3.xml"
        original = baseline.read(sheet_path).decode()
        original_tree = ET.fromstring(original)
        final_style = {re.sub(r"\d+", "", cell.attrib["r"]): cell.get("s", "0")
                       for cell in original_tree.find(Q("sheetData"))[-1]}
        styles_xml = baseline.read("xl/styles.xml").decode()
        styles_tree = ET.fromstring(styles_xml)
        cell_styles = styles_tree.find(Q("cellXfs"))
        style_map, new_styles = {}, []
        for old in set(final_style.values()):
            xf = copy.deepcopy(cell_styles[int(old)])
            alignment = xf.find(Q("alignment"))
            if alignment is None:
                alignment = ET.SubElement(xf, Q("alignment"))
            alignment.set("wrapText", "1")
            xf.set("applyAlignment", "1")
            style_map[old] = str(len(cell_styles) + len(new_styles))
            new_styles.append(ET.tostring(xf, encoding="unicode"))
        new_rows = []
        generated_sheet = ET.fromstring(authored.read(sheet_path))
        for row in generated_sheet.find(Q("sheetData")):
            if int(row.attrib["r"]) < 933:
                continue
            for cell in row:
                column = re.sub(r"\d+", "", cell.attrib["r"])
                cell.set("s", style_map[final_style.get(column, "0")])
                if cell.get("t") == "s":
                    value = strings[int(cell.find(Q("v")).text)]
                    cell.remove(cell.find(Q("v")))
                    cell.set("t", "inlineStr")
                    text = ET.SubElement(ET.SubElement(cell, Q("is")), Q("t"))
                    text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                    text.text = value
            new_rows.append(ET.tostring(row, encoding="unicode"))
        assert len(new_rows) == 127
        sheet_xml = original.replace("</sheetData>", "".join(new_rows) + "</sheetData>")
        sheet_xml = re.sub(r'(<dimension ref=")[^"]+("/>)', r'\g<1>A1:S1059\2', sheet_xml)
        # Keep existing style nodes and IDs unchanged; only extend the style collection.
        styles_xml = re.sub(r'<cellXfs count="\d+"', f'<cellXfs count="{len(cell_styles) + len(new_styles)}"', styles_xml)
        styles_xml = styles_xml.replace("</cellXfs>", "".join(new_styles) + "</cellXfs>")
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as result:
            for entry in baseline.infolist():
                payload = sheet_xml.encode() if entry.filename == sheet_path else styles_xml.encode() if entry.filename == "xl/styles.xml" else baseline.read(entry.filename)
                result.writestr(entry, payload)
    print("Preserved original package parts; appended 127 authored literature rows.")


if __name__ == "__main__":
    main()

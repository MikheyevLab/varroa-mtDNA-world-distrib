#!/usr/bin/env bash
# Run from the repository root; PYTHON can select a project virtual environment.
set -euo pipefail
Rscript scripts/export_map_records.R
"${PYTHON:-python3}" scripts/build_resource.py
Rscript -e 'rmarkdown::render("VarroaReviewMap_2021.Rmd", output_file="maps.html", output_dir="docs")'

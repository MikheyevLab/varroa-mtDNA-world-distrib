# World Distribution of Varroa mites haplogroups

The [interactive resource](https://mikheyevlab.github.io/varroa-mtDNA-world-distrib/) now includes a targeted literature update through **5 November 2026**: **704 point evidence records and 429 country records**. The addition focuses on Vietnam, China, Taiwan, Thailand and South Korea, with selected comparative records and the Australian incursion. This is an occurrence database, not a prevalence survey.

Use **New additions** to isolate the 108 new point records and five new country records, or choose a host view. Search by locality, study, voucher or accession; filter species, host, study, mitochondrial group, geographic precision and collection year. The linked evidence table supports filtered CSV downloads, study links, citations and shareable filter URLs. Numbered rings keep coincident studies discoverable. The optional genome-wide layer includes ten records without resolved mitochondrial calls; those records have no mitochondrial color.

The atlas now puts the map first, with compact filters, a muted lineage palette, species shapes, geographic labels and a world locator. **Colour by → Mite species** uses red circles for *V. destructor* and blue diamonds for *V. jacobsoni*, inspired by Techer et al. (2019), Figure 1. The optional dotted gold halo marks the 2026 additions (enabled by default in full-data presets). Unresolved mt evidence stays gray in both modes. Equal ring segments identify groups present, not biological frequencies. **Export figure** saves an editable SVG of the current geographic view, including the legend, scale, source credit and filter/record metadata. Evidence counts describe the full selection, including records outside the viewport. Coordinates and input data are unchanged.

- [Updated 2026 workbook](Data/Database_mtDNA_updated_2026.xlsx): 127 additions in literature-sheet rows 933–1059; all four original sheets retained.
- [Archival 2021 workbook](Data/Database_mtDNA_updated_2021.xlsx): unchanged source, including its dated GenBank snapshot.
- [Original map before this update](docs/before-2026-update.html): byte-for-byte baseline HTML.
- [Updated rendered map](docs/maps.html), [curated inputs and crosswalk](Data/updates/2026-11-05/), and [validation records](validation/2026-11-05/).

Filled circles mark published coordinates; hollow circles mark approximate localities. Country-only evidence remains polygon evidence, with the named region in its popup. The default background uses bundled country borders and works offline; OpenStreetMap is optional. An archived record's collection year is not the year it was added to this resource. Collection host does not establish successful reproduction, and coordinate coincidence does not establish specimen reuse.

Distribution of the different mtDNA lineages or haplogroups based on _COX1_ marker described in ectoparasitic Varroa mites on their honey bee hosts.  
  
The available maps were initiated by the Ecology and Evolution lab at the Okinawa Institute of Science and Technology to review and track overtime the presence of different haplogroups of Varroa distributed worldwide. Click here to directly visualize theses [Varroa maps](https://mikheyevlab.github.io/varroa-mtDNA-world-distrib) either for the invasive _V. destructor_ or _V. jacobsoni_, both on their novel host Western honey bee (_Apis mellifera_) and their original host the Eastern honey bee (_A. cerana_).


This online resource is implemented in the review Traynor et al. 2020 available in [Trends in Parasitology](https://www.sciencedirect.com/science/article/pii/S147149222030101X), if you would like to use it please cite:
  
Traynor, K. S., Mondet, F., de Miranda, J. R., Techer, M., Kowallik, V., Oddie, M. A. Y., Chantawannakul, P., & McAfee, A. (2020). Varroa destructor: A Complex Parasite, Crippling Honey Bees Worldwide. Trends in Parasitology. https://doi.org/10.1016/j.pt.2020.04.004
  

## Description and review of the haplogroups and haplotypes

In the folder Data:  
- Read the doc "Haplotypes_revision_description_Varroa.docx"  
- Check the raw data digged from the literature review (68 papers using DNA barcoding to confirm Varroa species presence and 485 sequences available from GenBank)  
  
In the folder Raster_borders:  
- Rasters used to build the maps borders and country polygons on top of OpenStreetMap available with the leaflet R package.  

## Reproduce the update

From the repository root, with Python 3, R, Pandoc and the R packages `rmarkdown`, `rmdformats`, `knitr`, `leaflet`, `htmltools`, `htmlwidgets`, `jsonlite`, `base64enc` and `sf` installed:

```bash
# Parse quoted UTF-8 rows and append only additions absent as exact full rows.
python3 scripts/apply_curated_update.py
# Check the data, map layer routing and rendered evidence payload.
Rscript scripts/validate_maps.R
# Build Home, Records, Phylogeny and the separate Maps page (Python needs openpyxl).
bash scripts/build_site.sh
```

The append step preserves the original CSV bytes, headers and BOMs. It checks baseline records against commit `574d3064534320379bcb43adb410d7cff11ba7d0`, reports potentially overlapping scientific records, and never merges distinct evidence on coordinates alone. Reapplication adds zero rows. The 14 archival Techer groups remain separate from the point additions; 19 reviewed links attach their separately attributed WGS notes to legacy locality/host records. Coordinate and lineage conflicts remain flagged in `archive_legacy_links.csv` and the workbook notes.

For workbook reconstruction, `scripts/prepare_workbook_inputs.py` uses `openpyxl` only to read the archived workbook and creates the literal row matrix and locality crosswalk. `scripts/build_workbook.mjs` authors the additions using `@oai/artifact-tool`; `scripts/preserve_workbook_baseline.py` packages those new rows with the original XLSX parts so earlier values, styles, panes and annotations remain unchanged. Run the builder in an environment with that package available; the delivered workbook is ready to use without it. `scripts/validate_workbook.py` independently checks the final workbook against the baseline and supplied crosswalk.

The explorer normalizes `Apis cerana` / `A. cerana` and `Apis mellifera` / `A. mellifera` for host filters only. Source fields remain unchanged. Date filters match explicit years or overlapping intervals and handle unknown years separately. The historical Yugoslavia record has no matching bundled polygon and remains accessible in the table/download. No current country is substituted.

## Resource pages and manual curation

The resource now has a clean illustrated [home page](docs/index.html), a searchable [complete record register](docs/records.html), separate [maps](docs/maps.html), and an interactive [phylogeny page](docs/phylogeny.html). The home page shows five compact paper additions and five NCBI entries, with the historical 2021 snapshot identified explicitly. The TSV register includes original source fields and manual verification status.

See [CURATION.md](CURATION.md) for reproducible builds, the review log, new-sequence intake and Snakemake COX1 workflows. Existing records have not been certified automatically. New imports stay outside the public register until manually verified and explicitly released. A real exploratory tree was completed on 5 November 2026: 592 sequences, 62 distinct aligned sequence groups, a 458-base COX1 window, MAFFT alignment and IQ-TREE maximum likelihood with 1,000 ultrafast bootstrap and 1,000 SH-aLRT replicates. The local viewer includes all 15 Taiwan type T accessions. The review bundle is Git-ignored and loads only on localhost; lineage certification and public release still require curator review.

Maps can optionally overlay public, species-level iNaturalist Research Grade observations. Green hexagons, separate counts and source links distinguish these community observations from mitochondrial evidence; they do not receive manual verification or inferred lineage labels. The live layer has an independent species filter and is excluded from curated exports.

## Contact  
Questions about the maps? Do you want to correct some entries or implement new ones, please contact:  
Maeva Techer, Postdoctoral Scholar at the Behavioral Plasticity Research Institute and Texas A&M University
(ex-JSPS Postdoctoral Fellow at the Ecology and Evolution lab at OIST)

Contact: maeva.angelique.techer@gmail.com

For collaborative checking, start `.venv-resource/bin/python scripts/review_workspace.py serve` and open `http://127.0.0.1:8765/review.html`. Source fields, discussion notes and manual decisions stay separate. The homepage's **Missing a record?** form prepares an email for curator review; visitors send it themselves. See [CURATION.md](CURATION.md) for the workflow and restart instructions.

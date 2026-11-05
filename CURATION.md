# A record is verified only after manual review

The public resource contains the existing map evidence, all literature-sheet rows, the dated GenBank metadata snapshot and the historical naming catalogue. These datasets overlap; they are not independent specimen counts. The original workbook and source CSV fields remain unchanged.

Each record has its own ID and SHA-256 fingerprint. `Manually verified` means a named person certified that exact record. Automated QC, a GenBank accession, an iNaturalist Research Grade identification, or proximity to a reference in a tree never grants the badge. A change in the record invalidates its certification and displays `Needs recheck`.

Existing public records remain visible but unverified until certified. New NCBI and paper imports require two explicit decisions: manual verification, then release. Decisions are stored in the repository's curation log. The curator can use the local review interface described below; the public website has no write API. No certifications have been entered on the curator's behalf.

## Build the local resource

Use the R dependencies listed in the README and a Python environment with `openpyxl`. The builder reads the workbook without editing it. The home page is `docs/index.html`; render the R Markdown to `docs/maps.html` so it does not replace the home page.

```bash
# One-time Python setup; original input files are never changed.
python3 -m venv .venv-resource
.venv-resource/bin/python -m pip install -r scripts/requirements-resource.txt
# Export source records, apply manual decisions, build pages and render maps.
PYTHON=.venv-resource/bin/python bash scripts/build_site.sh
# Verify release boundaries and sequence-quality handling with synthetic cases.
.venv-resource/bin/python scripts/test_resource.py
```

The published register is `docs/data/records.tsv` (with all original fields in `source_json`) and `docs/data/records.json`. `Data/curation/registry.json` additionally contains pending records and is ignored by Git. `Data/curation/map_review.json` supplies the map badges. Map IDs P/C and workbook IDs L/N/R retain their current row associations; do not reorder source rows as an editing shortcut.

## Certify a record

### Review together in the browser

After building, start the local server in a terminal and leave it running:

```bash
# Serve the atlas and its private review workspace on this computer only.
.venv-resource/bin/python scripts/review_workspace.py serve --port 8765
```

Open `http://127.0.0.1:8765/review.html`. Search by paper, place, accession or record ID. The queue includes published records and pending imports; its counts are records, not unique specimens. Select a row to see original fields and source links. **Copy for our chat** prepares the record ID, version and source for discussion here. There is no embedded chat model in the website.

Save questions and proposed corrections as notes. An assistant can append a clearly labelled suggestion without certification:

```bash
# Replace the ID and hash with the exact version displayed in the review page.
.venv-resource/bin/python scripts/review_workspace.py note \
  --record-id RECORD_ID --fingerprint SHA256_FROM_REVIEW_PAGE \
  --author Codex --kind question \
  --text 'Describe the discrepancy and the evidence needed to resolve it.' \
  --evidence 'DOI, page, table or accession'
```

Proposals do not edit source files. We apply agreed corrections in the underlying source, rebuild, and inspect the changed record before certification. Earlier notes stay visible with their version label. To close a question on the current version, write a resolution in the note field and choose **Resolve issue**. Only the human reviewer can do this.

After checking the source, species, host, location and precision, collection date, and lineage terminology, enter your name and review note, tick the six checks and personal attestation, and choose **Mark verified**. Unknowns may stay unknown when that is what the source documents. Unresolved questions block verification. A later source change invalidates the approval. Imported records additionally need **Release to local site**. Decisions trigger a local rebuild, with failures reported in the page; they never deploy or push the website.

Notes are append-only in `Data/curation/review_notes.jsonl`, kept locally and ignored by Git. Decisions are append-only in `Data/curation/reviews.jsonl`; retain this ledger in version control. The server binds only to `127.0.0.1`, checks request origin and a session token, and does not serve these files from `docs`. Do not expose the review server through a public tunnel.

The **Missing a record?** homepage link opens a short public form. **Prepare email** creates a draft addressed to `maeva.angelique.techer@gmail.com`; the visitor must send it using their mail app. **Copy details** provides a fallback. The form does not submit data to a service, add records, or certify anything.

### Review packets and command-line decisions

First rebuild and export a fresh packet to a new filename. Inspect the source paper or accession, taxon, host, coordinates, dates and lineage terminology. The fingerprint covers the complete record, including the original source fields. A map record and a literature row require separate decisions even when they refer to related evidence.

```bash
# This writes a review packet only; it certifies nothing.
python3 scripts/record_review.py packet --output /tmp/varroa-review-packet.tsv
```

Only after personally checking a row, use its exact ID and fingerprint in the following command. Replace the illustrative arguments; do not run this as a batch of automatic approvals.

```bash
python3 scripts/record_review.py verify RECORD_ID \
  --fingerprint SHA256_FROM_REVIEW_PACKET \
  --reviewer 'Maeva A. Techer' \
  --note 'Describe the sources checked and any interpretation retained.'
# New imports also need this separate, explicit publication decision.
python3 scripts/record_review.py release RECORD_ID \
  --fingerprint SHA256_FROM_REVIEW_PACKET \
  --reviewer 'Maeva A. Techer' --note 'Approved for the public register.'
PYTHON=.venv-resource/bin/python bash scripts/build_site.sh
```

`revoke` removes certification; `withdraw` removes a record from the public build. They append decisions without deleting history. Each takes the same ID, fingerprint and reviewer arguments. The log is `Data/curation/reviews.jsonl`; retain it in version control when real decisions are made. A local rebuild does not deploy the website.

## Bring sequences into the review queue

The intake tool creates a new folder and refuses to reuse one. It preserves raw NCBI XML or paper FASTA/metadata, file hashes, accession versions, retrieval times and QC reasons. The default NCBI query includes mitochondrial genomes so annotated COX1 can be extracted. Records with missing, multiple or compound COX1 annotations are retained for manual extraction. The tool never substitutes a whole mitogenome for COX1. Metadata-only papers still need an accession or an actual sequence file before analysis.

```bash
# Full query: paginated and rate-limited. Use a unique run ID each time.
python3 scripts/sequence_intake.py ncbi --run-id ncbi_YYYYMMDD
# For a small pilot, add --limit 5. A pilot is explicitly labelled incomplete.
# Optional --accessions FILE accepts full accession IDs, one per line.

# Paper metadata must match every FASTA identifier exactly once.
# Required TSV columns: sequence_id, reference, source_url.
# Recommended: reported_lineage, accession, species, host, country.
python3 scripts/sequence_intake.py paper --run-id paper_YYYYMMDD \
  --fasta /path/to/paper-cox1.fasta --metadata /path/to/paper-metadata.tsv

# Queue records become reviewable locally; they remain absent from docs/data.
PYTHON=.venv-resource/bin/python bash scripts/build_site.sh
```

`NCBI_EMAIL` and `NCBI_API_KEY` may be supplied as environment variables. They are not stored in manifests. The client limits itself to fewer than three requests per second and retries transient failures. Raw partial batches remain available if a request fails. An incomplete run does not create a releasable records file. An accession may recur across intake runs; compare versions and provenance before releasing duplicates.

## COX1 tree and reference comparison

The naming catalogue contains historical label crosswalks, not approved sequence references. Select accession-versioned COX1 references, orient and align the homologous window, and fill `Data/phylogeny/references.tsv`. Keep original names alongside canonical labels. Compressed multi-gene accession lists must be resolved against the actual GenBank annotations; they must not all be treated as COX1.

After personally checking the reference alignment and label crosswalk, fill `Data/phylogeny/reference_review.json` with `approved: true`, the reviewer's name, review date, and SHA-256 hashes of the exact alignment and metadata files. Until this is done the **reviewed-reference placement workflow** refuses to run. A separate exploratory tree can be computed without assigning canonical lineages; it does not create a reference approval. No reference sequence or reference approval has been fabricated.

```bash
# Install the tested workflow engine in its own environment.
python3 -m venv .venv-cox1
.venv-cox1/bin/python -m pip install -r workflow/cox1/requirements.txt
# Inspect the exact reference file hashes for the manual review record.
shasum -a 256 Data/phylogeny/references.fasta Data/phylogeny/references.tsv
# Create a config with a fresh run ID and the selected intake/reference paths.
cp -n workflow/cox1/config.example.yaml /tmp/varroa-cox1.yaml
# Edit /tmp/varroa-cox1.yaml before these commands.
.venv-cox1/bin/snakemake --snakefile workflow/cox1/Snakefile --configfile /tmp/varroa-cox1.yaml \
  --cores 4 --use-conda --dry-run
.venv-cox1/bin/snakemake --snakefile workflow/cox1/Snakefile --configfile /tmp/varroa-cox1.yaml \
  --cores 4 --use-conda
```

The pipeline filters intake QC failures, adds fragments to the reviewed reference window with MAFFT, saves orientation and insertion-mapping information, checks shared unambiguous sites, and estimates an IQ-TREE maximum-likelihood tree with model selection, 1,000 ultrafast bootstraps and 1,000 SH-aLRT replicates. The defaults of 300 overlapping sites and 2% ambiguous bases are configurable screening thresholds, not biological species cutoffs. Review alignment quality, contamination, potential nuclear mitochondrial copies and phylogenetic signal before interpretation. Paper fragments without an annotated coding frame are explicitly not translation-checked.

`reference_comparisons.tsv` reports overlap and raw mismatch proportions against references. It does not automatically equate names or certify placements. Identical sequences associated with different labels are flagged as tied. Different comparisons can cover different sites, so nearest-reference similarity alone is not a phylogenetic assignment. COX1 cannot necessarily resolve subhaplotypes named from several mitochondrial genes. The output tree is unrooted; its displayed first tip is not an inferred ancestor.

Outputs stay in `runs/cox1/RUN_ID`. Use a new run ID whenever inputs, parameters or references change. Retain successful results. IQ-TREE may resume an interrupted run without `-redo`. The exploratory run described below has now completed; no canonical lineage assignments or reference approvals have been certified.

Methods: [NCBI E-utilities](https://www.nlm.nih.gov/dataguide/eutilities/utilities.html), [MAFFT fragment alignment](https://mafft.cbrc.jp/alignment/software/addsequences.html), [IQ-TREE options](https://iqtree.github.io/doc/Command-Reference).

### Completed exploratory tree: 5 November 2026

The run `runs/cox1/exploratory_20261105_v4` contains the completed MAFFT 7.526 and IQ-TREE 2.3.6 analysis. It uses the full NCBI query saved in `Data/intake/ncbi_cox1_20261105_full_v2`: 1,089 accession-versioned records. No sequences were inferred from paper descriptions; paper labels were linked to actual accessions already in GenBank. Every imported record remains pending manual review.

The alignment backbone contains 20 historical Varroa sequences plus the full-length COX1 feature of NC_004454.2. The full-length scaffold prevents fragments from other parts of COX1 being forced into a short comparison window. MAFFT adds the other sequences with `--adjustdirectionaccurately --addfragments --mapout`; the comparison uses the 458 nongap coordinates of AF106899.1. This sequence defines coordinates, not the root or a certified lineage.

Screening retains 592 sequences with at least 400 unambiguous overlapping bases, no more than 2% ambiguous bases and no internal stop in the aligned reference frame (mitochondrial code 5). An additional maximum raw distance of 15% to any historical anchor is an alignment review screen, not a species criterion; no final eligible sequence exceeded it. Of the 497 exclusions, 469 have insufficient overlap, 22 fail intake length/ambiguity criteria, and six have a stop in the aligned window. These records are preserved in `window_qc.tsv`, not declared invalid sequences.

Exact aligned strings form 62 sequence groups, retaining all accessions in `groups.json`. Missing bases are not assumed identical to observed bases. These groups are computational tips, not newly named haplotypes. IQ-TREE selected TIM+F+I+G4 by BIC and ran 1,000 ultrafast bootstrap replicates with BNNI plus 1,000 SH-aLRT replicates, four threads and seed 20261105. The 458-site alignment has 76 parsimony-informative sites. The inference is unrooted; the displayed centre is arbitrary. Thirty near-zero internal branches limit fine-scale interpretation.

All 15 Hua et al. (2023) Taiwan type T accessions are retained: five span 458 sites and ten span 405 sites. Their reported names stay unchanged. The full-length type T sequences differ by one base from both the historical Japan and Korea references in this window; nearest-reference similarity therefore does not resolve a unique canonical name. The complete pairwise table is `taiwan_reference_comparisons.tsv`. Partial sequences create separate computational tips and must not be interpreted as independent novel lineages.

Reproduce with a fresh run ID (the supplied config preserves the completed run):

```bash
# From the repository root, after the NCBI intake above and workflow installation.
.venv-cox1/bin/snakemake --snakefile workflow/cox1/exploratory.smk \
  --configfile workflow/cox1/exploratory.config.yaml --cores 4 --use-conda --dry-run
.venv-cox1/bin/snakemake --snakefile workflow/cox1/exploratory.smk \
  --configfile workflow/cox1/exploratory.config.yaml --cores 4 --use-conda

# Build a local review bundle after tree completion; requires Biopython 1.88.
python scripts/cox1_exploratory.py bundle \
  --out runs/cox1/exploratory_reproduction_20261105 \
  --preview docs/data/phylogeny-review/reproduction_20261105
```

The current interactive page loads `docs/data/phylogeny-review/cox1_20261105` only on localhost. This directory is Git-ignored and is not included in the public register. Remote hosts look for a separately reviewed release under `docs/data/phylogeny/`; none exists yet. Do not upload the review directory as a public release. The local viewer supports circular/detailed layouts, a reported-species selector, accession/name search, Taiwan T highlighting, tip inspection, branch support and Newick/SVG/alignment/QC downloads. The species filter prunes only the view, retains branch lengths/support and narrows accession lists even for groups carrying more than one reported species. Historical GenBank species names remain visible. SVG exports follow the current view; Newick and alignment downloads retain the full analysis. All source annotations remain **not manually verified**. The reference approval file remains `approved: false`.

Selecting a single-accession tip opens its sample record. Shared tips list each accession separately; selecting a voucher or accession opens that exact record, with current verification status and a local review link. Study/locality annotations have separate record links because they can describe several specimens. Published records also support direct links such as `records.html?record=P597`.

`record_links.json` maps accession versions to record IDs and voucher/isolate/strain identifiers from the exact analysis metadata. The viewer accepts this companion file only when its tree SHA-256 matches `tree.json`; future bundles create it automatically. For a completed run, add the companion file without rewriting the frozen tree or analysis outputs:

```bash
# Link the existing local draft to its original sample metadata.
python3 scripts/phylogeny_record_links.py \
  --tree docs/data/phylogeny-review/cox1_20261105/tree.json \
  --metadata runs/cox1/exploratory_20261105_v4/metadata.json \
  --output docs/data/phylogeny-review/cox1_20261105/record_links.json
```

This does not certify or publish any record. A future reviewed release must generate its companion file against the exact released tree (including any status change); public sample dialogs resolve only records in the published register.

## iNaturalist species overlay

The optional map overlay queries the public iNaturalist API for Varroa (taxon 194696), Research Grade, species or lower rank, and public mappable coordinates. It loads at most 1,000 recent observation IDs, shows the loaded/total counts and retrieval date, and links each observation to its source and observer attribution. It reads no private coordinates. Obscured coordinates remain approximate and their dates are reduced to month precision.

The layer has its own species selector, independent of curated host/lineage filters. It does not enter the record registry or its counts, imply a mitochondrial assignment, certify a record, or appear in curated CSV/SVG exports. It requires internet access; the curated map remains available if the external API fails. Research Grade can also exist above species level, so the species-rank filter is applied explicitly. See [iNaturalist API](https://api.inaturalist.org/v1/docs/), [Research Grade](https://help.inaturalist.org/en/support/solutions/articles/151000169936-what-is-the-data-quality-assessment-and-how-do-i-use-it-) and [geoprivacy](https://help.inaturalist.org/en/support/solutions/articles/151000169938).

The home-page artwork is copied from the two illustrations supplied by the curator. Both original files remain unchanged.

## Lineage areas on the map

**Shade lineage areas** draws translucent convex outlines from the current filtered point records, separately for each species and mitochondrial display group. Sites are joined into connected components using a great-circle gap of 500, 1,500 (default), or 3,000 km; this is a display setting, not a biological dispersal parameter. Each component needs at least three unique, non-collinear coordinates. Duplicate records still appear in the popup count but cannot create an area on their own. Existing broad K-group classifications and separate study-specific T/J labels are retained.

Outlines use the map's Mercator projection. Pacific components are unwrapped and split at the antimeridian; components spanning 180 degrees or more in longitude, and polar points beyond Mercator's supported latitude, receive no area. Point markers remain unchanged. These polygons can cover unsampled land and sea. They are sampling envelopes, not confirmed continuous ranges, abundance estimates, or predictions of suitable habitat. Country-only observations, unresolved mitochondrial calls, and iNaturalist records never contribute. Approximate localities contribute unless removed with the existing precision filter.

The layer appears with mitochondrial-group colours, responds to filters, is retained in shared URLs, and is included in the curated SVG export with a methods caption. Its geometry is implemented in `docs/assets/lineage_areas.js`; run `node scripts/test_lineage_areas.cjs` for input preservation, duplicate, sparse-site, exclusion, separation, distance, and antimeridian checks.

## Shared page layout

`page_document()` in `scripts/build_resource.py` supplies the header, navigation, main wrapper and footer for all six active pages. The builder also creates `scripts/templates/maps-layout.html`, which R Markdown uses with `html_document` and no separate report theme. `docs/assets/resource.css` controls common type and spacing; `styles_customized.css` controls map elements only. Use `scripts/build_site.sh` after layout changes so the self-contained Maps page embeds the same current assets. Runnable map code remains available in collapsed Code sections.

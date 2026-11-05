"""Infer a draft tree without assigning or approving canonical lineage names."""
import re
from pathlib import Path

for field in ["run_id", "intake"]:
    if not config.get(field):
        raise ValueError(f"Set {field} in the exploratory config")
if not re.fullmatch(r"[A-Za-z0-9_-]+", config["run_id"]):
    raise ValueError("Use a new, simple run ID")
run = "runs/cox1/" + config["run_id"]
helper = str(Path(workflow.basedir).parents[1] / "scripts/cox1_exploratory.py")
tree_helper = str(Path(workflow.basedir).parents[1] / "scripts/cox1_analysis.py")

rule all:
    input:
        run + "/tree.treefile",
        run + "/window_qc.tsv",
        run + "/taiwan_reference_comparisons.tsv"

rule prepare:
    input:
        seq=config["intake"] + "/sequences.fasta",
        records=config["intake"] + "/records.json",
        manifest=config["intake"] + "/manifest.json",
        catalogue=config.get("catalogue", "docs/data/records.json")
    output:
        queries=run + "/queries.fasta",
        backbone=run + "/backbone_unaligned.fasta",
        metadata=run + "/metadata.json",
        manifest=run + "/inputs.json"
    params: overlap=config.get("min_overlap", 400)
    conda: "exploratory.environment.yaml"
    shell:
        "python {helper:q} prepare --intake {config[intake]:q} --catalogue {input.catalogue:q} "
        "--out {run:q} --min-overlap {params.overlap}"

rule align:
    input:
        queries=run + "/queries.fasta",
        backbone=run + "/backbone_unaligned.fasta"
    output: run + "/aligned.fasta"
    threads: config.get("threads", 4)
    conda: "exploratory.environment.yaml"
    shell: "python {helper:q} align --out {run:q} --threads {threads}"

rule screen:
    input:
        alignment=run + "/aligned.fasta",
        metadata=run + "/metadata.json",
        manifest=run + "/inputs.json"
    output:
        tree=run + "/tree_input.fasta",
        qc=run + "/window_qc.tsv",
        comparisons=run + "/taiwan_reference_comparisons.tsv"
    conda: "exploratory.environment.yaml"
    shell: "python {helper:q} summarize --out {run:q}"

rule tree:
    input: run + "/tree_input.fasta"
    output: run + "/tree.treefile"
    threads: config.get("threads", 4)
    params: seed=config.get("seed", 20261105)
    conda: "exploratory.environment.yaml"
    shell: "python {tree_helper:q} tree --out {run:q} --threads {threads} --seed {params.seed}"

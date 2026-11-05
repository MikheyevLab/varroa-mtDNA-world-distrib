#!/usr/bin/env python3
"""Add exact sequence-to-record links without changing a completed tree or its inputs."""
import argparse
import hashlib
import json
from pathlib import Path


def write_links(tree_path, metadata_path, output):
    tree_path, metadata_path, output = map(Path, (tree_path, metadata_path, output))
    tree = json.loads(tree_path.read_text())
    metadata = json.loads(metadata_path.read_text())
    members = {}
    for accession in tree['members']:
        record = metadata[accession]
        if record['accession'] != accession or not record.get('record_id'):
            raise ValueError('Sequence links require an exact accession version and source record ID')
        qualifiers = record.get('source', {}).get('qualifiers', {})
        identifiers = {key: qualifiers[key] for key in ['specimen_voucher', 'isolate', 'strain'] if qualifiers.get(key)}
        members[accession] = dict(record_id=record['record_id'], identifiers=identifiers,
                                 sample_name=next(iter(identifiers.values()), ''))
    payload = dict(tree_sha256=hashlib.sha256(tree_path.read_bytes()).hexdigest(),
                   metadata_sha256=hashlib.sha256(metadata_path.read_bytes()).hexdigest(), members=members)
    content = json.dumps(payload, ensure_ascii=False, indent=2)+'\n'
    if output.exists():
        if output.read_text() != content:
            raise ValueError('Preserve earlier sequence links; choose a new output path')
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(content)
    return payload


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tree',required=True)
    parser.add_argument('--metadata',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    result=write_links(args.tree,args.metadata,args.output)
    print(f"Linked {len(result['members'])} accession versions to their source records; tree unchanged.")

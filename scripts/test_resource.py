"""Meaningful release/QC checks using synthetic records, never real certifications."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from record_review import fingerprint, reviewed
from sequence_intake import genbank_records, qc, read_fasta
from cox1_analysis import compare, validate_references, digest, write_once


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.record = dict(record_id="TEST", species="Varroa destructor", source={"latitude":"1"})

    def event(self, action):
        return dict(record_id="TEST", action=action, fingerprint=fingerprint(self.record),
                    reviewer="Synthetic test reviewer", timestamp="2026-01-01", note="TEST ONLY")

    def test_baseline_is_public_but_not_verified(self):
        result = reviewed(self.record, [], baseline=True)
        self.assertEqual(result["verification_status"], "not_verified")
        self.assertEqual(result["publication_status"], "published")

    def test_import_needs_verification_and_release(self):
        self.assertEqual(reviewed(self.record, [self.event("release")])["publication_status"], "pending_review")
        self.assertEqual(reviewed(self.record, [self.event("verify")])["publication_status"], "pending_review")
        self.assertEqual(reviewed(self.record, [self.event("verify"), self.event("release")])["publication_status"], "published")

    def test_change_invalidates_manual_certification_and_release(self):
        changed = {**self.record, "source":{"latitude":"2"}}
        result = reviewed(changed, [self.event("verify"), self.event("release")])
        self.assertEqual(result["verification_status"], "needs_recheck")
        self.assertEqual(result["publication_status"], "pending_review")

    def test_revoke_and_withdraw_preserve_history(self):
        events = [self.event("verify"), self.event("release"), self.event("revoke")]
        self.assertEqual(reviewed(self.record, events)["verification_status"], "not_verified")
        self.assertEqual(reviewed(self.record, events)["publication_status"], "pending_review")
        self.assertEqual(len(events), 3)

    def test_display_fields_do_not_change_hash(self):
        self.assertEqual(fingerprint(self.record), fingerprint(reviewed(self.record, [])))


class SequenceTests(unittest.TestCase):
    def test_sequence_quality_and_mitochondrial_code(self):
        self.assertEqual(qc("TGA"*101, codon_start=1), [])
        self.assertIn("internal_stop_in_annotated_frame", qc("TAG"*101, codon_start=1))
        self.assertIn("too_many_ambiguous_bases", qc("N"*300))
        self.assertIn("length_outside_configured_range", qc("A"*20))

    def test_duplicate_fasta_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/"test.fasta"
            path.write_text(">x\nAAA\n>x\nAAA\n")
            with self.assertRaises(ValueError):
                read_fasta(path)

    def test_genbank_reverse_strand_and_other_gene(self):
        sequence = "CAT"*101
        xml=f'''<GBSet><GBSeq><GBSeq_accession-version>TEST1.1</GBSeq_accession-version><GBSeq_organism>Varroa destructor</GBSeq_organism><GBSeq_sequence>{sequence}</GBSeq_sequence><GBSeq_feature-table><GBFeature><GBFeature_key>CDS</GBFeature_key><GBFeature_location>complement(1..303)</GBFeature_location><GBFeature_intervals><GBInterval><GBInterval_from>1</GBInterval_from><GBInterval_to>303</GBInterval_to><GBInterval_iscomp value="true"/></GBInterval></GBFeature_intervals><GBFeature_quals><GBQualifier><GBQualifier_name>gene</GBQualifier_name><GBQualifier_value>COX1</GBQualifier_value></GBQualifier></GBFeature_quals></GBFeature></GBSeq_feature-table></GBSeq></GBSet>'''
        rows=list(genbank_records(xml,"TEST","2026-01-01"))
        self.assertEqual(rows[0][1],"ATG"*101)
        self.assertEqual(rows[0][2],[])
        other=list(genbank_records(xml.replace("COX1","COX2"),"TEST","2026-01-01"))
        self.assertEqual(other[0][1],"")
        self.assertIn("no_unique_annotated_COX1_feature",other[0][2])

    def test_reference_approval_required_and_hash_bound(self):
        with tempfile.TemporaryDirectory() as folder:
            d=Path(folder); refs=d/"refs.fasta";meta=d/"refs.tsv";review=d/"review.json"
            refs.write_text(">r1\nAAA\n>r2\nAAT\n>r3\nAAC\n")
            meta.write_text("sequence_id\tcanonical_lineage\treference\nr1\tK\ttest\nr2\tJ\ttest\nr3\tT\ttest\n")
            review.write_text(json.dumps(dict(approved=False)))
            with self.assertRaises(ValueError):validate_references(refs,meta,review)
            review.write_text(json.dumps(dict(approved=True,reviewer="TEST",reviewed_at="2026-01-01",alignment_sha256=digest(refs),metadata_sha256=digest(meta))))
            self.assertEqual(len(validate_references(refs,meta,review)[0]),3)
            refs.write_text(refs.read_text().replace("AAC","AAG"))
            with self.assertRaises(ValueError):validate_references(refs,meta,review)

    def test_identical_reference_labels_stay_ambiguous(self):
        with tempfile.TemporaryDirectory() as folder:
            d=Path(folder)
            (d/"aligned.fasta").write_text(">r1\nAAAA\n>r2\nAAAA\n>r3\nAAAT\n>q\nAAAA\n")
            (d/"inputs.json").write_text(json.dumps(dict(reference_ids=["r1","r2","r3"],query_ids=["q"])))
            meta=d/"refs.tsv";meta.write_text("sequence_id\tcanonical_lineage\nr1\tK\nr2\tT\nr3\tJ\n")
            compare(SimpleNamespace(out=d,metadata=meta,min_overlap=4,max_ambiguity=.02))
            self.assertIn("unresolved_tied_labels",(d/"reference_comparisons.tsv").read_text())
            self.assertNotIn("\tverified",(d/"reference_comparisons.tsv").read_text())

    def test_historical_output_cannot_be_replaced(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/"result.txt";write_once(p,"original")
            with self.assertRaises(ValueError):write_once(p,"replacement")
            self.assertEqual(p.read_text(),"original")


if __name__ == "__main__":
    unittest.main(verbosity=2)

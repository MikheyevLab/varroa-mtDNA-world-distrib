"""Regression checks for accession matching and homologous-window screening."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from cox1_exploratory import accessions, select_window, summarize
from cox1_analysis import fasta


class ExploratoryTests(unittest.TestCase):
    def test_compressed_catalogue_and_explicit_ranges(self):
        self.assertEqual(accessions("GQ379065,084,103,122"),
                         {"GQ379065","GQ379084","GQ379103","GQ379122"})
        self.assertEqual(accessions("OK335527–OK335531"),{"OK"+str(n) for n in range(335527,335532)})
        self.assertEqual(accessions("LN873222-25"),{"LN"+str(n) for n in range(873222,873226)})
        with self.assertRaises(ValueError):
            accessions("OK335531–OK335527")

    def test_window_tracks_anchor_bases_not_alignment_columns(self):
        aligned={"anchor":"--"+"A"*458+"---", "query":"CC"+"G"*458+"TTT"}
        windows, positions=select_window(aligned,"anchor")
        self.assertEqual(windows["query"],"G"*458)
        self.assertEqual((positions[0],positions[-1]),(2,459))

    def test_unrelated_fragment_is_not_a_placement_and_gaps_do_not_merge(self):
        with tempfile.TemporaryDirectory() as folder:
            d=Path(folder)
            seqs={"AF106899.1":"A"*458,"AF106900.1":"A"*457+"C",
                  "AF107260.1":"A"*457+"G","AF107261.2":"A"*457+"T",
                  "short":"A"*399+"-"*59,"partial":"A"*400+"-"*58,
                  "unrelated":"C"*458}
            meta={a:dict(source=dict(automated_qc="candidate_pass",feature=dict(codon_start="3")),
                         species="Synthetic",source_annotations=[]) for a in seqs}
            (d/"inputs.json").write_text(json.dumps(dict(anchor="AF106899.1",minimum_overlap=400,maximum_anchor_p_distance=.15)))
            (d/"metadata.json").write_text(json.dumps(meta))
            (d/"aligned.fasta").write_text(fasta(seqs))
            summarize(SimpleNamespace(out=d))
            qc=(d/"window_qc.tsv").read_text()
            self.assertIn("short\tinsufficient_window_overlap",qc)
            self.assertIn("unrelated\tdivergent_alignment_needs_review",qc)
            groups=json.loads((d/"groups.json").read_text())
            self.assertTrue(any(v == ["partial"] for v in groups.values()))
            self.assertEqual(json.loads((d/"summary.json").read_text())["included"],5)


if __name__ == "__main__":
    unittest.main(verbosity=2)

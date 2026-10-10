import tempfile
import unittest
import json
from types import SimpleNamespace
from pathlib import Path

import numpy as np

from mapping_minilm import (
    allowed_forms,
    cache_embeddings,
    chunk_ids,
    compatible_pos,
    digest,
    pick_hits,
    project_jmdict_sense,
    read_ref,
    retrieve,
    rooted,
    write_json,
)


def sense(pos=None, glosses=2):
    return {
        "sense": {"forms": ["猫", "ねこ"], "lemma": "猫", "reading": "ねこ"},
        "senseContext": {
            "metadata": {
                "normalizedPos": pos or ["noun"],
                "appliesToKana": ["*"],
                "appliesToKanji": ["*"],
                "rawAttributes": {},
            },
            "enGlosses": ["gloss"] * glosses,
        },
    }


def concept(id, pos="noun", ja=None):
    return {
        "id": str(id),
        "semanticKey": "concept:" + str(id),
        "pos": pos,
        "jaLabels": ja or [],
    }


class RetrievalTests(unittest.TestCase):
    def test_blocked_only_export_does_not_load_or_download_model(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = {
                "key": "jmdict",
                "code": "jmdict",
                "sourceId": 1,
                "version": "1",
                "snapshot": None,
                "sha256": None,
                "batchIds": [],
                "license": None,
                "attribution": None,
                "url": None,
                "audit": {
                    "status": "blocked",
                    "evidence": [],
                    "reasons": ["unverified"],
                },
            }
            row = {
                "sense": {"id": "1", "semanticKey": "test", "identity": None},
                "sourceKeys": ["jmdict"],
                "wordnetIdentity": None,
                "existingLinks": [],
                "senseContext": {"enGlosses": [], "definitions": []},
            }
            (root / "senses.jsonl").write_text(json.dumps(row) + "\n")
            (root / "concepts.jsonl").write_text("")
            files = {
                "senses": {
                    "path": "senses.jsonl",
                    "sha256": digest(root / "senses.jsonl"),
                },
                "concepts": {
                    "path": "concepts.jsonl",
                    "sha256": digest(root / "concepts.jsonl"),
                },
                "sources": write_json(root, "sources.json", [source]),
                "inventory": write_json(root, "inventory.json", {}),
            }
            export = {
                "schemaVersion": 1,
                "task": "db4_retrieval_export",
                "files": files,
                "counts": {"senses": 1, "concepts": 0},
                "snapshot": {
                    "mode": "fixture",
                    "senseInputHash": files["senses"]["sha256"],
                    "conceptInputHash": files["concepts"]["sha256"],
                },
            }
            export_ref = write_json(root, "export.json", export)
            write_json(
                root,
                "audit.json",
                {
                    "schemaVersion": 1,
                    "task": "db4_retrieval_source_audit",
                    "exportSha256": export_ref["sha256"],
                    "sources": [source],
                },
            )
            retrieve(
                SimpleNamespace(
                    artifact_dir=folder,
                    export="export.json",
                    audit="audit.json",
                    prefix="search",
                    download_model=True,
                )
            )
            result = json.loads((root / "search/manifest.json").read_text())
            self.assertFalse(result["metrics"]["modelUsed"])
            self.assertEqual(result["metrics"]["statuses"], {"blocked_source": 1})
            self.assertFalse((root / "models").exists())

    def test_embedding_checkpoint_resumes_and_warm_cache_skips_encoder(self):
        class FakeEncoder:
            calls = 0

            def __init__(self, fail=False):
                self.fail = fail

            def encode(self, texts):
                self.calls += 1
                if self.fail and self.calls == 2:
                    raise RuntimeError("interrupted")
                return np.array(
                    [[float(text)] * 384 for text in texts], dtype=np.float32
                )

        docs = [str(i) for i in range(300)]
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            with self.assertRaises(RuntimeError):
                cache_embeddings(FakeEncoder(True), docs, cache, "key")
            self.assertFalse((cache / "build.lock").exists())
            second = FakeEncoder()
            vectors, hit, resumed = cache_embeddings(second, docs, cache, "key")
            self.assertFalse(hit)
            self.assertEqual(resumed, 256)
            self.assertEqual(second.calls, 1)
            self.assertEqual(float(vectors[299, 0]), 299)
            third = FakeEncoder()
            _, hit, resumed = cache_embeddings(third, docs, cache, "key")
            self.assertTrue(hit)
            self.assertEqual(third.calls, 0)

    def test_embedding_cache_corruption_is_not_reused(self):
        class FakeEncoder:
            def encode(self, texts):
                return np.ones((len(texts), 384), dtype=np.float32)

        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            cache_embeddings(FakeEncoder(), ["cat"], cache, "key")
            vectors = np.load(cache / "vectors.npy", mmap_mode="r+")
            vectors[0, 0] = 999
            vectors.flush()
            with self.assertRaises(ValueError):
                cache_embeddings(FakeEncoder(), ["cat"], cache, "key")

    def test_embedding_build_lock_prevents_parallel_writers(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            (cache / "build.lock").write_text("another worker")
            with self.assertRaises(FileExistsError):
                cache_embeddings(None, ["cat"], cache, "key")
            self.assertTrue((cache / "build.lock").exists())

    def test_jmdict_projection_only_removes_examples(self):
        raw = {
            "gloss": ["cat"],
            "partOfSpeech": ["n"],
            "examples": ["example"],
            "appliesToKana": ["ねこ"],
        }
        projected = project_jmdict_sense(raw)
        self.assertEqual(set(raw) - set(projected), {"examples"})
        self.assertEqual(projected["gloss"], ["cat"])
        self.assertEqual(projected["appliesToKana"], ["ねこ"])

    def test_chunks_do_not_drop_late_tokens(self):
        ids = list(range(1000))
        chunks = chunk_ids(ids)
        self.assertEqual(set(ids), {t for chunk in chunks for t in chunk})
        self.assertTrue(all(len(c) <= 254 for c in chunks))
        self.assertEqual(chunks[-1][-1], 999)

    def test_exact_boundary_does_not_add_empty_chunk(self):
        self.assertEqual(len(chunk_ids(list(range(254)))), 1)
        self.assertEqual(chunk_ids([]), [[]])
        with self.assertRaises(ValueError):
            chunk_ids([1], 10, 10)

    def test_pos_filter_and_unknown(self):
        self.assertFalse(compatible_pos(sense(), concept(1, "verb")))
        self.assertTrue(compatible_pos(sense(["unknown"]), concept(1, "verb")))
        self.assertTrue(compatible_pos(sense(["noun", "verb"]), concept(1, "verb")))

    def test_all_glosses_participate_in_shortlist(self):
        concepts = [concept(1), concept(2), concept(3)]
        global_scores = np.array([0.9, 0.7, 0.8])
        branches = np.array([[0.99, 0.1, 0.6], [0.1, 0.99, 0.6]])
        hits = pick_hits(global_scores, branches, concepts, set(), sense(), top_k=2)
        self.assertEqual({h["conceptId"] for h in hits}, {"1", "2"})
        self.assertTrue(
            all(h["features"]["scoreIsExactProbability"] is False for h in hits)
        )

    def test_pos_excludes_high_similarity_wrong_candidate(self):
        hits = pick_hits(
            np.array([0.99, 0.7]),
            np.array([[0.99, 0.7]]),
            [concept(1, "verb"), concept(2)],
            set(),
            sense(),
        )
        self.assertEqual([h["conceptId"] for h in hits], ["2"])

    def test_restriction_filters_lexical_seed_evidence(self):
        s = sense()
        s["sense"]["forms"].append("別表記")
        s["senseContext"]["metadata"]["appliesToKanji"] = ["別表記"]
        self.assertEqual(allowed_forms(s), {"別表記", "ねこ"})
        hits = pick_hits(
            np.array([0.9, 0.8]),
            np.array([[0.9, 0.8]]),
            [concept(1, ja=["猫"]), concept(2, ja=["別表記"])],
            {"1", "2"},
            s,
        )
        self.assertFalse(hits[0]["features"]["lexicalSeed"])
        self.assertTrue(hits[1]["features"]["lexicalSeed"])

    def test_ties_are_deterministic_and_maximum_is_five(self):
        concepts = [concept(i) for i in range(30)]
        hits = pick_hits(np.ones(30), np.ones((1, 30)), concepts, set(), sense())
        self.assertEqual(len(hits), 5)
        self.assertEqual(
            hits, pick_hits(np.ones(30), np.ones((1, 30)), concepts, set(), sense())
        )
        with self.assertRaises(ValueError):
            pick_hits(np.ones(30), np.ones((1, 30)), concepts, set(), sense(), top_k=6)

    def test_empty_compatible_pool_is_unresolved_not_forced(self):
        hits = pick_hits(
            np.array([0.99]), np.array([[0.99]]), [concept(1, "verb")], set(), sense()
        )
        self.assertEqual(hits, [])

    def test_artifact_integrity_and_immutable_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            ref = write_json(root, "sub/audit.json", {"sample": True})
            self.assertEqual(digest(read_ref(root, ref)), ref["sha256"])
            with self.assertRaises(FileExistsError):
                write_json(root, "sub/audit.json", {})
            (root / ref["path"]).write_text("changed")
            with self.assertRaises(ValueError):
                read_ref(root, ref)

    def test_path_escape_and_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as other:
            root = Path(folder)
            (root / "escape").symlink_to(other)
            for name in [
                "../escape.json",
                "/abs.json",
                "x\\a",
                "x:y",
                "escape/audit.json",
            ]:
                with self.assertRaises(ValueError):
                    rooted(root, name)


if __name__ == "__main__":
    unittest.main()

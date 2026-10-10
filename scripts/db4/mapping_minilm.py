#!/usr/bin/env python3
"""DB4-D2: audit immutable artifacts, then retrieve with pinned MiniLM on CPU.

No PostgreSQL client, LLM call, promotion or application runtime dependency.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
import time
from pathlib import Path

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
VERSION = "db4-d2-minilm-v1"
MODEL_CONFIG_FILES = [
    "tokenizer.json",
    "1_Pooling/config.json",
    "sentence_bert_config.json",
]


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def rooted(root: Path, name: str) -> Path:
    parts = name.split("/")
    if (
        not name
        or any(p in ("", ".", "..") for p in parts)
        or ":" in name
        or "\\" in name
        or any(ord(c) < 32 or ord(c) == 127 for c in name)
    ):
        raise ValueError("Invalid artifact path")
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Artifact escapes root")
    return path


def read_ref(root: Path, ref: dict) -> Path:
    path = rooted(root, ref["path"])
    if digest(path) != ref["sha256"]:
        raise ValueError("Artifact hash mismatch: " + ref["path"])
    return path


def write_json(root: Path, name: str, value) -> dict:
    path = rooted(root, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    return {"path": name, "sha256": digest(path)}


def lines(path: Path):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def project_jmdict_sense(raw: dict) -> dict:
    # import_core.py deliberately stores sense attributes without the examples array.
    return {key: value for key, value in raw.items() if key != "examples"}


def load_export(root: Path, name: str):
    path = rooted(root, name)
    manifest = json.loads(path.read_text())
    if manifest["task"] != "db4_retrieval_export" or manifest["schemaVersion"] != 1:
        raise ValueError("Invalid export manifest")
    for ref in manifest["files"].values():
        read_ref(root, ref)
    if (
        manifest["snapshot"]["senseInputHash"] != manifest["files"]["senses"]["sha256"]
        or manifest["snapshot"]["conceptInputHash"]
        != manifest["files"]["concepts"]["sha256"]
    ):
        raise ValueError("Unbound semantic snapshot")
    return manifest, path


def audited_sources(root: Path, export_path: Path, manifest: dict, audit_name: str):
    path = rooted(root, audit_name)
    audit = json.loads(path.read_text())
    if (
        audit["task"] != "db4_retrieval_source_audit"
        or audit["schemaVersion"] != 1
        or audit["exportSha256"] != digest(export_path)
    ):
        raise ValueError("Source audit belongs to another export")
    original = json.loads(read_ref(root, manifest["files"]["sources"]).read_text())
    if len(audit["sources"]) != len(original):
        raise ValueError("Incomplete source audit")
    for source, before in zip(audit["sources"], original):
        if any(
            source[k] != before[k]
            for k in [
                "key",
                "code",
                "sourceId",
                "version",
                "snapshot",
                "sha256",
                "batchIds",
            ]
        ):
            raise ValueError("Source audit rewrote identity")
        for ref in source["audit"]["evidence"]:
            read_ref(root, ref)
        if source["audit"]["status"] == "verified" and (
            not source["sha256"]
            or not (source["version"] or source["snapshot"])
            or not source["batchIds"]
            or not source["audit"]["evidence"]
            or not source["license"]
            or not source["attribution"]
            or not source["url"]
            or source["audit"]["reasons"]
        ):
            raise ValueError("Incomplete verified source provenance")
        if (
            source["audit"]["status"] == "verified"
            and manifest["snapshot"]["mode"] == "production"
        ):
            reports = []
            for ref in source["audit"]["evidence"]:
                try:
                    report = json.loads(read_ref(root, ref).read_text())
                    if report.get("task") == "db4_raw_source_checks":
                        reports.append(report)
                except (ValueError, UnicodeDecodeError):
                    pass
            if not any(
                r["exportSha256"] == digest(export_path)
                and r["checks"].get(source["key"], {}).get("checked", 0) > 0
                and not r["checks"][source["key"]].get("failureCount", 0)
                and not r["checks"][source["key"]]["failures"]
                and (
                    source["code"] not in ("oewn", "omw-en", "omw-ja")
                    or r["wnSha256"] == source["sha256"]
                )
                for r in reports
            ):
                raise ValueError(
                    "Verified source requires passing raw checks bound to export"
                )
    return {s["key"]: s for s in audit["sources"]}, path


def audit_sources(args):
    import ijson

    root = Path(args.artifact_dir).resolve()
    manifest, export_path = load_export(root, args.export)
    sources = json.loads(read_ref(root, manifest["files"]["sources"]).read_text())
    licensing_path = rooted(root, args.licenses)
    licensing = json.loads(licensing_path.read_text())
    licenses_sha = digest(licensing_path)
    wn_path = Path(args.wn_db).resolve()
    wn_sha = digest(wn_path)
    sqlite = sqlite3.connect(wn_path.as_uri() + "?mode=ro", uri=True)
    sqlite.execute("PRAGMA query_only=ON")
    lexicons = {
        r[0]: {
            "specifier": r[1],
            "code": r[2],
            "version": r[3],
            "license": r[4],
            "language": r[5],
            "modified": bool(r[6]),
        }
        for r in sqlite.execute(
            "SELECT rowid,specifier,id,version,license,language,modified FROM lexicons"
        )
    }
    synsets = {}
    for rowid, sid, lexid, ili, pos in sqlite.execute(
        "SELECT s.rowid,s.id,s.lexicon_rowid,i.id,s.pos FROM synsets s LEFT JOIN ilis i ON i.rowid=s.ili_rowid"
    ):
        lex = lexicons[lexid]
        synsets[(lex["specifier"], sid)] = {
            "rowid": rowid,
            "ili": ili,
            "pos": pos,
            "source": lex["code"],
            "defs": set(),
            "members": set(),
        }
    by_rowid = {s["rowid"]: s for s in synsets.values()}
    for sid, lang, text, lexid in sqlite.execute(
        "SELECT synset_rowid,language,definition,lexicon_rowid FROM definitions"
    ):
        if sid in by_rowid and text:
            by_rowid[sid]["defs"].add((lang or lexicons[lexid]["language"], text))
    for sid, form in sqlite.execute(
        "SELECT s.synset_rowid,f.form FROM senses s JOIN forms f ON f.entry_rowid=s.entry_rowid AND f.rank=0"
    ):
        if sid in by_rowid:
            by_rowid[sid]["members"].add(form)
    sqlite.close()
    checks = {s["key"]: {"checked": 0, "failures": []} for s in sources}

    def failure(key, detail):
        # Keep count exact without a huge error artifact.
        item = checks[key]
        item["failureCount"] = item.get("failureCount", 0) + 1
        if len(item["failures"]) < 20:
            item["failures"].append(detail)

    def check(key, condition, detail):
        if key not in checks:
            raise ValueError("Unknown evidence source")
        checks[key]["checked"] += 1
        if not condition:
            failure(key, detail)

    wn_sources = {v["code"]: v for v in lexicons.values()}
    source_by_key = {s["key"]: s for s in sources}
    for source in sources:
        if source["key"] in wn_sources:
            lex = wn_sources[source["key"]]
            check(
                source["key"],
                source["sha256"] == wn_sha
                and source["version"] == lex["version"]
                and not lex["modified"],
                "Raw wn.db hash/version/modified mismatch",
            )
    for concept in lines(read_ref(root, manifest["files"]["concepts"])):
        anchors = concept["concept"]["synsetKeys"]
        context = concept["conceptContext"]
        for anchor in anchors:
            raw = synsets.get((anchor["lexicon"], anchor["synsetId"]))
            lineage = [
                v
                for v in concept["synsetLineage"]
                if v["lexicon"] == anchor["lexicon"]
                and v["synsetId"] == anchor["synsetId"]
                and v["sourceKey"] == anchor["sourceKey"]
            ]
            check(
                anchor["sourceKey"],
                raw is not None
                and raw["source"] == anchor["sourceKey"]
                and raw["ili"] == concept["concept"]["ili"]
                and {
                    "n": "noun",
                    "v": "verb",
                    "a": "adjective",
                    "s": "adjective",
                    "r": "adverb",
                }.get(raw["pos"], "unknown")
                == concept["concept"]["pos"]
                and len(lineage) == 1
                and lineage[0]["batchId"]
                in source_by_key[anchor["sourceKey"]]["batchIds"],
                "Synset/ILI/POS mismatch: " + anchor["synsetId"],
            )
        evidence = {e["key"]: e for e in concept["evidence"]}
        for row in context["definitions"] + context["labels"]:
            e = evidence[row["evidenceKey"]]
            source = source_by_key[e["sourceKey"]]
            raw = [
                synsets.get((a["lexicon"], a["synsetId"]))
                for a in anchors
                if a["sourceKey"] == source["key"]
            ]
            raw = [r for r in raw if r is not None]
            matched = (
                any((row["language"], row["text"]) in r["defs"] for r in raw)
                if row["kind"] == "definition"
                else any(row["text"] in r["members"] for r in raw)
            )
            check(
                source["key"],
                matched
                and e["sourceHash"] == source["sha256"]
                and e["batchId"] in source["batchIds"],
                "Concept row lineage mismatch: " + row["key"],
            )
    senses = list(lines(read_ref(root, manifest["files"]["senses"])))
    wanted = {}
    for item in senses:
        identity = item["sense"]["identity"]
        if identity and identity["sourceKey"] == "jmdict":
            wanted.setdefault(identity["externalId"].split(":")[-1], []).append(item)
        elif item["wordnetIdentity"]:
            anchor = item["wordnetIdentity"]
            raw = synsets.get((anchor["lexicon"], anchor["synsetId"]))
            check(
                anchor["sourceKey"],
                raw is not None and item["sense"]["lemma"] in raw["members"],
                "WordNet sense membership mismatch",
            )
            check(
                anchor["sourceKey"],
                raw is not None
                and {
                    "n": "noun",
                    "v": "verb",
                    "a": "adjective",
                    "s": "adjective",
                    "r": "adverb",
                }.get(raw["pos"], "unknown")
                in item["senseContext"]["metadata"]["normalizedPos"],
                "WordNet sense POS mismatch",
            )
            for e in item["evidence"]:
                check(
                    e["sourceKey"],
                    e["sourceHash"] == source_by_key[e["sourceKey"]]["sha256"]
                    and e["batchId"] in source_by_key[e["sourceKey"]]["batchIds"],
                    "WordNet sense batch mismatch",
                )
            for row in (
                item["senseContext"]["enGlosses"] + item["senseContext"]["definitions"]
            ):
                check(
                    anchor["sourceKey"],
                    raw is not None and (row["language"], row["text"]) in raw["defs"],
                    "WordNet sense definition mismatch",
                )
        else:
            for key in item["sourceKeys"]:
                failure(
                    key, "Source sense anchor is missing or unsupported by this auditor"
                )
    if wanted:
        if not args.jmdict:
            failure("jmdict", "Missing JMdict raw file")
        else:
            path = Path(args.jmdict)
            check(
                "jmdict",
                digest(path) == source_by_key["jmdict"]["sha256"],
                "JMdict raw hash mismatch",
            )
            with path.open("rb") as stream:
                version = next(ijson.items(stream, "version"), None)
            check(
                "jmdict",
                version == source_by_key["jmdict"]["version"],
                "JMdict version mismatch",
            )
            found = set()
            with path.open("rb") as stream:
                for entry in ijson.items(stream, "words.item"):
                    entry_id = str(entry["id"])
                    if entry_id not in wanted:
                        continue
                    found.add(entry_id)
                    for item in wanted[entry_id]:
                        sense_no = item["sense"]["senseNo"]
                        raw_senses = entry["sense"]
                        raw = (
                            raw_senses[sense_no - 1]
                            if 0 < sense_no <= len(raw_senses)
                            else None
                        )
                        context = item["senseContext"]
                        check(
                            "jmdict",
                            raw is not None
                            and project_jmdict_sense(raw)
                            == context["metadata"]["rawAttributes"],
                            "JMdict raw attributes mismatch: "
                            + item["sense"]["semanticKey"],
                        )
                        en = (
                            [g["text"] for g in raw["gloss"] if g["lang"] == "eng"]
                            if raw
                            else []
                        )
                        check(
                            "jmdict",
                            en == [g["text"] for g in context["enGlosses"]],
                            "JMdict complete EN gloss mismatch",
                        )
                        forms = {f["text"] for f in entry["kanji"] + entry["kana"]}
                        reading = item["sense"]["reading"]
                        check(
                            "jmdict",
                            item["sense"]["lemma"] in forms
                            and set(item["sense"]["forms"]) == forms
                            and (
                                reading is None
                                or reading in {f["text"] for f in entry["kana"]}
                            ),
                            "JMdict complete form/reading mismatch",
                        )
                        for e in item["evidence"]:
                            check(
                                "jmdict",
                                e["sourceKey"] == "jmdict"
                                and e["sourceHash"] == source_by_key["jmdict"]["sha256"]
                                and e["batchId"] in source_by_key["jmdict"]["batchIds"],
                                "JMdict batch/evidence mismatch",
                            )
            check("jmdict", found == set(wanted), "Missing source entries")
    prefix = args.prefix
    report = {
        "task": "db4_raw_source_checks",
        "exportSha256": digest(export_path),
        "wnSha256": wn_sha,
        "licensesSha256": licenses_sha,
        "checks": checks,
        "policy": "Raw source bytes + sense/definition/member/synset identity; no semantic alignment acceptance.",
        "jmdictProjection": "core.sense.attributes = source sense minus examples; all other attributes checked exactly",
    }
    report_ref = write_json(root, prefix + "/raw-checks.json", report)
    for source in sources:
        key = source["key"]
        license_info = licensing.get(key)
        reasons = []
        if not checks[key]["checked"] or checks[key].get("failureCount", 0):
            reasons.append("Raw source check missing/failed; see raw-checks.json")
        if not license_info:
            reasons.append("Missing reviewed license evidence")
        if not source["batchIds"]:
            reasons.append("Missing successful matching source batch")
        if license_info:
            for field in ("license", "attribution", "url", "evidence"):
                if not license_info.get(field):
                    raise ValueError("Incomplete license policy")
            for ref in license_info["evidence"]:
                read_ref(root, ref)
            source.update(
                {k: license_info[k] for k in ["license", "attribution", "url"]}
            )
        source["audit"] = {
            "status": "blocked" if reasons else "verified",
            "evidence": [report_ref, {"path": args.licenses, "sha256": licenses_sha}]
            + (license_info["evidence"] if license_info else []),
            "reasons": reasons,
        }
    ref = write_json(
        root,
        prefix + "/sources-audited.json",
        {
            "schemaVersion": 1,
            "task": "db4_retrieval_source_audit",
            "exportSha256": digest(export_path),
            "sources": sources,
        },
    )
    print(
        json.dumps(
            {"audit": ref, "sources": {s["key"]: s["audit"]["status"] for s in sources}}
        )
    )


def allowed_forms(sense: dict) -> set[str]:
    metadata = sense["senseContext"]["metadata"]
    # Restriction applies to retrieval seed evidence; the full original context stays intact.
    kana = metadata["appliesToKana"]
    kanji = metadata["appliesToKanji"]
    forms = set(sense["sense"]["forms"]) | {
        v for v in [sense["sense"]["lemma"], sense["sense"]["reading"]] if v
    }
    if not kana and not kanji:
        return forms
    # Preserve wildcard kana when kanji is restricted, and vice versa.
    # Form kind is inferred only for lexical seed filtering, never semantic acceptance.
    return {
        form
        for form in forms
        if form in kana
        or form in kanji
        or (
            "*"
            in (
                kanji
                if re.search(r"[\u3400-\u9fff\U00020000-\U0003134f]", form)
                else kana
            )
        )
    }


def compatible_pos(sense: dict, concept: dict) -> bool:
    positions = set(sense["senseContext"]["metadata"]["normalizedPos"]) - {"unknown"}
    pos = concept["pos"]
    return not positions or pos is None or pos == "unknown" or pos in positions


def chunk_ids(
    ids: list[int], capacity: int = 254, overlap: int = 32
) -> list[list[int]]:
    if capacity < 1 or overlap < 0 or overlap >= capacity:
        raise ValueError("Invalid token chunk policy")
    chunks = []
    start = 0
    while start < len(ids):
        chunks.append(ids[start : start + capacity])
        if start + capacity >= len(ids):
            break
        start += capacity - overlap
    return chunks or [[]]


class Encoder:
    def __init__(self, model_dir: Path, batch: int, threads: int, onnx_file: str):
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.np = np
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(
            str(model_dir / onnx_file),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tokenizer.no_truncation()
        self.tokenizer.no_padding()
        self.batch = batch
        self.chunk_count = 0
        if (
            json.loads((model_dir / "sentence_bert_config.json").read_text())[
                "max_seq_length"
            ]
            != 256
        ):
            raise ValueError("Unexpected MiniLM sequence length")
        pooling = json.loads((model_dir / "1_Pooling/config.json").read_text())
        if not pooling.get("pooling_mode_mean_tokens") or any(
            pooling.get(k)
            for k in [
                "pooling_mode_cls_token",
                "pooling_mode_max_tokens",
                "pooling_mode_mean_sqrt_len_tokens",
            ]
        ):
            raise ValueError("Unexpected MiniLM pooling")

    def encode(self, texts: list[str]):
        np = self.np
        owners, chunks = [], []
        for owner, text in enumerate(texts):
            ids = self.tokenizer.encode(text, add_special_tokens=False).ids
            for chunk in chunk_ids(ids):
                owners.append(owner)
                chunks.append(
                    [self.tokenizer.token_to_id("[CLS]")]
                    + chunk
                    + [self.tokenizer.token_to_id("[SEP]")]
                )
        self.chunk_count += len(chunks)
        order = sorted(range(len(chunks)), key=lambda i: len(chunks[i]))
        chunks = [chunks[i] for i in order]
        owners = [owners[i] for i in order]
        totals = np.zeros((len(texts), 384), dtype=np.float32)
        counts = np.zeros(len(texts), dtype=np.int32)
        for offset in range(0, len(chunks), self.batch):
            part = chunks[offset : offset + self.batch]
            width = max(map(len, part))
            ids = np.zeros((len(part), width), dtype=np.int64)
            mask = np.zeros_like(ids)
            for i, values in enumerate(part):
                ids[i, : len(values)] = values
                mask[i, : len(values)] = 1
            inputs = {
                "input_ids": ids,
                "attention_mask": mask,
                "token_type_ids": np.zeros_like(ids),
            }
            inputs = {i.name: inputs[i.name] for i in self.session.get_inputs()}
            output = self.session.run(None, inputs)[0]
            if output.ndim != 3 or output.shape[-1] != 384:
                raise ValueError("Unexpected MiniLM output")
            vectors = (output * mask[:, :, None]).sum(axis=1) / mask.sum(axis=1)[
                :, None
            ]
            vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
            for i, owner in enumerate(owners[offset : offset + self.batch]):
                totals[owner] += vectors[i]
                counts[owner] += 1
        totals /= np.maximum(counts[:, None], 1)
        totals /= np.maximum(np.linalg.norm(totals, axis=1, keepdims=True), 1e-12)
        return totals


def pick_hits(scores, branch_scores, concepts, seed_ids, sense, top_k=5, retrieve_k=20):
    import numpy as np

    if not 1 <= top_k <= 5:
        raise ValueError("Contract permits 1..5 candidates")
    eligible = [i for i, c in enumerate(concepts) if compatible_pos(sense, c)]

    def ordered(values):
        return sorted(
            eligible, key=lambda i: (-float(values[i]), concepts[i]["semanticKey"])
        )

    # Use partial top-k to keep search cost bounded; stable key resolves ties at the boundary.
    def shortlist(values):
        if len(eligible) <= retrieve_k:
            return ordered(values)
        ids = np.array(eligible)
        cutoff = float(np.partition(values[ids], -retrieve_k)[-retrieve_k])
        return sorted(
            (i for i in eligible if float(values[i]) >= cutoff),
            key=lambda i: (-float(values[i]), concepts[i]["semanticKey"]),
        )[:retrieve_k]

    global_ids = shortlist(scores)
    per_branch = [shortlist(row) for row in branch_scores]
    permitted_forms = allowed_forms(sense)
    seeds = {
        i
        for i in eligible
        if concepts[i]["id"] in seed_ids
        and (
            not concepts[i]["jaLabels"]
            or bool(permitted_forms & set(concepts[i]["jaLabels"]))
        )
    }
    pool = set(global_ids) | seeds | {i for ids in per_branch for i in ids}
    ranked = sorted(pool, key=lambda i: (-float(scores[i]), concepts[i]["semanticKey"]))
    # A separate branch may be a synonym, not a distinct sense; this is retrieval diversification.
    selected = []
    if global_ids:
        selected.append(global_ids[0])
    for ids in per_branch:
        if ids and ids[0] not in selected and len(selected) < top_k:
            selected.append(ids[0])
    for i in ranked:
        if i not in selected and len(selected) < top_k:
            selected.append(i)
    selected.sort(key=lambda i: (-float(scores[i]), concepts[i]["semanticKey"]))
    return [
        {
            "conceptId": concepts[i]["id"],
            "score": round(max(-1, min(1, float(scores[i]))), 6),
            "branches": ["minilm_global"]
            + (["lexical_seed"] if i in seeds else [])
            + [
                "minilm_gloss:" + str(j) for j, ids in enumerate(per_branch) if i in ids
            ],
            "features": {
                "cosine": round(float(scores[i]), 6),
                "branchCosines": [round(float(row[i]), 6) for row in branch_scores],
                "lexicalSeed": i in seeds,
                "poolSize": len(pool),
                "prunedCount": max(0, len(pool) - len(selected)),
                "unrepresentedBranchTop": [
                    j
                    for j, ids in enumerate(per_branch)
                    if ids and ids[0] not in selected
                ],
                "scoreIsExactProbability": False,
            },
        }
        for i in selected
    ]


def cache_embeddings(encoder, documents, cache_dir: Path, cache_key: str):
    """Durable block checkpoints; a killed cold build resumes without re-encoding."""
    import numpy as np

    cache_path = cache_dir / "vectors.npy"
    cache_meta = cache_dir / "manifest.json"
    if cache_path.exists() and cache_meta.exists():
        metadata = json.loads(cache_meta.read_text())
        if metadata["key"] != cache_key or metadata["sha256"] != digest(cache_path):
            raise ValueError("Embedding cache integrity mismatch")
        vectors = np.load(cache_path, mmap_mode="r", allow_pickle=False)
        if vectors.shape != (len(documents), 384) or vectors.dtype != np.float32:
            raise ValueError("Embedding cache shape mismatch")
        return vectors, True, len(documents)
    lock = cache_dir / "build.lock"
    fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(fd, (str(os.getpid()) + "\n").encode())
    os.fsync(fd)
    os.close(fd)
    pending = cache_dir / "vectors.pending.npy"
    state_path = cache_dir / "build-state.json"
    state = {"key": cache_key, "shape": [len(documents), 384], "blocks": []}
    try:
        offset = 0
        if state_path.exists():
            state = json.loads(state_path.read_text())
            if state["key"] != cache_key or state["shape"] != [len(documents), 384]:
                raise ValueError("Embedding checkpoint belongs to another corpus")
            vectors = np.load(pending, mmap_mode="r+", allow_pickle=False)
            if vectors.shape != (len(documents), 384) or vectors.dtype != np.float32:
                raise ValueError("Embedding checkpoint shape mismatch")
            for block in state["blocks"]:
                if block["start"] != offset or not offset < block["end"] <= min(
                    offset + 256, len(documents)
                ):
                    raise ValueError("Embedding checkpoint gap/overlap")
                if (
                    hashlib.sha256(vectors[offset : block["end"]].tobytes()).hexdigest()
                    != block["sha256"]
                ):
                    raise ValueError("Embedding checkpoint block corruption")
                offset = block["end"]
        else:
            vectors = np.lib.format.open_memmap(
                pending, mode="w+", dtype=np.float32, shape=(len(documents), 384)
            )
        resumed = offset
        for start in range(offset, len(documents), 256):
            end = min(start + 256, len(documents))
            vectors[start:end] = encoder.encode(documents[start:end])
            vectors.flush()
            with pending.open("rb") as saved:
                os.fsync(saved.fileno())
            state["blocks"].append(
                {
                    "start": start,
                    "end": end,
                    "sha256": hashlib.sha256(vectors[start:end].tobytes()).hexdigest(),
                }
            )
            temp = state_path.with_suffix(".pending")
            with temp.open("w") as stream:
                json.dump(state, stream, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, state_path)
            if start % 4096 == 0:
                print(
                    json.dumps(
                        {
                            "embeddingConcepts": end,
                            "total": len(documents),
                            "resumed": resumed,
                        }
                    ),
                    flush=True,
                )
        del vectors
        os.replace(pending, cache_path)
        metadata = {
            "key": cache_key,
            "sha256": digest(cache_path),
            "concepts": len(documents),
            "dimension": 384,
        }
        temp = cache_meta.with_suffix(".pending")
        with temp.open("w") as stream:
            json.dump(metadata, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, cache_meta)
        return np.load(cache_path, mmap_mode="r", allow_pickle=False), False, resumed
    finally:
        lock.unlink()


def retrieve(args):
    os.environ["OPENBLAS_NUM_THREADS"] = "1"
    os.environ["OMP_NUM_THREADS"] = "1"
    import numpy as np

    root = Path(args.artifact_dir).resolve()
    manifest, export_path = load_export(root, args.export)
    sources, audit_path = audited_sources(root, export_path, manifest, args.audit)
    sense_path = read_ref(root, manifest["files"]["senses"])

    def target_reason(sense):
        if any(
            sources[key]["audit"]["status"] != "verified" for key in sense["sourceKeys"]
        ):
            return "blocked_source"
        if sense["wordnetIdentity"]:
            return "source_identity"
        if any(link["relation"] == "exact" for link in sense["existingLinks"]):
            return "existing_exact_requires_audit"
        if not sense["sense"]["identity"]:
            return "missing_identity"
        if not any(
            row["language"] == "en"
            for row in sense["senseContext"]["enGlosses"]
            + sense["senseContext"]["definitions"]
        ):
            return "missing_english_context"
        return None

    # Source identities / blocked inputs do not trigger a model download or cold cache.
    if all(target_reason(sense) is not None for sense in lines(sense_path)):
        name = args.prefix + "/results.jsonl"
        path = rooted(root, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        counts = {}
        with path.open("x", encoding="utf-8") as stream:
            for sense in lines(sense_path):
                reason = target_reason(sense)
                counts[reason] = counts.get(reason, 0) + 1
                stream.write(
                    json.dumps(
                        {
                            "senseKey": sense["sense"]["semanticKey"],
                            "senseId": sense["sense"]["id"],
                            "hits": [],
                            "reason": reason,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
            stream.flush()
            os.fsync(stream.fileno())
        if sum(counts.values()) != manifest["counts"]["senses"]:
            raise ValueError("Sense denominator mismatch")
        ref = write_json(
            root,
            args.prefix + "/manifest.json",
            {
                "schemaVersion": 1,
                "task": "db4_minilm_retrieval",
                "exportSha256": digest(export_path),
                "auditSha256": digest(audit_path),
                "model": MODEL,
                "revision": REVISION,
                "methodVersion": VERSION,
                "results": {"path": name, "sha256": digest(path)},
                "modelFiles": [],
                "metrics": {
                    "modelUsed": False,
                    "senses": sum(counts.values()),
                    "statuses": counts,
                    "semanticQualityValidated": False,
                },
            },
        )
        print(
            json.dumps({"search": ref, "modelUsed": False, "statuses": counts}),
            flush=True,
        )
        return
    model_dir = rooted(root, "models/" + REVISION)
    model_files = [args.onnx_file] + MODEL_CONFIG_FILES
    if args.download_model:
        from huggingface_hub import snapshot_download

        snapshot_download(
            MODEL, revision=REVISION, local_dir=model_dir, allow_patterns=model_files
        )
    refs = [
        {"path": "models/" + REVISION + "/" + name, "sha256": digest(model_dir / name)}
        for name in model_files
    ]
    started = time.monotonic()
    encoder = Encoder(model_dir, args.batch, args.threads, args.onnx_file)
    concepts, documents, concept_hash = [], [], hashlib.sha256()
    for item in lines(read_ref(root, manifest["files"]["concepts"])):
        concept = item["concept"]
        definitions = [
            row["text"]
            for row in item["conceptContext"]["definitions"]
            if row["language"] == "en"
        ]
        if not definitions or any(
            sources[key]["audit"]["status"] != "verified" for key in item["sourceKeys"]
        ):
            continue
        labels = list(
            dict.fromkeys(
                row["text"]
                for row in item["conceptContext"]["labels"]
                if row["language"] == "en"
            )
        )
        ja = list(
            dict.fromkeys(
                row["text"]
                for row in item["conceptContext"]["labels"]
                if row["language"] == "ja"
            )
        )
        doc = "\n".join(dict.fromkeys(definitions)) + (
            "\nSynonyms: " + "; ".join(labels) if labels else ""
        )
        concepts.append(
            {
                "id": concept["id"],
                "semanticKey": concept["semanticKey"],
                "pos": concept["pos"],
                "jaLabels": ja,
            }
        )
        documents.append(doc)
        concept_hash.update(
            json.dumps(
                [concept["semanticKey"], concept["pos"], doc],
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode()
        )
    if not concepts:
        raise ValueError("No audited English concept context; fix source audit first")
    cache_key = hashlib.sha256(
        json.dumps(
            {
                "version": VERSION,
                "model": MODEL,
                "revision": REVISION,
                "files": refs,
                "documents": concept_hash.hexdigest(),
                "pooling": "mean-token-chunks254-overlap32-l2",
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    cache_dir = rooted(root, "embedding-cache/" + cache_key)
    cache_dir.mkdir(parents=True, exist_ok=True)
    vectors, hit, resumed = cache_embeddings(encoder, documents, cache_dir, cache_key)
    del documents
    prefix = args.prefix
    results_path = rooted(root, prefix + "/results.jsonl")
    results_path.parent.mkdir(parents=True, exist_ok=True)
    counts = {
        "senses": 0,
        "withHits": 0,
        "blocked": 0,
        "sourceIdentity": 0,
        "missingContext": 0,
    }
    with results_path.open("x", encoding="utf-8") as stream:
        for sense in lines(sense_path):
            counts["senses"] += 1
            reason = None
            hits = []
            blocked = any(
                sources[key]["audit"]["status"] != "verified"
                for key in sense["sourceKeys"]
            )
            texts = [
                row["text"]
                for row in sense["senseContext"]["enGlosses"]
                + sense["senseContext"]["definitions"]
                if row["language"] == "en"
            ]
            if blocked:
                reason = "blocked_source"
                counts["blocked"] += 1
            elif sense["wordnetIdentity"]:
                reason = "source_identity"
                counts["sourceIdentity"] += 1
            elif any(link["relation"] == "exact" for link in sense["existingLinks"]):
                reason = "existing_exact_requires_audit"
            elif not sense["sense"]["identity"]:
                reason = "missing_identity"
            elif not texts:
                reason = "missing_english_context"
                counts["missingContext"] += 1
            else:
                query = encoder.encode(texts)
                mean = query.mean(axis=0)
                mean /= max(float(np.linalg.norm(mean)), 1e-12)
                # Bounded matrix multiplication: no all-senses x all-concepts matrix.
                branch_scores = query @ vectors.T
                scores = mean @ vectors.T
                hits = pick_hits(
                    scores,
                    branch_scores,
                    concepts,
                    set(sense["seedConceptIds"]),
                    sense,
                    args.top_k,
                )
                if hits:
                    counts["withHits"] += 1
                else:
                    reason = "no_candidates_after_pos_filter"
            stream.write(
                json.dumps(
                    {
                        "senseKey": sense["sense"]["semanticKey"],
                        "senseId": sense["sense"]["id"],
                        "hits": hits,
                        "reason": reason,
                    },
                    ensure_ascii=False,
                    allow_nan=False,
                )
                + "\n"
            )
        stream.flush()
        os.fsync(stream.fileno())
    if counts["senses"] != manifest["counts"]["senses"]:
        raise ValueError("Sense denominator mismatch")
    import resource

    metrics = {
        **counts,
        "conceptPool": len(concepts),
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "peakRssMiB": round(
            resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2
        ),
        "conceptCacheHit": hit,
        "resumedConcepts": resumed,
        "encodedChunks": encoder.chunk_count,
        "threads": args.threads,
        "batch": args.batch,
        "onnxFile": args.onnx_file,
        "semanticQualityValidated": False,
        "modelUsed": True,
    }
    ref = write_json(
        root,
        prefix + "/manifest.json",
        {
            "schemaVersion": 1,
            "task": "db4_minilm_retrieval",
            "exportSha256": digest(export_path),
            "auditSha256": digest(audit_path),
            "model": MODEL,
            "revision": REVISION,
            "methodVersion": VERSION,
            "results": {
                "path": str(results_path.relative_to(root)),
                "sha256": digest(results_path),
            },
            "modelFiles": refs,
            "metrics": metrics,
        },
    )
    print(json.dumps({"search": ref, "metrics": metrics}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    audit = sub.add_parser("audit")
    for name in ["artifact-dir", "export", "wn-db", "licenses"]:
        audit.add_argument("--" + name, required=True)
    audit.add_argument("--jmdict")
    audit.add_argument("--prefix", default="audit")
    search = sub.add_parser("retrieve")
    for name in ["artifact-dir", "export", "audit"]:
        search.add_argument("--" + name, required=True)
    search.add_argument("--download-model", action="store_true")
    search.add_argument(
        "--onnx-file",
        choices=["onnx/model.onnx", "onnx/model_quint8_avx2.onnx"],
        default="onnx/model.onnx",
    )
    search.add_argument("--prefix", default="search")
    search.add_argument("--top-k", type=int, default=5, choices=range(1, 6))
    search.add_argument("--threads", type=int, default=1, choices=range(1, 9))
    search.add_argument("--batch", type=int, default=16, choices=range(1, 129))
    args = parser.parse_args()
    audit_sources(args) if args.command == "audit" else retrieve(args)


if __name__ == "__main__":
    main()

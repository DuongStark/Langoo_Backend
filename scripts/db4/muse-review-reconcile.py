#!/usr/bin/env python3
"""DB4-D5: read-only recovery of completed Muse replies, including invalid schemas.

No generation, resend, edits to job records or conversion to D1-valid output.
Use only after all planned requests were dispatched. Capture durable results
before stopping a runner still polling an already completed malformed reply.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import time
from pathlib import Path


def recover(root: Path):
    root = root.resolve()
    spec = importlib.util.spec_from_file_location("db4_runner", root / "muse-review-runner.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    manifest_bytes = (root / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    request_bytes = (root / "requests.jsonl").read_bytes()
    started = json.loads((root / "runner-started.json").read_text())
    if (hashlib.sha256(request_bytes).hexdigest() != manifest["requests"]["sha256"]
            or hashlib.sha256(manifest_bytes).hexdigest() != started["manifest_sha256"]):
        raise ValueError("Source request/manifest drift")
    requests = list(runner.read_jsonl(root / "requests.jsonl"))
    if len(requests) != manifest["counts"]["requests"] or len({r["requestId"] for r in requests}) != len(requests):
        raise ValueError("Request denominator mismatch")
    gateway = None
    rows = []
    recovered_count = 0
    try:
        for request in requests:
            key = hashlib.sha256(request["requestId"].encode()).hexdigest()
            job = json.loads(runner.rooted(root / "jobs", key + ".json").read_text())
            if any(job[name] != request[name] for name in (
                    "requestId", "phase", "bundleKey", "senseId", "contextHash", "renderedContextHash")):
                raise ValueError("Job identity mismatch")
            row = {name: job[name] for name in (
                "requestId", "phase", "bundleKey", "senseId", "contextHash", "renderedContextHash", "state"
            )}
            if job["state"] == "complete":
                row.update(rawReply=job["rawReply"], elapsedMs=job["elapsedMs"])
            else:
                if not job.get("dispatchStarted") or not job.get("sessionId"):
                    raise ValueError("Cannot recover an undispatched request")
                if gateway is None:
                    gateway = runner.new_gateway()
                history = gateway.call_json("chat.history", body={"session_id": job["sessionId"], "limit": 10}, timeout=20)
                replies = []
                for event in history.get("chat_events", []):
                    data = event.get("payload", {})
                    if (event.get("event_name") != "message.assistant" or not isinstance(data, dict)
                            or data.get("reply_to_message_id") or event.get("reply_to_message_id")
                            or data.get("status") != "completed" or data.get("display_text_ready") is not True):
                        continue
                    reply = data.get("display_text") or data.get("content") or event.get("text")
                    value = runner.parse_reply(reply)
                    if (value.get("bundleKey") != request["bundleKey"] or value.get("senseId") != request["senseId"]
                            or value.get("contextHash") != request["contextHash"]):
                        raise ValueError("Completed reply identity mismatch")
                    replies.append(reply)
                if len(replies) != 1:
                    raise ValueError("Expected one completed, primary, bound reply")
                row.update(state="complete", rawReply=replies[0], reconciliation={
                    "method": "read_only_completed_history", "assistantStatus": "completed",
                    "displayTextReady": True, "observedAt": time.time(),
                    "originalRunnerState": job["state"], "schemaValidity": "not_granted",
                })
                recovered_count += 1
            rows.append(row)
    finally:
        if gateway:
            gateway.close()
    target = root / "responses-reconciled.jsonl"
    with target.open("x", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(target, 0o600)
    result = {
        "task": "DB4-D5", "requests": len(requests), "completedTransport": len(rows),
        "recoveredCompletedReplies": recovered_count, "newDispatches": 0,
        "elapsed_s": round(time.time() - started["started_at"], 2),
        "responsesSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "apply": False, "semanticQualityValidated": False,
    }
    runner.write(root / "reconciliation.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(recover(args.root)))

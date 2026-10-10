#!/usr/bin/env bash
# M10.5: prepare a frozen bulk cohort on VPS, without any Muse generation.
set -euo pipefail
job_name="${1:?job name required}"
word_limit="${2:-5000}"
max_rank="${3:-10000}"
[[ "$job_name" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] || exit 2
service_dir=/opt/langoo/services/muse-native
bulk_root=/opt/langoo/storage/muse-native/bulk
inventory_dir="$bulk_root/$job_name-inventory"
run_dir="$bulk_root/$job_name"
umask 077
cd "$service_dir"
if [[ -f "$run_dir/bulk-manifest.json" ]]; then
  ./venv/bin/python -B bulk_runner.py status --out "$run_dir"
  exit 0
fi
if [[ ! -f "$inventory_dir/inventory.json" ]]; then
  node export-inventory.mjs --bulk-dir "$inventory_dir" --limit "$word_limit" --max-rank "$max_rank" --shard-words 50
fi
./venv/bin/python -B bulk_runner.py prepare --inventory "$inventory_dir" --out "$run_dir" --workers 3 --repair-budget 10

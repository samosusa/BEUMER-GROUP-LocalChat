#!/usr/bin/env bash
#
# Benchmarks each model as soon as the downloader has VERIFIED it, and re-exports after
# every one, so the CSV is complete and correct at all times rather than only at the end.
#
# It reads scripts/models.txt - the same list the downloader uses - and it will only touch
# a model that has a receipt in data/models/.verified/. A file with the right name is not
# evidence of anything; a checksum the downloader recorded is.
#
# It sweeps the whole list on every pass instead of walking it in order, so a model that
# finishes downloading out of order gets measured immediately rather than waiting behind
# a bigger one.
#
#   nohup ./scripts/run_sweep.sh > sweep.log 2>&1 &
#   tail -f sweep.log
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/data/models"
VERIFIED="$DIR/.verified"
DB="$ROOT/data/app.db"
LIST="$ROOT/scripts/models.txt"
API="${LOCALCHAT_API:-http://localhost:8000}"
MACHINE="${MACHINE:-patrik-macbook}"

DEADLINE=$(( $(date +%s) + 12 * 60 * 60 ))   # stop waiting after 12h whatever happens
JOB_TIMEOUT=$(( 45 * 60 ))                   # one model's benchmark gets 45m

log() { echo "[$(date '+%H:%M:%S')] $*"; }

already_done() {
  python3 - "$DB" "$1" <<'PY'
import sqlite3, sys
try:
    con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
    n = con.execute("SELECT COUNT(*) FROM eval_results WHERE model = ? AND status = 'ok'",
                    (sys.argv[2],)).fetchone()[0]
except Exception:
    n = 0
sys.exit(0 if n > 0 else 1)
PY
}
export_csv() {
  python3 "$ROOT/scripts/export_benchmark_csv.py" --machine "$MACHINE" --all-jobs 2>&1 | sed 's/^/    /'
}

benchmark() {
  local name="$1" job state elapsed=0
  log "$name: verified - benchmarking cpu + gpu"
  job=$(curl -s --max-time 30 -X POST "$API/benchmark" -H 'Content-Type: application/json' \
          -d "{\"devices\":[\"cpu\",\"gpu\"],\"models\":[\"$name\"]}" \
        | python3 -c 'import json,sys; print(json.load(sys.stdin).get("benchmark_job_id",""))' 2>/dev/null)
  [ -z "$job" ] && { log "$name: POST /benchmark returned no job id"; return 1; }
  log "$name: job $job started"
  while [ "$elapsed" -lt "$JOB_TIMEOUT" ]; do
    state=$(curl -s --max-time 20 "$API/benchmark/status/$job" \
            | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status",""))' 2>/dev/null)
    case "$state" in
      completed) log "$name: job $job completed"; break ;;
      failed|error) log "$name: job $job FAILED"; break ;;
      *) sleep 10; elapsed=$((elapsed + 10)) ;;
    esac
  done
  [ "$elapsed" -ge "$JOB_TIMEOUT" ] && log "$name: job $job timed out"
  log "$name: exporting"
  export_csv
}

# bash 3.2 (macOS default) has no mapfile.
NAMES=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  case "$line" in ''|\#*) continue ;; esac
  entry_url="${line%%[[:space:]]*}"
  entry_rest="${line#"$entry_url"}"
  entry_rest="${entry_rest#"${entry_rest%%[![:space:]]*}"}"
  NAMES+=("${entry_rest:-$(basename "$entry_url")}")
done < "$LIST"

if ! curl -s --max-time 10 "$API/models" > /dev/null; then
  log "FATAL: no API at $API - start it:  uvicorn src.app:app --port 8000"
  exit 1
fi
log "API up at $API. Machine: $MACHINE. Watching ${#NAMES[@]} models from models.txt."

announced=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  pending=0
  for name in "${NAMES[@]}"; do
    already_done "$name" && continue
    if [ -s "$VERIFIED/$name" ] && [ -f "$DIR/$name" ]; then
      benchmark "$name"
    else
      pending=$((pending + 1))
      case "$announced" in *"|$name|"*) ;; *) announced="$announced|$name|" ;; esac
    fi
  done
  [ "$pending" -eq 0 ] && { log "every model in models.txt is measured"; break; }
  log "waiting on $pending model(s) still downloading"
  sleep 60
done

log "=== sweep finished ==="
export_csv
log "CSV: $ROOT/benchmark-$MACHINE.csv"

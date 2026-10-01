#!/usr/bin/env bash
#
# Downloads the benchmark GGUFs listed in models.txt and proves each one is correct
# before calling it done.
#
# Two things this gets right that the first version did not:
#
#  1. `--retry` and `-C -` must not be combined. `-C -` fixes the resume offset when curl
#     starts; an internal retry re-runs against that stale offset and the file jumps
#     backwards - we watched a download go 30% -> 14% -> 23% for half an hour. The retry
#     loop belongs out here, where the offset is recomputed from the file's real size on
#     every pass. One curl attempt per iteration, nothing else.
#
#  2. Matching Content-Length only proves the file is the right LENGTH. HuggingFace serves
#     each object's SHA256 in `x-linked-etag`, so we prove the CONTENT too, and record the
#     proof in data/models/.verified/ so the sweep never has to trust a bare filename.
#
#   ./scripts/fetch_models.sh          download, verify, resume whatever is incomplete
#   ./scripts/fetch_models.sh --check  verify URLs and files, download nothing
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/data/models"
VERIFIED="$DIR/.verified"
QUARANTINE="$DIR/_bad"
LIST="$ROOT/scripts/models.txt"
B=https://huggingface.co
MAX_ATTEMPTS=30
MAX_REDOWNLOADS=2
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

mkdir -p "$DIR" "$VERIFIED" "$QUARANTINE"
cd "$DIR" || exit 1

log() { echo "[$(date '+%H:%M:%S')] $*"; }
size_of() { local n=0; [ -f "$1" ] && n=$(stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0); echo $(( n + 0 )); }
gb()      { awk -v b="$1" 'BEGIN{printf "%.2f GB", b/1073741824}'; }
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else openssl dgst -sha256 "$1" | awk '{print $NF}'; fi
}
head_meta() {   # -> "<bytes> <sha256-or-empty>"
  curl -sIL --http1.1 --max-time 30 "$1" | tr -d '\r' | awk '
    tolower($1)=="content-length:"        { len=$2 }
    tolower($1)=="x-linked-etag:"         { tag=$2 }
    tolower($1)=="etag:"       && tag=="" { tag=$2 }
    END { gsub(/"/,"",tag); if (tag !~ /^[0-9a-f]{64}$/) tag=""; print len+0, tag }'
}

# bash 3.2 (macOS default) has no mapfile, so read the list the portable way.
URLS=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"      # strip leading whitespace
  case "$line" in ''|\#*) continue ;; esac
  URLS+=("$line")
done < "$LIST"
[ "${#URLS[@]}" -eq 0 ] && { echo "no models in $LIST"; exit 1; }
log "${#URLS[@]} models listed in models.txt"

declare -a REPORT

for entry in "${URLS[@]}"; do
  # A line is "<url>" or "<url> <local-filename>". The second form exists because the
  # benchmark keys rows by filename: to compare with another machine, the file has to be
  # named the way THEY named it, whatever the repo happens to call it.
  url="${entry%%[[:space:]]*}"
  rest="${entry#"$url"}"
  rest="${rest#"${rest%%[![:space:]]*}"}"
  name="${rest:-$(basename "$url")}"

  if [ -s "$VERIFIED/$name" ] && [ -f "$name" ]; then
    REPORT+=("OK|$name|already verified")
    continue
  fi

  read -r want sha <<< "$(head_meta "$B/$url")"
  # A real GGUF is hundreds of MB at least. Anything smaller is an error page or an
  # unresolved LFS pointer answering 200 - reject it here rather than "downloading" it.
  if [ "${want:-0}" -lt 52428800 ]; then
    log "$name: URL does not resolve to a model (server offered ${want:-0} bytes)"
    REPORT+=("BAD URL|$name|$B/$url")
    continue
  fi
  [ -z "$sha" ] && log "$name: server gave no SHA256, will verify by size only"

  redownloads=0
  while : ; do
    attempt=0
    have="$(size_of "$name")"
    while [ "$have" -lt "$want" ] && [ "$CHECK_ONLY" -eq 0 ]; do
      attempt=$((attempt + 1))
      [ "$attempt" -gt "$MAX_ATTEMPTS" ] && { log "$name: gave up after $MAX_ATTEMPTS attempts"; break; }
      log "$name: attempt $attempt - $(gb "$have") of $(gb "$want")"
      # No --retry here. On purpose. This loop is the retry.
      curl -L --http1.1 -C - -o "$name" \
           --connect-timeout 20 --speed-limit 10240 --speed-time 60 "$B/$url"
      sleep 2
      new="$(size_of "$name")"
      [ "$new" -le "$have" ] && { log "$name: attempt $attempt made no progress"; sleep 5; }
      have="$new"
    done

    if [ "$have" -lt "$want" ]; then
      REPORT+=("PARTIAL|$name|$(gb "$have") of $(gb "$want") - not usable"); break
    fi
    if [ "$have" -gt "$want" ]; then
      log "$name: $(gb "$have") exceeds the expected $(gb "$want") - corrupt"
      mv -f "$name" "$QUARANTINE/$name.$(date +%s)" 2>/dev/null
      redownloads=$((redownloads + 1))
      [ "$redownloads" -le "$MAX_REDOWNLOADS" ] && [ "$CHECK_ONLY" -eq 0 ] && { log "$name: restarting"; continue; }
      REPORT+=("CORRUPT|$name|oversized - moved to _bad/"); break
    fi

    if [ -z "$sha" ]; then
      echo "size-only:$want" > "$VERIFIED/$name"
      REPORT+=("SIZE OK|$name|$(gb "$want") - length matches, no checksum offered"); break
    fi

    log "$name: size matches, hashing $(gb "$want")"
    got="$(sha256_of "$name")"
    if [ "$got" = "$sha" ]; then
      echo "$sha" > "$VERIFIED/$name"
      REPORT+=("OK|$name|$(gb "$want") - SHA256 verified"); break
    fi

    log "$name: CHECKSUM MISMATCH (got ${got:0:12}..., want ${sha:0:12}...)"
    mv -f "$name" "$QUARANTINE/$name.$(date +%s)" 2>/dev/null
    redownloads=$((redownloads + 1))
    if [ "$redownloads" -gt "$MAX_REDOWNLOADS" ] || [ "$CHECK_ONLY" -eq 1 ]; then
      REPORT+=("CORRUPT|$name|SHA256 mismatch - moved to _bad/"); break
    fi
    log "$name: refetching from scratch (${redownloads}/${MAX_REDOWNLOADS})"
  done
done

echo
echo "================ models in $DIR ================"
ok=0; bad=0
for line in "${REPORT[@]}"; do
  IFS='|' read -r state nm detail <<< "$line"
  printf "%-9s %-42s %s\n" "$state" "$nm" "$detail"
  case "$state" in OK|"SIZE OK") ok=$((ok+1)) ;; *) bad=$((bad+1)) ;; esac
done
echo "-----------------------------------------------"
echo "$ok usable, $bad not usable"
[ "$bad" -gt 0 ] && echo "Re-run to resume. Anything in _bad/ can be deleted."
exit 0

#!/usr/bin/env bash
# run.sh — build every engine probe, sweep all 206 types in each, and diff
# every dump against the Node reference. Byte-identical output is the pass bar.
#
#   ./run.sh                 # node + quickjs + boa + deno + rusty_v8
#   LIBNODE=/path/libnode.so ./run.sh   # ...also libnode/edon
#
# See ../RUST-PORT.md for what these numbers meant the last time they ran.
set -uo pipefail
cd "$(dirname "$0")"

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

pass=0
fail=0

note() { printf '  %-10s %s\n' "$1" "$2"; }
run() { # name, command...
  local name="$1"; shift
  printf '\n=== %s ===\n' "$name"
  if ! "$@" >"$OUT/$name.txt" 2>&1; then
    note "$name" "FAILED to run:"; tail -5 "$OUT/$name.txt" | sed 's/^/    /'
    fail=$((fail + 1)); return
  fi
  # keep the dump block only; counts/timings legitimately differ per engine
  awk '/^===DUMP===/{p=1;next} /^===COUNTS===/{p=0} p' "$OUT/$name.txt" >"$OUT/$name.dump"
  note "$name" "$(wc -l <"$OUT/$name.dump") lines  $(md5sum <"$OUT/$name.dump" | cut -c1-32)"
}

# --- reference: real Node, real require() -----------------------------------
run node node node-reference.cjs
cp "$OUT/node.dump" "$OUT/reference.dump"

# --- candidates -------------------------------------------------------------
# Each probe is a separate cargo package so a failed build only drops that engine.
probe() { cargo build --release -q -p "probe-$1" && "./target/release/probe-$1"; }

run quickjs probe quickjs
run boa     probe boa
run deno    probe deno
run v8      probe v8
if [[ -n "${LIBNODE:-}" ]]; then run libnode probe libnode; fi

# --- verdict ----------------------------------------------------------------
printf '\n=== diff vs node ===\n'
for f in quickjs boa deno v8 libnode; do
  [[ -f "$OUT/$f.dump" ]] || continue
  if diff -q "$OUT/reference.dump" "$OUT/$f.dump" >/dev/null; then
    note "$f" "IDENTICAL (all 206 types byte-for-byte)"; pass=$((pass + 1))
  else
    note "$f" "DIFFERS:"; diff "$OUT/reference.dump" "$OUT/$f.dump" | head -8 | sed 's/^/    /'
    fail=$((fail + 1))
  fi
done

printf '\nengines identical: %d   problems: %d\n' "$pass" "$fail"
exit $((fail > 0))

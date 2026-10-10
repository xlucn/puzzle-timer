#!/usr/bin/env bash
# run.sh — build every engine probe, sweep all 206 types in each, and diff
# every dump against the Node reference. Byte-identical output is the pass bar.
#
#   ./run.sh                     # fast set: node + deno + v8 + jsc   (~40 s)
#   SLOW=1 ./run.sh              # ...+ quickjs + boa                 (~11 min)
#   LIBNODE=/path/libnode.so ./run.sh   # ...+ libnode/edon
#   SLOW=1 LIBNODE=/path/libnode.so ./run.sh   # all seven
#
# The two interpreters are opt-in because they are 20-55x slower: quickjs
# sweeps in ~3 min and boa in ~7-9 min, against ~9 s for the JIT engines.
# Their byte-identical results are already recorded in RUST-PORT.md, so they
# only need re-running when an engine bumps (e.g. boa gaining String.substr).
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

# JIT engines: ~9 s each.
run deno probe deno
run v8    probe v8
run jsc   probe jsc

# Interpreters: correct, but 20-55x slower. Opt-in.
if [[ -n "${SLOW:-}" ]]; then
  run quickjs probe quickjs
  run boa     probe boa
fi

if [[ -n "${LIBNODE:-}" ]]; then run libnode probe libnode; fi

# --- verdict ----------------------------------------------------------------
printf '\n=== diff vs node ===\n'
for f in deno v8 jsc quickjs boa libnode; do
  [[ -f "$OUT/$f.dump" ]] || continue
  if diff -q "$OUT/reference.dump" "$OUT/$f.dump" >/dev/null; then
    note "$f" "IDENTICAL (all 206 types byte-for-byte)"; pass=$((pass + 1))
  else
    note "$f" "DIFFERS:"; diff "$OUT/reference.dump" "$OUT/$f.dump" | head -8 | sed 's/^/    /'
    fail=$((fail + 1))
  fi
done

expected=3
[[ -n "${SLOW:-}" ]] && expected=$((expected + 2))
[[ -n "${LIBNODE:-}" ]] && expected=$((expected + 1))
printf '\nengines identical: %d (expected %d)   problems: %d\n' "$pass" "$expected" "$fail"
[[ "$pass" -eq "$expected" && "$fail" -eq 0 ]] || exit 1

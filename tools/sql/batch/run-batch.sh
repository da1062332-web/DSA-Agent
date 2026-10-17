#!/usr/bin/env bash
# Applies the hosted migration batch to the LINKED Supabase project, one migration at a time, and stops at the first problem.
# WRITES TO HOSTED. Run it yourself, from the repository root, after reading tools/sql/batch/README.md.
#
#   bash tools/sql/batch/run-batch.sh            # shows the project and what is still pending, asks, then applies
#   bash tools/sql/batch/run-batch.sh --yes      # no question
#
# It can be re-run after a stop: the preflight decides which migrations are still pending, so an applied one is never applied twice.
# For each pending migration: wrapper with hashes (outside the repository) -> apply (one transaction) -> verify. Any FAIL row or error
# stops the run and prints the rollback command for that migration. Nothing is retried and nothing is skipped silently.
set -euo pipefail

RUN_DIR="${DSA_BACKUPS:-$HOME/dsa-backups/batch-$(date +%Y%m%d)}/run-$(date +%H%M%S)"   # a new folder per run, so a wrapper is never reused or overwritten
EXPECTED_REF="mlpkwwhnagxzinaohdxg"
REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
q() { npx supabase db query --linked -f "$1"; }

echo "Linked project ref: ${REF:-unknown}   (expected, the shared development project: $EXPECTED_REF)"
[ "$REF" = "$EXPECTED_REF" ] || { echo "Refusing: the linked project is not the expected development project."; exit 1; }

mkdir -p "$RUN_DIR"
echo "--- preflight (read-only) -> $RUN_DIR/preflight.json"
q tools/sql/batch/preflight.sql > "$RUN_DIR/preflight.json"
PENDING="$(node tools/sql/batch/pending.mjs "$RUN_DIR/preflight.json")"
if [ -z "$PENDING" ]; then echo "Nothing is pending: every migration of the batch is already applied."; exit 0; fi
echo "Pending, in this order: $PENDING"

if [ "${1:-}" != "--yes" ]; then read -r -p "Apply $PENDING to $REF? [type yes] " a; [ "$a" = "yes" ] || exit 1; fi

STATE_SQL="$(dirname "$RUN_DIR")/state.sql"
if [ -f "$STATE_SQL" ]; then
  echo "--- state backup (read-only) -> $RUN_DIR/state-before-apply.json"
  q "$STATE_SQL" > "$RUN_DIR/state-before-apply.json"
else
  echo "No $STATE_SQL: take the state backup first (docs/HOSTED_APPLY_CHECKLIST.md). Stopping."; exit 1
fi

for n in $PENDING; do
  f="$(ls supabase/migrations/202610010000${n}_*.sql | head -1)"
  mkdir -p "$RUN_DIR/$n"
  echo "=== 00$n $(basename "$f")"
  node tools/sql/make-apply-run.mjs "$f" "$RUN_DIR/$n/" | tee "$RUN_DIR/$n/hashes.txt" | grep -E "source|wrapper|body"
  grep -q "body equals the migration: YES" "$RUN_DIR/$n/hashes.txt" || { echo "The wrapper does not match the migration. Stopping."; exit 1; }
  q "$RUN_DIR/$n/apply-run.sql" > "$RUN_DIR/$n/apply-result.json"
  verify="tools/sql/batch/$n.verify.sql"; [ "$n" = "54" ] && verify="tools/sql/0054/verify.sql"
  q "$verify" > "$RUN_DIR/$n/verify-result.json"
  if grep -q '"FAIL"' "$RUN_DIR/$n/verify-result.json" || ! grep -q '"PASS"' "$RUN_DIR/$n/verify-result.json"; then
    echo "VERIFY FAILED (or gave no PASS rows) for 00$n. Stopping. To back it out:"
    if [ "$n" = "54" ]; then echo "  npx supabase db query --linked -f tools/sql/0054/rollback.sql"; else echo "  npx supabase db query --linked -f tools/sql/batch/$n.rollback.sql"; fi
    exit 1
  fi
  echo "00$n applied and verified"
done

echo "--- done. Now: update docs/MIGRATION_MATRIX.md, re-run tools/sql/0050 verify scripts, sign in once as platform operator and once as a tenant admin."

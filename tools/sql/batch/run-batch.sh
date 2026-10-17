#!/usr/bin/env bash
# Applies the hosted migration batch to the LINKED Supabase project, one migration at a time, and stops at the first problem.
# WRITES TO HOSTED. Run it yourself, from the repository root, after reading tools/sql/batch/README.md.
#
#   bash tools/sql/batch/run-batch.sh            # shows the project and the preflight, asks, then applies
#   bash tools/sql/batch/run-batch.sh --yes      # no question
#
# For each migration: wrapper with hashes (outside the repository) -> apply (one transaction) -> verify. Any FAIL row or error stops the
# run and prints the rollback command for that migration. Nothing is retried and nothing is skipped silently.
set -euo pipefail

BACKUPS="${DSA_BACKUPS:-$HOME/dsa-backups/batch-$(date +%Y%m%d)}"
ORDER="54 57 59 60 61 58 55 63 64 65"   # 0062 (data-correction executor) and 0056 (ledger, Release 3) are not part of this batch
REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
q() { npx supabase db query --linked -f "$1"; }

echo "Linked project ref: ${REF:-unknown}   (expected for the shared development project: mlpkwwhnagxzinaohdxg)"
[ "$REF" = "mlpkwwhnagxzinaohdxg" ] || { echo "Refusing: the linked project is not the expected development project."; exit 1; }

echo "--- preflight (read-only)"
q tools/sql/batch/preflight.sql | tee /tmp/dsa-preflight.json | grep -E '"item"|"result"' | paste - - | sed 's/  */ /g' || true
if grep -q '"FAIL"' /tmp/dsa-preflight.json; then echo "Preflight has a FAIL. Stopping."; exit 1; fi

if [ "${1:-}" != "--yes" ]; then read -r -p "Apply ${ORDER} to ${REF}? [type yes] " a; [ "$a" = "yes" ] || exit 1; fi

mkdir -p "$BACKUPS"
echo "--- state backup (read-only) -> $BACKUPS/state-before-apply.json"
q "$BACKUPS/state.sql" > "$BACKUPS/state-before-apply.json" 2>/dev/null || echo "(no state.sql in $BACKUPS; take a backup first, see docs/HOSTED_APPLY_CHECKLIST.md)"

for n in $ORDER; do
  f="$(ls supabase/migrations/202610010000${n}_*.sql | head -1)"
  mkdir -p "$BACKUPS/$n"
  echo "=== 00$n $(basename "$f")"
  node tools/sql/make-apply-run.mjs "$f" "$BACKUPS/$n/" | grep -E "source|wrapper|body"
  q "$BACKUPS/$n/apply-run.sql" > "$BACKUPS/$n/apply-result.json"
  verify="tools/sql/batch/$n.verify.sql"; [ "$n" = "54" ] && verify="tools/sql/0054/verify.sql"
  q "$verify" > "$BACKUPS/$n/verify-result.json"
  if grep -q '"FAIL"' "$BACKUPS/$n/verify-result.json"; then
    echo "VERIFY FAILED for 00$n. Stopping. To back it out:"
    echo "  npx supabase db query --linked -f tools/sql/$([ "$n" = "54" ] && echo 0054 || echo batch)/$([ "$n" = "54" ] && echo rollback || echo "$n.rollback").sql"
    exit 1
  fi
  echo "00$n applied and verified"
done

echo "--- done. Now: update docs/MIGRATION_MATRIX.md, re-run tools/sql/0050 verify scripts, sign in once as platform operator and once as a tenant admin."

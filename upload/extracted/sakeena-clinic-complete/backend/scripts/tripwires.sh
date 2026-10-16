#!/usr/bin/env bash
# RPS-2 tripwires C-1 / C-2 / C-3 / C-11 (BE-101 scope). CI-blocking.
set -euo pipefail

fail() { echo "TRIPWIRE FAIL: $1" >&2; exit 1; }

# C-1: exactly one `new PrismaClient`, inside src/common/prisma.ts
count_client=$(grep -rn "new PrismaClient(" src --include='*.ts' | wc -l | tr -d ' ')
[ "$count_client" = "1" ] || fail "C-1 expected 1 Prisma client, found $count_client"
grep -rn "new PrismaClient(" src --include='*.ts' | grep -q "src/common/prisma.ts" || fail "C-1 client outside common/prisma.ts"

# C-2: exactly one schema.prisma
count_schema=$(find prisma -name 'schema*.prisma' | wc -l | tr -d ' ')
[ "$count_schema" = "1" ] || fail "C-2 expected 1 schema.prisma, found $count_schema"

# C-3: no operational -> clinical Prisma RELATION in schema.
# Plain indexed String refs (clinicalEncounterRef, encounterRef, etc.) are REQUIRED
# by DB-02 and must NOT trip. Only fail on a relation field whose TYPE is clinical.
for m in "model QueueEntry" "model Invoice" "model Receipt" "model IntercomMessage" "model FollowUpTask" "model AuditEvent"; do
  block=$(awk "/^$m /,/^}/" prisma/schema.prisma)
  echo "$block" | grep -E "^[[:space:]]+[A-Za-z_]+[[:space:]]+(Encounter|Medication|TherapyNote|ScribeSession|ScribeDraft)(\?|\[\])?([[:space:]]|$)" && fail "C-3 $m references clinical model"
  echo "$block" | grep -E "@relation" | grep -Eq "(Encounter|Medication|TherapyNote|ScribeSession|ScribeDraft)" && fail "C-3 $m references clinical model"
done

# C-11: canon count — exactly 3 statements
stmt_count=$(grep -cE '^(CREATE UNIQUE INDEX|REVOKE)' prisma/migrations/0001_init/canon.sql | tr -d ' ')
[ "$stmt_count" = "3" ] || fail "C-11 canon must be exactly 3 statements, found $stmt_count"
grep -q "uq_queue_single_consult" prisma/migrations/0001_init/canon.sql || fail "C-11 missing uq_queue_single_consult"
grep -q "uq_queue_one_open_per_patient" prisma/migrations/0001_init/canon.sql || fail "C-11 missing uq_queue_one_open_per_patient"
grep -q "REVOKE UPDATE, DELETE ON receipts, audit_events FROM clinic_app" prisma/migrations/0001_init/canon.sql || fail "C-11 missing REVOKE"

# C-7: every cash-critical POST carries the Idempotency-Key middleware.
# Scopes (API_CONTRACTS.md "Cash-critical POSTs REQUIRE Idempotency-Key"):
# billing checkout/pay/reverse/write-off/settle + shift open/petty/close.
for scope in "billing.checkout" "billing.pay" "billing.reverse" "billing.writeOff" "billing.settle" "shift.open" "shift.petty" "shift.close"; do
  grep -rq "idempotency('$scope')" src --include='*.ts' || fail "C-7 missing idempotency('$scope')"
done

# C-8: every cash mutation runs under lockShift (CONV-04 / DB-11).
for svc in "src/modules/cashier-shift/billing.service.ts" "src/modules/cashier-shift/shift.service.ts"; do
  grep -q "await lockShift(tx" "$svc" || fail "C-8 $svc lacks lockShift(tx, …)"
done

echo "Tripwires C-1/C-2/C-3/C-7/C-8/C-11 green."

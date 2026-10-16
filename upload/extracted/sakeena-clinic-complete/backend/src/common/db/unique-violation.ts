/**
 * Shared P2002 (unique violation) recognition.
 *
 * Prisma's P2002 `meta.target` representation is not stable across unique
 * declarations: schema-modeled uniques have been observed as the model field
 * name (`queueEntryId`), the mapped DB column (`queue_entry_id`), or the raw
 * Postgres constraint name (`invoices_queue_entry_id_key`). Matching on one
 * spelling silently misses real conflicts, so comparison normalizes away
 * underscores/case and checks containment.
 */

/** Normalize a DB identifier for tolerant comparison (drop `_`/spaces, lowercase). */
export function normalizeDbIdentifier(raw: string): string {
  return raw.replace(/[\s_]+/g, '').toLowerCase();
}

/** True when `err` is a Prisma P2002 whose target matches `target` under
 * normalized containment (e.g. 'queue_entry_id' matches `queueEntryId`,
 * `queue_entry_id`, and `invoices_queue_entry_id_key`). */
export function isUniqueViolation(err: unknown, target: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ((err as { code?: unknown }).code !== 'P2002') return false;
  const meta = (err as { meta?: { target?: string | string[] } }).meta;
  const wanted = normalizeDbIdentifier(target);
  const rawTargets: readonly string[] = Array.isArray(meta?.target)
    ? meta.target
    : [String(meta?.target ?? '')];
  return rawTargets.some((t) => normalizeDbIdentifier(t).includes(wanted));
}

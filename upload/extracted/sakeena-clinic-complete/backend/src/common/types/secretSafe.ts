/**
 * Branded allowlist type (CONV-02).
 * Only `toSecret*Dto` mappers may construct SecretSafe values.
 */
export type SecretSafe<T> = T & { readonly __secretSafe: unique symbol };

/**
 * BE-103 runtime brand for the fail-closed sanitizer.
 * The compile-time `SecretSafe<T>` brand erases at runtime, so mappers also
 * attach a non-enumerable marker (never serialized by JSON.stringify) that
 * `isSecretSafe` can verify on the server before responding to SECRETARY.
 */
const SECRET_SAFE_MARKER = Symbol.for('clinic.SecretSafe.v1');

type Marked = { readonly [SECRET_SAFE_MARKER]?: true };

function mark(value: object): void {
  const target = value as Marked & Record<PropertyKey, unknown>;
  if (target[SECRET_SAFE_MARKER] === true) return;
  Object.defineProperty(target, SECRET_SAFE_MARKER, {
    value: true as const,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/** Allowlist constructor: the ONLY sanctioned way to produce SecretSafe output. */
export function markSecretSafe<T extends object>(dto: T): SecretSafe<T> {
  mark(dto);
  return dto as SecretSafe<T>;
}

/** Runtime counterpart of the `SecretSafe<T>` brand. Rejects null, primitives, unmarked objects. */
export function isSecretSafe(value: unknown): value is SecretSafe<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  return (value as Marked)[SECRET_SAFE_MARKER] === true;
}

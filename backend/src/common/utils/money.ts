/** Money: integer minor units only, never float (RPS-2 global). */
export function assertMinorUnits(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Money must be a non-negative integer in minor units');
  }
}

export function addMinor(a: number, b: number): number {
  assertMinorUnits(a);
  assertMinorUnits(b);
  return a + b;
}

export function subFloorZero(a: number, b: number): number {
  assertMinorUnits(a);
  assertMinorUnits(b);
  return Math.max(0, a - b);
}

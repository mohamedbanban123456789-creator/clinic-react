export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(baseIso: string, days: number): string {
  const base = new Date(baseIso).getTime();
  return new Date(base + days * 86_400_000).toISOString();
}

import { PrismaClient } from '@prisma/client';

// CONV-01 / C-1: SINGLE Prisma client for the whole monolith.
// Tripwire fails the build on a second client construction elsewhere.
declare global {
  // eslint-disable-next-line no-var
  var __clinicPrisma: PrismaClient | undefined;
}

function createSingleClient(): PrismaClient {
  const existing = globalThis.__clinicPrisma;
  if (existing !== undefined) return existing;
  const fresh = new PrismaClient();
  globalThis.__clinicPrisma = fresh;
  return fresh;
}

export function getPrisma(): PrismaClient {
  return createSingleClient();
}

export const prisma: PrismaClient = getPrisma();

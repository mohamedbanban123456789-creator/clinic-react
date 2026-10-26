// Reset doctor + secretary passwords in the Sakeena clinic embedded DB
// Uses the exact same argon2id settings as backend hash.ts (timeCost 3, mem 19456, par 1)
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.resolve(ROOT_DIR, 'upload', 'extracted', 'sakeena-clinic-complete', 'backend');
const require = createRequire(pathToFileURL(path.join(BACKEND_DIR, 'package.json')));
const argon2 = require('argon2');
const { PrismaClient } = require('@prisma/client');

// The disposable postgres gets a NEW port/credentials on every qa-boot —
// always resolve the live URL from the qa-info JSON the backend just wrote.
const qaInfo = JSON.parse(
  readFileSync(path.join(ROOT_DIR, 'clinic-qa-info.json'), 'utf8'),
);
const DATABASE_URL = qaInfo.appUrl;
process.env.DATABASE_URL = DATABASE_URL;

const NEW_PASSWORDS = {
  doctor: 'Doctor2026!',
  secretary: 'Secretary2026!',
};

async function hashPassword(plain) {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    timeCost: 3,
    memoryCost: 19456,
    parallelism: 1,
  });
}

const db = new PrismaClient();
try {
  for (const [identifier, plain] of Object.entries(NEW_PASSWORDS)) {
    const hash = await hashPassword(plain);
    const existing = await db.user.findUnique({ where: { identifier } });
    if (!existing) {
      if (identifier === 'secretary') {
        const doc = await db.user.findFirst({ where: { role: 'DOCTOR' } });
        await db.user.create({
          data: {
            name: 'سارة محمود',
            identifier: 'secretary',
            passwordHash: hash,
            role: 'SECRETARY',
            gender: 'FEMALE',
            isActive: true,
            passwordMustChange: false,
            createdByUserId: doc ? doc.id : null,
          },
        });
        console.log('CREATED secretary OK');
      }
      continue;
    }
    const updated = await db.user.update({
      where: { identifier },
      data: { passwordHash: hash, passwordMustChange: false, isActive: true },
      select: { identifier: true, name: true, role: true, passwordMustChange: true },
    });
    console.log('RESET OK:', JSON.stringify(updated));
    // verify round-trip
    const row = await db.user.findUnique({ where: { identifier }, select: { passwordHash: true } });
    const ok = await argon2.verify(row.passwordHash, plain);
    console.log(`VERIFY ${identifier}: ${ok ? 'PASS' : 'FAIL'}`);
  }
} finally {
  await db.$disconnect();
}

// Reset doctor + secretary passwords in the Sakeena clinic embedded DB
// Uses the exact same argon2id settings as backend hash.ts (timeCost 3, mem 19456, par 1)
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const BACKEND_DIR = '/home/z/my-project/upload/extracted/sakeena-clinic-complete/backend';
const require = createRequire(pathToFileURL(`${BACKEND_DIR}/package.json`));
const argon2 = require('argon2');
const { PrismaClient } = require('@prisma/client');

const DATABASE_URL =
  'postgresql://clinic_app:app-d1bceb3b8a029f706f402f32@127.0.0.1:46735/clinic_e2e?client_encoding=utf8';
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

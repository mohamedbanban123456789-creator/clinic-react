import argon2 from 'argon2';
import { loadEnv } from '../../config/env.js';

/**
 * BE-102 password hashing (argon2id, adaptive cost via PASSWORD_HASH_COST).
 * verifyPassword returns false on mismatch/invalid hash (constant-time inside argon2).
 */
export async function hashPassword(plain: string): Promise<string> {
  const env = loadEnv();
  return argon2.hash(plain, {
    type: argon2.argon2id,
    timeCost: env.PASSWORD_HASH_COST,
    memoryCost: 19456,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

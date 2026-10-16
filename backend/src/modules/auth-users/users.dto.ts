import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';
import type { Role, Gender } from '@prisma/client';

export interface ManagedUserDto {
  readonly id: string;
  readonly name: string;
  /** Staff login name (doctor-managed roster key; never a secret). */
  readonly identifier: string;
  readonly role: Role;
  readonly gender: Gender;
  readonly isActive: boolean;
}

export interface UserActivationDto {
  readonly id: string;
  readonly isActive: boolean;
}

interface ManagedUserLike {
  readonly id: string;
  readonly name: string;
  readonly identifier: string;
  readonly role: Role;
  readonly gender?: Gender;
  readonly isActive: boolean;
}

/** Allowlist-first mappers (CONV-02): passwordHash/tokenVersion never leave the server. */
export function toManagedUserDto(user: ManagedUserLike): SecretSafe<ManagedUserDto> {
  return markSecretSafe<ManagedUserDto>({
    id: user.id,
    name: user.name,
    identifier: user.identifier,
    role: user.role,
    gender: user.gender ?? 'FEMALE',
    isActive: user.isActive,
  });
}

export function toActivationDto(user: Pick<ManagedUserLike, 'id' | 'isActive'>): SecretSafe<UserActivationDto> {
  return markSecretSafe<UserActivationDto>({ id: user.id, isActive: user.isActive });
}

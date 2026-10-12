import { markSecretSafe, type SecretSafe } from '../../common/types/secretSafe.js';

export interface AuthUserDto {
  readonly id: string;
  readonly name: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
}

export interface MeDto extends AuthUserDto {
  readonly lastLoginAt: string | null;
  /**
   * Authoritative password-rotation flag (fail-closed enforcement lives in
   * `requireFreshPassword`). Always present so session restoration from
   * GET /auth/me alone re-arms the rotation gate after reload/cold boot.
   */
  readonly passwordMustChange: boolean;
}

interface UserLike {
  readonly id: string;
  readonly name: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
  readonly lastLoginAt: Date | null;
  readonly passwordMustChange: boolean;
}

/** Allowlist-first mappers (CONV-02): passwordHash/tokenVersion never leave the server. */
export function toAuthUserDto(user: UserLike): SecretSafe<AuthUserDto> {
  return markSecretSafe<AuthUserDto>({ id: user.id, name: user.name, role: user.role });
}

export function toMeDto(user: UserLike): SecretSafe<MeDto> {
  return markSecretSafe<MeDto>({
    id: user.id,
    name: user.name,
    role: user.role,
    lastLoginAt: user.lastLoginAt === null ? null : user.lastLoginAt.toISOString(),
    passwordMustChange: user.passwordMustChange,
  });
}

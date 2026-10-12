import { z } from 'zod';

export interface ErrorDetail {
  readonly field?: string;
  readonly issue: string;
  readonly expected?: string;
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'ILLEGAL_TRANSITION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ACCOUNT_DEACTIVATED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'TOO_MANY_ATTEMPTS'
  | 'FLOOR_VIOLATION'
  | 'WITHDRAWN_GONE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STALE_QUEUE'
  | 'STALE_ROW_VERSION'
  | 'ALREADY_SIGNED'
  | 'PRECONDITION_REQUIRED'
  | 'SHIFT_LOCKED'
  | 'ALREADY_REVERSED'
  | 'INVARIANT_VIOLATION'
  | 'GONE'
  | 'UNPROCESSABLE'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSE'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'DISCOUNT_BELOW_FLOOR'
  | 'OVERPAYMENT_REJECTED'
  | 'REVERSAL_EXCEEDS_ORIGINAL'
  | 'MUST_REVERSE_FIRST'
  | 'MSE_REQUIRED'
  | 'CONSENT_REQUIRED'
  | 'POSSIBLE_DUPLICATE'
  | 'NO_OPEN_SHIFT'
  | 'SHIFT_NOT_OPEN'
  | 'SHIFT_ALREADY_OPEN'
  | 'ALREADY_ACTIVE'
  | 'ACTIVE_CONSULTATION_EXISTS'
  | 'OUT_OF_ORDER_REASON_REQUIRED'
  | 'UNDO_WINDOW_EXPIRED'
  | 'UNDO_BLOCKED'
  | 'FEE_NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'GEMINI_KEY_MISSING'
  | 'GEMINI_TIMEOUT'
  | 'INVOICE_ALREADY_WRITTEN_OFF'
  | 'INTERNAL';

const StatusByCode: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  ILLEGAL_TRANSITION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  ACCOUNT_DEACTIVATED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  TOO_MANY_ATTEMPTS: 429,
  FLOOR_VIOLATION: 403,
  WITHDRAWN_GONE: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE_QUEUE: 409,
  STALE_ROW_VERSION: 409,
  ALREADY_SIGNED: 409,
  PRECONDITION_REQUIRED: 428,
  SHIFT_LOCKED: 409,
  ALREADY_REVERSED: 409,
  INVARIANT_VIOLATION: 409,
  GONE: 410,
  UNPROCESSABLE: 422,
  IDEMPOTENCY_KEY_REQUIRED: 422,
  IDEMPOTENCY_KEY_REUSE: 422,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  DISCOUNT_BELOW_FLOOR: 422,
  OVERPAYMENT_REJECTED: 422,
  REVERSAL_EXCEEDS_ORIGINAL: 422,
  MUST_REVERSE_FIRST: 409,
  MSE_REQUIRED: 422,
  CONSENT_REQUIRED: 422,
  POSSIBLE_DUPLICATE: 409,
  NO_OPEN_SHIFT: 409,
  SHIFT_NOT_OPEN: 409,
  SHIFT_ALREADY_OPEN: 409,
  ALREADY_ACTIVE: 409,
  ACTIVE_CONSULTATION_EXISTS: 409,
  OUT_OF_ORDER_REASON_REQUIRED: 422,
  UNDO_WINDOW_EXPIRED: 400,
  UNDO_BLOCKED: 409,
  FEE_NOT_CONFIGURED: 422,
  RATE_LIMITED: 429,
  GEMINI_KEY_MISSING: 500,
  GEMINI_TIMEOUT: 504,
  INVOICE_ALREADY_WRITTEN_OFF: 400,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: readonly ErrorDetail[];
  readonly isOperational = true;

  constructor(code: ErrorCode, message: string, details: readonly ErrorDetail[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = StatusByCode[code];
    this.details = details;
  }

  static unauthorized(message = 'Missing or invalid credentials'): AppError {
    return new AppError('UNAUTHORIZED', message);
  }

  static forbidden(message = 'Forbidden'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static notFound(message = 'Not found'): AppError {
    return new AppError('NOT_FOUND', message);
  }

  static internal(requestId: string): AppError {
    return new AppError('INTERNAL', `Internal server error (requestId=${requestId})`);
  }

  static fromZod(issue: z.ZodIssue[]): AppError {
    const details: ErrorDetail[] = issue.map((i) => {
      const field = i.path.join('.');
      if (field.length > 0) {
        return { field, issue: i.message, expected: i.code };
      }
      return { issue: i.message, expected: i.code };
    });
    return new AppError('UNPROCESSABLE', 'Validation failed', details);
  }
}

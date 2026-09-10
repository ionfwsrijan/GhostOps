import { ZodError } from 'zod';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'INTEGRATION_ERROR'
  | 'INTEGRATION_NOT_CONFIGURED'
  | 'CONFIGURATION'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTEGRATION_ERROR: 502,
  INTEGRATION_NOT_CONFIGURED: 503,
  CONFIGURATION: 503,
  INTERNAL: 500,
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  BAD_REQUEST: 'The request is malformed or missing required fields',
  UNAUTHORIZED: 'Authentication required or credentials invalid',
  FORBIDDEN: 'You do not have permission to perform this action',
  NOT_FOUND: 'The requested resource does not exist',
  CONFLICT: 'The request conflicts with the current state',
  UNPROCESSABLE: 'The request is semantically invalid',
  RATE_LIMITED: 'Too many requests — slow down',
  INTEGRATION_ERROR: 'An upstream integration failed',
  INTEGRATION_NOT_CONFIGURED: 'The integration is not configured',
  CONFIGURATION: 'The system is misconfigured',
  INTERNAL: 'An unexpected internal error occurred',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message?: string, opts?: { details?: unknown; retryable?: boolean }) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = opts?.details;
    this.retryable = opts?.retryable ?? false;
  }
}

export class ValidationError extends AppError {
  constructor(issues: unknown) {
    super('UNPROCESSABLE', 'Validation failed', { details: issues });
  }
}

export function fromZod(error: ZodError): ValidationError {
  return new ValidationError(
    error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }))
  );
}

export function notFound(resource: string): AppError {
  return new AppError('NOT_FOUND', `${resource} not found`);
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, { details });
  }
}
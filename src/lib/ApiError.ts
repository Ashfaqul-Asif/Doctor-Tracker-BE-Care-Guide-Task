/**
 * Every failure the API raises deliberately goes through this class, so the error
 * middleware has exactly one shape to serialize and the client has exactly one
 * shape to parse: `{ error: { code, message, details? } }`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'You do not have permission to perform this action'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(resource = 'Resource'): ApiError {
    return new ApiError(404, 'NOT_FOUND', `${resource} not found`);
  }

  // No `conflict()` factory: the only 409 the API raises comes from a unique-index
  // violation, which `errorHandler` translates from the driver's 11000 directly. A
  // hand-rolled conflict would mean a read-then-write check, which races.
}

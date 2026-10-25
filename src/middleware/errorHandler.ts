import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../lib/ApiError.js';
import { logger } from '../lib/logger.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function isDuplicateKeyError(err: unknown): err is { code: number; keyValue?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `Cannot ${req.method} ${req.originalUrl}`));
};

/**
 * The single exit point for every failure. Express 5 forwards rejected promises from
 * async handlers here automatically, which is why no `asyncHandler` wrapper appears
 * anywhere in this codebase.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      },
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: `"${String(err.value)}" is not a valid ${err.path}` },
    } satisfies ErrorBody);
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
      },
    } satisfies ErrorBody);
    return;
  }

  if (isDuplicateKeyError(err)) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
    res.status(409).json({
      error: { code: 'DUPLICATE_KEY', message: `A record with that ${field} already exists` },
    } satisfies ErrorBody);
    return;
  }

  if (err instanceof ApiError) {
    const body: ErrorBody = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    // 4xx are expected traffic and stay at debug. A 5xx raised as an ApiError is still a
    // server fault, though — logging the whole class at debug would hide it in production,
    // where debug is off.
    if (err.status >= 500) logger.error({ err }, 'Request failed');
    else logger.debug({ err }, 'Request failed');
    res.status(err.status).json(body);
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.isProduction
        ? 'Something went wrong'
        : err instanceof Error
          ? err.message
          : String(err),
    },
  } satisfies ErrorBody);
};

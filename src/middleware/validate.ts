import type { Request, RequestHandler } from 'express';
import { z, type ZodType } from 'zod';

/**
 * Server-side validation is the source of truth (requirements §2) — the client's own
 * checks exist for UX only.
 */

export type ValidationTarget = 'body' | 'query' | 'params';

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      req.validated ??= {};
      if (schemas.params) req.validated.params = schemas.params.parse(req.params);
      if (schemas.query) req.validated.query = schemas.query.parse(req.query);
      if (schemas.body) req.validated.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      // errorHandler turns a ZodError into a 400 with per-field details.
      next(error);
    }
  };
}

/**
 * Typed reader for whatever `validate()` parsed. Passing the schema back in is what
 * buys inference at the call site — `const q = validated(req, 'query', listQuerySchema)`
 * — instead of an `as` cast in every controller.
 */
export function validated<S extends ZodType>(
  req: Request,
  target: ValidationTarget,
  _schema: S,
): z.infer<S> {
  return req.validated?.[target] as z.infer<S>;
}

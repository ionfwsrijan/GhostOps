import { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { requestStore, newRequestId, RequestContext } from '../context.js';
import { authRepo } from '../db/repos/auth.js';
import { hashToken, env } from '../config.js';
import { AppError } from '../errors.js';
import { ZodError } from 'zod';
import { recordHttp } from '../services/metrics.js';
import { logger } from '../logger.js';

/**
 * Runs every request inside an AsyncLocalStorage context and resolves the
 * actor (session user or API key) so repositories/services can audit.
 */
export function withRequestContext(): RequestHandler {
  return (req, res, next) => {
    const ctx: RequestContext = {
      requestId: newRequestId(),
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    };
    requestStore.run(ctx, () => {
      res.setHeader('x-request-id', ctx.requestId);
      next();
    });
  };
}

/** Reads cookies into req.cookies. */
export const cookieMiddleware = cookieParser();

/** Timing + status metrics for every response. */
export function metricsMiddleware(): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      recordHttp(req.baseUrl + (req.route?.path ?? req.path), req.method, res.statusCode, ms);
      const ctx = requestStore.getStore();
      logger.info({ method: req.method, path: req.originalUrl, status: res.statusCode, ms: Math.round(ms), requestId: ctx?.requestId }, 'http');
    });
    next();
  };
}

/** Resolves the actor from a session cookie or Bearer API key. */
export async function resolveActor(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requestStore.getStore();
    if (!ctx) return next();
    const sessionId = (req.cookies as Record<string, string> | undefined)?.ghostops_session;
    if (sessionId) {
      const found = await authRepo.getSessionByHash(hashToken(sessionId));
      if (found && found.user.status === 'active') {
        ctx.actor = { id: found.user.id, type: 'user', email: found.user.email };
        ctx.userRole = found.user.role;
      }
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      const apiKey = req.headers.authorization.slice(7).trim();
      const [prefix] = apiKey.split('.');
      const row = await authRepo.getApiKeyByPrefix(prefix ?? '');
      if (row && !row.revokedAt && row.keyHash === hashToken(apiKey)) {
        await authRepo.touchApiKey(row.id);
        ctx.actor = { id: row.ownerUserId ?? row.id, type: 'api', email: undefined };
        ctx.apiScopes = row.scope;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(): RequestHandler {
  return (_req, _res, next) => {
    const ctx = requestStore.getStore();
    if (ctx?.actor?.type === 'user') return next();
    next(new AppError('UNAUTHORIZED', 'Please sign in to access this resource'));
  };
}

export function requireApiKey(scopeRequired: string): RequestHandler {
  return (_req, _res, next) => {
    const ctx = requestStore.getStore();
    if (ctx?.actor?.type === 'api' && (ctx.apiScopes ?? []).includes(scopeRequired)) return next();
    next(new AppError('FORBIDDEN', `This endpoint requires an API key with the "${scopeRequired}" scope`));
  };
}

export function requireRole(...roles: Array<'admin' | 'operator' | 'readonly'>): RequestHandler {
  return (_req, _res, next) => {
    const ctx = requestStore.getStore();
    if (ctx?.actor?.type === 'user' && (roles as string[]).includes(ctx.userRole ?? '')) return next();
    next(new AppError('FORBIDDEN', `Requires one of these roles: ${roles.join(' / ')}`));
  };
}

/** Wrap async route handlers so rejections reach the error middleware. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

const burstLimit = (windowMs: number, max: number) =>
  rateLimit({ windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } } });

export const publicRateLimit = burstLimit(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX);
export const loginRateLimit = burstLimit(60_000, 5);
export const webhookRateLimit = burstLimit(60_000, 120);
export const intakeRateLimit = burstLimit(60_000, 60);

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const ctx = requestStore.getStore();
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, requestId: ctx?.requestId, details: err.details, retryable: err.retryable },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'UNPROCESSABLE',
        message: 'Validation failed',
        requestId: ctx?.requestId,
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
      },
    });
    return;
  }
  logger.error({ requestId: ctx?.requestId, err, path: req.originalUrl }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred', requestId: ctx?.requestId } });
}
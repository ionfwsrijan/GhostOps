import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { authRepo } from '../../db/repos/index.js';
import { hashToken, env } from '../../config.js';
import { AppError, fromZod } from '../../errors.js';
import { requestStore } from '../../context.js';
import { asyncHandler, loginRateLimit, requireAuth, requireRole } from '../middleware.js';
import { auditService } from '../../services/auditService.js';

const router = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const createUserSchema = z.object({ email: z.string().email(), password: z.string().min(10), name: z.string().min(1), role: z.enum(['admin', 'operator', 'readonly']).default('readonly') });
const apiKeySchema = z.object({ name: z.string().min(1), scope: z.array(z.enum(['read', 'write', 'ingest', 'all'])).default(['read']), expiresDays: z.number().int().positive().max(365).optional() });

const SESSION_COOKIE = 'ghostops_session';

router.post('/login', loginRateLimit, asyncHandler(async (req, res) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) throw fromZod(body.error);
  const user = await authRepo.getUserByEmail(body.data.email);
  if (!user || user.status !== 'active') throw new AppError('UNAUTHORIZED', 'Invalid credentials');
  const ok = await bcrypt.compare(body.data.password, user.passwordHash);
  if (!ok) throw new AppError('UNAUTHORIZED', 'Invalid credentials');

  const token = crypto.randomBytes(32).toString('hex');
  await authRepo.createSession({ user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000).toISOString(), ip: req.ip });
  await authRepo.touchLastLogin(user.id);
  await auditService.write({ actor_type: 'user', actor_id: user.id, actor_email: user.email, action: 'auth.login', metadata: { method: 'password' } });

  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: env.COOKIE_SECURE, maxAge: env.SESSION_TTL_DAYS * 86_400_000, path: '/' });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}));

router.post('/logout', requireAuth(), asyncHandler(async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId) {
    const found = await authRepo.getSessionByHash(hashToken(sessionId));
    if (found) await authRepo.revokeSession(found.session.id);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
}));

router.get('/me', requireAuth(), asyncHandler(async (_req, res) => {
  const ctx = requestStore.getStore();
  const user = ctx?.actor?.type === 'user' ? await authRepo.getUserById(ctx.actor.id) : null;
  res.json({ user: user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null });
}));

// ---- Admin: users ------------------------------------------------------------

router.get('/users', requireAuth(), requireRole('admin'), asyncHandler(async (_req, res) => {
  const users = await authRepo.listUsers();
  res.json({ users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt })) });
}));

router.post('/users', requireAuth(), requireRole('admin'), asyncHandler(async (req, res) => {
  const body = createUserSchema.safeParse(req.body);
  if (!body.success) throw fromZod(body.error);
  const existing = await authRepo.getUserByEmail(body.data.email);
  if (existing) throw new AppError('CONFLICT', 'A user with this email already exists');
  const hash = await bcrypt.hash(body.data.password, 10);
  const user = await authRepo.createUser({ email: body.data.email, password_hash: hash, name: body.data.name, role: body.data.role });
  await auditService.write({ actor_type: 'user', action: 'auth.user_created', target_type: 'user', target_id: user.id, after: { email: user.email, role: user.role } });
  res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}));

router.patch('/users/:id', requireAuth(), requireRole('admin'), asyncHandler(async (req, res) => {
  const status = z.enum(['active', 'disabled']).safeParse(req.body?.status);
  if (!status.success) throw fromZod(status.error);
  const user = await authRepo.setUserStatus(req.params.id, status.data);
  if (!user) throw new AppError('NOT_FOUND', 'user');
  await auditService.write({ actor_type: 'user', action: 'auth.user_status', target_type: 'user', target_id: user.id, after: { status: status.data } });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status } });
}));

// ---- Admin: API keys -----------------------------------------------------------

router.get('/api-keys', requireAuth(), requireRole('admin', 'operator'), asyncHandler(async (_req, res) => {
  const keys = await authRepo.listApiKeys();
  res.json({ apiKeys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scope: k.scope, expiresAt: k.expiresAt, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt })) });
}));

router.post('/api-keys', requireAuth(), requireRole('admin', 'operator'), asyncHandler(async (req, res) => {
  const body = apiKeySchema.safeParse(req.body);
  if (!body.success) throw fromZod(body.error);
  const secret = `gho_live_${crypto.randomBytes(18).toString('base64url').slice(0, 32)}`;
  const prefix = secret.slice(0, 14);
  const key = await authRepo.createApiKey({
    name: body.data.name,
    prefix,
    key_hash: hashToken(secret),
    scope: body.data.scope.includes('all') ? ['read', 'write', 'ingest'] : body.data.scope,
    expires_at: body.data.expiresDays ? new Date(Date.now() + body.data.expiresDays * 86_400_000).toISOString() : undefined,
  });
  await auditService.write({ actor_type: 'user', action: 'auth.api_key_created', target_type: 'api_key', target_id: key.id, after: { name: body.data.name, scope: body.data.scope } });
  res.status(201).json({ apiKey: { id: key.id, name: key.name, prefix: key.prefix, scope: key.scope, secret } });
}));

router.post('/api-keys/:id/revoke', requireAuth(), requireRole('admin'), asyncHandler(async (req, res) => {
  const revoked = await authRepo.revokeApiKey(req.params.id);
  if (!revoked) throw new AppError('NOT_FOUND', 'api key');
  await auditService.write({ actor_type: 'user', action: 'auth.api_key_revoked', target_type: 'api_key', target_id: revoked.id });
  res.json({ ok: true });
}));

export default router;
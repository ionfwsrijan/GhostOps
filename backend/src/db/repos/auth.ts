import { getPool } from '../pool.js';
import { UserRow, SessionRow, ApiKeyRow } from '../types.js';

const USER_COLS = `id, email, password_hash AS "passwordHash", name, role, status, last_login_at AS "lastLoginAt", created_at AS "createdAt"`;

export const authRepo = {
  async createUser(u: { email: string; password_hash: string; name: string; role: UserRow['role'] }): Promise<UserRow> {
    const { rows } = await getPool().query<UserRow>(
      `INSERT INTO users (email, password_hash, name, role) VALUES (lower($1), $2, $3, $4) RETURNING ${USER_COLS}`,
      [u.email, u.password_hash, u.name, u.role]
    );
    return rows[0];
  },

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await getPool().query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE lower(email) = lower($1)`, [email]);
    return rows[0] ?? null;
  },

  async getUserById(id: string): Promise<UserRow | null> {
    const { rows } = await getPool().query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async listUsers(): Promise<UserRow[]> {
    const { rows } = await getPool().query<UserRow>(
      `SELECT ${USER_COLS} FROM users ORDER BY created_at ASC`
    );
    return rows;
  },

  async touchLastLogin(id: string): Promise<void> {
    await getPool().query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [id]);
  },

  async setUserStatus(id: string, status: UserRow['status']): Promise<UserRow | null> {
    const { rows } = await getPool().query<UserRow>(
      `UPDATE users SET status = $2 WHERE id = $1 RETURNING ${USER_COLS}`,
      [id, status]
    );
    return rows[0] ?? null;
  },

  // ---- Sessions ------------------------------------------------------------

  async createSession(s: { user_id: string; token_hash: string; expires_at: string; ip?: string; user_agent?: string }): Promise<SessionRow> {
    const { rows } = await getPool().query<SessionRow>(
      `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, user_id AS "userId", token_hash AS "tokenHash", expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"`,
      [s.user_id, s.token_hash, s.expires_at, s.ip ?? null, s.user_agent ?? null]
    );
    return rows[0];
  },

  async getSessionByHash(tokenHash: string): Promise<{ session: SessionRow; user: UserRow } | null> {
    const { rows } = await getPool().query<Record<string, unknown>>(
      `SELECT s.id, s.user_id AS "session.userId", s.token_hash AS "session.tokenHash",
              s.expires_at AS "session.expiresAt", s.revoked_at AS "session.revokedAt", s.created_at AS "session.createdAt",
              u.id AS "user.id", u.email AS "user.email", u.password_hash AS "user.passwordHash", u.name AS "user.name",
              u.role AS "user.role", u.status AS "user.status", u.last_login_at AS "user.lastLoginAt", u.created_at AS "user.createdAt"
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [tokenHash]
    );
    if (!rows[0]) return null;
    const raw = rows[0] as unknown as Record<string, unknown>;
    const pick = (prefix: string) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
      }
      return out;
    };
    return {
      session: pick('session.') as unknown as SessionRow,
      user: pick('user.') as unknown as UserRow,
    };
  },

  async revokeSession(id: string): Promise<void> {
    await getPool().query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [id]);
  },

  async deleteExpiredSessions(): Promise<number> {
    const { rowCount } = await getPool().query(`DELETE FROM sessions WHERE expires_at <= now() OR revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days'`);
    return rowCount ?? 0;
  },

  // ---- API keys -------------------------------------------------------------

  async createApiKey(k: { name: string; prefix: string; key_hash: string; scope: string[]; owner_user_id?: string; expires_at?: string }): Promise<ApiKeyRow> {
    const { rows } = await getPool().query<ApiKeyRow>(
      `INSERT INTO api_keys (name, prefix, key_hash, scope, owner_user_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, prefix, key_hash AS "keyHash", scope, owner_user_id AS "ownerUserId",
                 expires_at AS "expiresAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt", created_at AS "createdAt"`,
      [k.name, k.prefix, k.key_hash, k.scope, k.owner_user_id ?? null, k.expires_at ?? null]
    );
    return rows[0];
  },

  async getApiKeyByPrefix(prefix: string): Promise<ApiKeyRow | null> {
    const { rows } = await getPool().query<ApiKeyRow>(
      `SELECT id, name, prefix, key_hash AS "keyHash", scope, owner_user_id AS "ownerUserId",
              expires_at AS "expiresAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt", created_at AS "createdAt"
       FROM api_keys WHERE prefix = $1`,
      [prefix]
    );
    return rows[0] ?? null;
  },

  async listApiKeys(includeRevoked = false): Promise<ApiKeyRow[]> {
    const { rows } = await getPool().query<ApiKeyRow>(
      `SELECT id, name, prefix, key_hash AS "keyHash", scope, owner_user_id AS "ownerUserId",
              expires_at AS "expiresAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt", created_at AS "createdAt"
       FROM api_keys ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'} ORDER BY created_at DESC`
    );
    return rows;
  },

  async touchApiKey(id: string): Promise<void> {
    await getPool().query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [id]);
  },

  async revokeApiKey(id: string): Promise<ApiKeyRow | null> {
    const { rows } = await getPool().query<ApiKeyRow>(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL
       RETURNING id, name, prefix, key_hash AS "keyHash", scope, owner_user_id AS "ownerUserId",
                 expires_at AS "expiresAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt", created_at AS "createdAt"`,
      [id]
    );
    return rows[0] ?? null;
  },
};
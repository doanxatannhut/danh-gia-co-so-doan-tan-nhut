import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from './db/client.js';

export type UserRole = 'admin' | 'reviewer' | 'unit';

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  unit_id: number | null;
  unit_name: string | null;
  unit_code: string | null;
  title: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = 'tttn_eval_session';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (derived.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuf);
}

export async function createSession(userId: number): Promise<string> {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt],
  );
  return token;
}

export async function destroySession(token: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function getUserByToken(token: string): Promise<AuthUser | null> {
  const db = await getDb();
  const res = await db.query<AuthUser>(
    `SELECT u.id, u.username, u.full_name, u.role, u.unit_id, u.title,
            un.name AS unit_name, un.code AS unit_code
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN units un ON un.id = u.unit_id
     WHERE s.token = $1 AND s.expires_at > NOW() AND u.active = TRUE`,
    [token],
  );
  return res.rows[0] ?? null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    return;
  }
  const user = await getUserByToken(token);
  if (!user) {
    res.clearCookie(SESSION_COOKIE);
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
    return;
  }
  req.user = user;
  next();
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Chưa xác thực người dùng.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
      return;
    }
    next();
  };
}

export async function writeAuditLog(params: {
  user: Pick<AuthUser, 'id' | 'full_name' | 'role'> | null;
  action: string;
  entityType: string;
  entityId?: string | number;
  summary: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.user?.id ?? null,
      params.user?.full_name ?? 'Hệ thống',
      params.user?.role ?? 'system',
      params.action,
      params.entityType,
      String(params.entityId ?? ''),
      params.summary,
      params.details ? JSON.stringify(params.details) : null,
    ],
  );
}

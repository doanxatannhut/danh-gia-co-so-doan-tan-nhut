import { Router } from 'express';
import { getDb } from '../db/client.js';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  requireAuth,
  verifyPassword,
  writeAuditLog,
} from '../auth.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!username || !password) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.' });
      return;
    }

    const db = await getDb();
    const userRes = await db.query<{
      id: number;
      username: string;
      password_hash: string;
      full_name: string;
      role: 'admin' | 'reviewer' | 'unit';
      unit_id: number | null;
      title: string;
      active: boolean;
      unit_name: string | null;
      unit_code: string | null;
    }>(
      `SELECT u.id, u.username, u.password_hash, u.full_name, u.role, u.unit_id, u.title, u.active,
              un.name AS unit_name, un.code AS unit_code
       FROM users u
       LEFT JOIN units un ON un.id = u.unit_id
       WHERE LOWER(u.username) = $1`,
      [username],
    );

    const user = userRes.rows[0];
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
      return;
    }

    const token = await createSession(user.id);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await writeAuditLog({
      user: { id: user.id, full_name: user.full_name, role: user.role },
      action: 'LOGIN',
      entityType: 'user',
      entityId: user.id,
      summary: `${user.full_name} đăng nhập hệ thống`,
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        unit_id: user.unit_id,
        unit_name: user.unit_name,
        unit_code: user.unit_code,
        title: user.title,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Lỗi hệ thống khi đăng nhập.' });
  }
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await destroySession(token);
  res.clearCookie(SESSION_COOKIE);
  if (req.user) {
    await writeAuditLog({
      user: req.user,
      action: 'LOGOUT',
      entityType: 'user',
      entityId: req.user.id,
      summary: `${req.user.full_name} đăng xuất khỏi hệ thống`,
    });
  }
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

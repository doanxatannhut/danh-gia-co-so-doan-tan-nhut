import { Router } from 'express';
import { getDb } from '../db/client.js';
import { hashPassword, requireAuth, requireRoles, writeAuditLog } from '../auth.js';
import { getVersionPointSummary } from '../scoring.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRoles('admin'));

// ==================== UNITS (CƠ SỞ ĐOÀN) ====================

adminRouter.get('/units', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT u.*,
              (SELECT COUNT(*)::int FROM users us WHERE us.unit_id = u.id) AS account_count
       FROM units u
       ORDER BY u.code ASC, u.id ASC`,
    );
    res.json({ units: result.rows });
  } catch (err) {
    console.error('List units error:', err);
    res.status(500).json({ error: 'Không thể tải danh sách Cơ sở Đoàn.' });
  }
});

adminRouter.post('/units', async (req, res) => {
  try {
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    const name = String(req.body?.name ?? '').trim();
    const unitType = String(req.body?.unit_type ?? 'dia_ban_dan_cu').trim();
    const secretaryName = String(req.body?.secretary_name ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();
    const memberCount = Math.max(0, Number(req.body?.member_count) || 0);

    if (!code || !name) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ mã đơn vị và tên Cơ sở Đoàn.' });
      return;
    }

    const db = await getDb();
    const exists = await db.query('SELECT id FROM units WHERE UPPER(code) = $1', [code]);
    if (exists.rows.length > 0) {
      res.status(409).json({ error: `Mã Cơ sở Đoàn "${code}" đã tồn tại.` });
      return;
    }

    const inserted = await db.query<{ id: number }>(
      `INSERT INTO units (code, name, unit_type, secretary_name, phone, member_count, active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING *`,
      [code, name, unitType, secretaryName, phone, memberCount],
    );
    const unitId = inserted.rows[0].id;

    // Auto-create evaluation records for published scorecards
    const pubVersions = await db.query<{ id: number }>(
      `SELECT id FROM scorecard_versions WHERE status = 'published'`,
    );
    for (const v of pubVersions.rows) {
      const points = await getVersionPointSummary(db, v.id);
      await db.query(
        `INSERT INTO evaluations (version_id, unit_id, status, active_max_score)
         VALUES ($1, $2, 'not_started', $3)
         ON CONFLICT (version_id, unit_id) DO NOTHING`,
        [v.id, unitId, points.activeMaxScore],
      );
    }

    await writeAuditLog({
      user: req.user!,
      action: 'CREATE_UNIT',
      entityType: 'unit',
      entityId: unitId,
      summary: `Tạo mới Cơ sở Đoàn: ${code} – ${name}`,
    });

    res.status(201).json({ unit: inserted.rows[0] });
  } catch (err) {
    console.error('Create unit error:', err);
    res.status(500).json({ error: 'Không thể tạo Cơ sở Đoàn mới.' });
  }
});

adminRouter.patch('/units/:id', async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const db = await getDb();
    const existingRes = await db.query<{
      code: string;
      name: string;
      unit_type: string;
      secretary_name: string;
      phone: string;
      member_count: number;
      active: boolean;
    }>('SELECT * FROM units WHERE id = $1', [unitId]);
    const existing = existingRes.rows[0];
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy Cơ sở Đoàn.' });
      return;
    }

    const code = String(req.body?.code ?? existing.code).trim().toUpperCase();
    const name = String(req.body?.name ?? existing.name).trim();
    const unitType = String(req.body?.unit_type ?? existing.unit_type).trim();
    const secretaryName = String(req.body?.secretary_name ?? existing.secretary_name).trim();
    const phone = String(req.body?.phone ?? existing.phone).trim();
    const memberCount = req.body?.member_count !== undefined ? Math.max(0, Number(req.body.member_count) || 0) : existing.member_count;
    const active = req.body?.active !== undefined ? Boolean(req.body.active) : existing.active;

    if (!code || !name) {
      res.status(400).json({ error: 'Mã đơn vị và tên Cơ sở Đoàn không được để trống.' });
      return;
    }

    const dup = await db.query('SELECT id FROM units WHERE UPPER(code) = $1 AND id <> $2', [code, unitId]);
    if (dup.rows.length > 0) {
      res.status(409).json({ error: `Mã đơn vị "${code}" đã được sử dụng.` });
      return;
    }

    const updated = await db.query(
      `UPDATE units
       SET code = $1, name = $2, unit_type = $3, secretary_name = $4, phone = $5, member_count = $6, active = $7
       WHERE id = $8 RETURNING *`,
      [code, name, unitType, secretaryName, phone, memberCount, active, unitId],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'UPDATE_UNIT',
      entityType: 'unit',
      entityId: unitId,
      summary: `Cập nhật thông tin Cơ sở Đoàn: ${code} – ${name}`,
    });

    res.json({ unit: updated.rows[0] });
  } catch (err) {
    console.error('Update unit error:', err);
    res.status(500).json({ error: 'Không thể cập nhật Cơ sở Đoàn.' });
  }
});

adminRouter.delete('/units/:id', async (req, res) => {
  try {
    const unitId = Number(req.params.id);
    const db = await getDb();
    const existing = await db.query<{ code: string; name: string }>('SELECT code, name FROM units WHERE id = $1', [unitId]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Không tìm thấy Cơ sở Đoàn.' });
      return;
    }

    await db.query('DELETE FROM units WHERE id = $1', [unitId]);
    await writeAuditLog({
      user: req.user!,
      action: 'DELETE_UNIT',
      entityType: 'unit',
      entityId: unitId,
      summary: `Xóa Cơ sở Đoàn: ${existing.rows[0].code} – ${existing.rows[0].name}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete unit error:', err);
    res.status(500).json({ error: 'Không thể xóa Cơ sở Đoàn.' });
  }
});

// ==================== USERS (TÀI KHOẢN & PHÂN QUYỀN) ====================

adminRouter.get('/users', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT u.id, u.username, u.full_name, u.role, u.unit_id, u.title, u.active, u.created_at,
              un.code AS unit_code, un.name AS unit_name
       FROM users u
       LEFT JOIN units un ON un.id = u.unit_id
       ORDER BY CASE u.role WHEN 'admin' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END, u.id ASC`,
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Không thể tải danh sách tài khoản.' });
  }
});

adminRouter.post('/users', async (req, res) => {
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const fullName = String(req.body?.full_name ?? '').trim();
    const role = String(req.body?.role ?? 'unit');
    const unitId = req.body?.unit_id ? Number(req.body.unit_id) : null;
    const title = String(req.body?.title ?? '').trim();

    if (!username || !password || !fullName) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập, mật khẩu và họ tên.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự.' });
      return;
    }
    if (!['admin', 'reviewer', 'unit'].includes(role)) {
      res.status(400).json({ error: 'Vai trò phân quyền không hợp lệ.' });
      return;
    }
    if (role === 'unit' && !unitId) {
      res.status(400).json({ error: 'Tài khoản Cơ sở Đoàn bắt buộc phải gắn với một Cơ sở Đoàn.' });
      return;
    }

    const db = await getDb();
    const exists = await db.query('SELECT id FROM users WHERE LOWER(username) = $1', [username]);
    if (exists.rows.length > 0) {
      res.status(409).json({ error: `Tên đăng nhập "${username}" đã tồn tại.` });
      return;
    }

    const passHash = hashPassword(password);
    const inserted = await db.query<{ id: number }>(
      `INSERT INTO users (username, password_hash, full_name, role, unit_id, title, active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, username, full_name, role, unit_id, title, active, created_at`,
      [username, passHash, fullName, role, role === 'unit' ? unitId : null, title],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'CREATE_USER',
      entityType: 'user',
      entityId: inserted.rows[0].id,
      summary: `Tạo tài khoản "${username}" (${fullName}) – Vai trò: ${role === 'admin' ? 'Quản trị viên Đoàn xã' : role === 'reviewer' ? 'Cán bộ Đoàn xã' : 'Cơ sở Đoàn'}`,
    });

    res.status(201).json({ user: inserted.rows[0] });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Không thể tạo tài khoản mới.' });
  }
});

adminRouter.patch('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const db = await getDb();
    const existingRes = await db.query<{
      id: number;
      username: string;
      full_name: string;
      role: string;
      unit_id: number | null;
      title: string;
      active: boolean;
    }>('SELECT id, username, full_name, role, unit_id, title, active FROM users WHERE id = $1', [userId]);
    const existing = existingRes.rows[0];
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
      return;
    }

    const fullName = String(req.body?.full_name ?? existing.full_name).trim();
    const role = String(req.body?.role ?? existing.role);
    const unitId = req.body?.unit_id !== undefined ? (req.body.unit_id ? Number(req.body.unit_id) : null) : existing.unit_id;
    const title = String(req.body?.title ?? existing.title).trim();
    const active = req.body?.active !== undefined ? Boolean(req.body.active) : existing.active;
    const newPassword = req.body?.password ? String(req.body.password) : '';

    if (!['admin', 'reviewer', 'unit'].includes(role)) {
      res.status(400).json({ error: 'Vai trò phân quyền không hợp lệ.' });
      return;
    }
    if (role === 'unit' && !unitId) {
      res.status(400).json({ error: 'Tài khoản Cơ sở Đoàn phải chọn Cơ sở Đoàn quản lý.' });
      return;
    }
    if (userId === req.user!.id && (role !== 'admin' || !active)) {
      res.status(400).json({ error: 'Không thể tự hạ quyền hoặc khóa tài khoản Quản trị viên đang đăng nhập.' });
      return;
    }
    if (newPassword && newPassword.length < 6) {
      res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
      return;
    }

    if (newPassword) {
      const passHash = hashPassword(newPassword);
      await db.query(
        `UPDATE users
         SET full_name = $1, role = $2, unit_id = $3, title = $4, active = $5, password_hash = $6
         WHERE id = $7`,
        [fullName, role, role === 'unit' ? unitId : null, title, active, passHash, userId],
      );
    } else {
      await db.query(
        `UPDATE users
         SET full_name = $1, role = $2, unit_id = $3, title = $4, active = $5
         WHERE id = $6`,
        [fullName, role, role === 'unit' ? unitId : null, title, active, userId],
      );
    }

    if (!active) {
      await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    }

    await writeAuditLog({
      user: req.user!,
      action: 'UPDATE_USER',
      entityType: 'user',
      entityId: userId,
      summary: `Cập nhật tài khoản "${existing.username}" (${fullName})${newPassword ? ' – Đã đặt lại mật khẩu' : ''}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Không thể cập nhật tài khoản.' });
  }
});

adminRouter.delete('/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (userId === req.user!.id) {
      res.status(400).json({ error: 'Không thể tự xóa tài khoản đang đăng nhập.' });
      return;
    }

    const db = await getDb();
    const existing = await db.query<{ username: string; full_name: string }>(
      'SELECT username, full_name FROM users WHERE id = $1',
      [userId],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
      return;
    }

    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    await writeAuditLog({
      user: req.user!,
      action: 'DELETE_USER',
      entityType: 'user',
      entityId: userId,
      summary: `Xóa tài khoản "${existing.rows[0].username}" (${existing.rows[0].full_name})`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Không thể xóa tài khoản.' });
  }
});

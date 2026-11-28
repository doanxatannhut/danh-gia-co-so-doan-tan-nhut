import { Router } from 'express';
import { getDb } from '../db/client.js';
import { requireAuth, requireRoles, verifyPassword, writeAuditLog } from '../auth.js';
import { getVersionPointSummary, recalculateEvaluationTotals } from '../scoring.js';

export const scorecardRouter = Router();

async function getActiveEvalCount(versionId: number): Promise<number> {
  const db = await getDb();
  const res = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM evaluations
     WHERE version_id = $1 AND status <> 'not_started'`,
    [versionId],
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

async function checkCanModifySection(versionId: number, sectionType: 'fixed' | 'supplementary'): Promise<string | null> {
  const db = await getDb();
  const vRes = await db.query<{ status: string; supplementary_published: boolean }>(
    'SELECT status, supplementary_published FROM scorecard_versions WHERE id = $1',
    [versionId],
  );
  const version = vRes.rows[0];
  if (!version) return 'Không tìm thấy phiên bản bảng điểm.';
  if (version.status === 'archived') {
    return 'Phiên bản bảng điểm đã ngừng áp dụng, không thể chỉnh sửa. Hãy sao chép sang phiên bản mới.';
  }

  const activeEvals = await getActiveEvalCount(versionId);
  if (activeEvals > 0) {
    if (sectionType === 'fixed') {
      return `Phiên bản này đã có ${activeEvals} hồ sơ đang đánh giá. Không thể thay đổi bộ tiêu chí cố định khi chưa tạo phiên bản mới.`;
    }
    if (sectionType === 'supplementary' && version.supplementary_published) {
      return `Bộ tiêu chí bổ sung đã được công bố và có ${activeEvals} hồ sơ đang đánh giá. Hãy tạo phiên bản mới để điều chỉnh.`;
    }
  }
  return null;
}

// List all scorecard versions
scorecardRouter.get('/', requireAuth, async (_req, res) => {
  try {
    const db = await getDb();
    const versionsRes = await db.query<{
      id: number;
      code: string;
      title: string;
      year: number;
      period: string;
      version_number: number;
      status: string;
      fixed_max_cap: string;
      supplementary_max_cap: string;
      supplementary_published: boolean;
      supplementary_published_at: string | null;
      published_at: string | null;
      created_at: string;
    }>(
      `SELECT * FROM scorecard_versions ORDER BY year DESC, version_number DESC, id DESC`,
    );

    const enriched = await Promise.all(
      versionsRes.rows.map(async (v) => {
        const points = await getVersionPointSummary(db, v.id);
        const activeEvaluations = await getActiveEvalCount(v.id);
        return {
          ...v,
          fixed_max_cap: Number(v.fixed_max_cap),
          supplementary_max_cap: Number(v.supplementary_max_cap),
          points,
          activeEvaluations,
        };
      }),
    );

    res.json({ versions: enriched });
  } catch (err) {
    console.error('List scorecards error:', err);
    res.status(500).json({ error: 'Không thể tải danh sách phiên bản bảng điểm.' });
  }
});

// Get full scorecard detail
scorecardRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const versionId = Number(req.params.id);
    const db = await getDb();
    const vRes = await db.query('SELECT * FROM scorecard_versions WHERE id = $1', [versionId]);
    const version = vRes.rows[0];
    if (!version) {
      res.status(404).json({ error: 'Không tìm thấy phiên bản bảng điểm.' });
      return;
    }

    const groupsRes = await db.query(
      `SELECT * FROM criteria_groups WHERE version_id = $1 ORDER BY section_type ASC, sort_order ASC, id ASC`,
      [versionId],
    );
    const itemsRes = await db.query(
      `SELECT * FROM criteria_items WHERE version_id = $1 ORDER BY sort_order ASC, id ASC`,
      [versionId],
    );

    const points = await getVersionPointSummary(db, versionId);
    const activeEvaluations = await getActiveEvalCount(versionId);

    res.json({
      version: {
        ...version,
        fixed_max_cap: Number(version.fixed_max_cap),
        supplementary_max_cap: Number(version.supplementary_max_cap),
      },
      points,
      activeEvaluations,
      groups: groupsRes.rows.map((g) => ({ ...g, max_score: Number(g.max_score) })),
      items: itemsRes.rows.map((i) => ({ ...i, max_score: Number(i.max_score) })),
    });
  } catch (err) {
    console.error('Get scorecard error:', err);
    res.status(500).json({ error: 'Không thể tải chi tiết bảng điểm.' });
  }
});

// Create new scorecard version (Admin only)
scorecardRouter.post('/', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const title = String(req.body?.title ?? '').trim();
    const year = Number(req.body?.year);
    const period = String(req.body?.period ?? '').trim();
    if (!title || !year || !period) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên bảng điểm, năm và đợt đánh giá.' });
      return;
    }

    const db = await getDb();
    const verCountRes = await db.query<{ max_ver: string }>(
      'SELECT COALESCE(MAX(version_number), 0)::text AS max_ver FROM scorecard_versions WHERE year = $1',
      [year],
    );
    const nextVersion = Number(verCountRes.rows[0]?.max_ver ?? 0) + 1;
    const code = `BD-${year}-V${nextVersion}-${Date.now().toString().slice(-3)}`;

    const created = await db.query<{ id: number }>(
      `INSERT INTO scorecard_versions (code, title, year, period, version_number, status, fixed_max_cap, supplementary_max_cap, supplementary_published, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', 60, 40, FALSE, $6) RETURNING *`,
      [code, title, year, period, nextVersion, req.user!.id],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'CREATE_SCORECARD',
      entityType: 'scorecard_version',
      entityId: created.rows[0].id,
      summary: `Tạo phiên bản bảng điểm mới: ${title} (Năm ${year})`,
    });

    res.status(201).json({ version: created.rows[0] });
  } catch (err) {
    console.error('Create scorecard error:', err);
    res.status(500).json({ error: 'Không thể tạo phiên bản bảng điểm mới.' });
  }
});

// Delete scorecard version (Admin only)
scorecardRouter.delete('/:id', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const versionId = Number(req.params.id);
    const db = await getDb();
    const existing = await db.query<{ code: string; title: string }>(
      'SELECT code, title FROM scorecard_versions WHERE id = $1',
      [versionId],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Không tìm thấy phiên bản bảng điểm.' });
      return;
    }

    const activeCount = await getActiveEvalCount(versionId);
    const forceDelete = req.query.force === '1';
    if (activeCount > 0) {
      if (req.user!.role !== 'admin' || !forceDelete) {
        res.status(409).json({
          error: `Phiên bản đang có ${activeCount} hồ sơ đã/đang chấm điểm. Chỉ Quản trị viên Đoàn xã xác nhận bằng mật khẩu đăng nhập mới được xóa bắt buộc.`,
          requiresAdminPassword: req.user!.role === 'admin',
        });
        return;
      }

      const confirmPassword = String(req.body?.confirm_password ?? '');
      if (!confirmPassword) {
        res.status(400).json({ error: 'Vui lòng nhập mật khẩu đăng nhập Quản trị viên để xác nhận xóa bắt buộc.' });
        return;
      }
      const userRes = await db.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.user!.id],
      );
      const storedHash = userRes.rows[0]?.password_hash;
      if (!storedHash || !verifyPassword(confirmPassword, storedHash)) {
        res.status(403).json({ error: 'Mật khẩu xác nhận không chính xác. Thao tác xóa bắt buộc đã bị hủy.' });
        return;
      }
    }

    await db.query('DELETE FROM scorecard_versions WHERE id = $1', [versionId]);

    await writeAuditLog({
      user: req.user!,
      action: activeCount > 0 ? 'FORCE_DELETE_SCORECARD' : 'DELETE_SCORECARD',
      entityType: 'scorecard_version',
      entityId: versionId,
      summary: `${activeCount > 0 ? `Xóa bắt buộc (có ${activeCount} hồ sơ)` : 'Xóa'} phiên bản bảng điểm ${existing.rows[0].code}: ${existing.rows[0].title}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete scorecard error:', err);
    res.status(500).json({ error: 'Không thể xóa phiên bản bảng điểm.' });
  }
});

// Clone scorecard from a previous year / version (Admin only)
scorecardRouter.post('/:id/clone', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const sourceId = Number(req.params.id);
    const db = await getDb();
    const srcRes = await db.query<{ title: string; year: number; period: string }>(
      'SELECT * FROM scorecard_versions WHERE id = $1',
      [sourceId],
    );
    const source = srcRes.rows[0];
    if (!source) {
      res.status(404).json({ error: 'Không tìm thấy phiên bản bảng điểm nguồn.' });
      return;
    }

    const targetYear = Number(req.body?.year) || source.year + 1;
    const targetPeriod = String(req.body?.period ?? '').trim() || `Đợt tổng kết năm ${targetYear}`;
    const targetTitle = String(req.body?.title ?? '').trim() || `Bảng điểm đánh giá Cơ sở Đoàn năm ${targetYear} – ${targetPeriod}`;
    const includeSupplementary = Boolean(req.body?.includeSupplementary ?? false);

    const verCountRes = await db.query<{ max_ver: string }>(
      'SELECT COALESCE(MAX(version_number), 0)::text AS max_ver FROM scorecard_versions WHERE year = $1',
      [targetYear],
    );
    const nextVersion = Number(verCountRes.rows[0]?.max_ver ?? 0) + 1;
    const code = `BD-${targetYear}-V${nextVersion}-${Date.now().toString().slice(-3)}`;

    const newVerRes = await db.query<{ id: number }>(
      `INSERT INTO scorecard_versions
        (code, title, year, period, version_number, status, fixed_max_cap, supplementary_max_cap, supplementary_published, cloned_from_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', 60, 40, FALSE, $6, $7)
       RETURNING *`,
      [code, targetTitle, targetYear, targetPeriod, nextVersion, sourceId, req.user!.id],
    );
    const newVersionId = newVerRes.rows[0].id;

    const srcGroups = await db.query<{
      id: number;
      section_type: string;
      code: string;
      title: string;
      description: string;
      max_score: string;
      sort_order: number;
    }>(
      `SELECT * FROM criteria_groups WHERE version_id = $1
       AND ($2 = TRUE OR section_type = 'fixed')
       ORDER BY sort_order ASC, id ASC`,
      [sourceId, includeSupplementary],
    );

    const groupMap = new Map<number, number>();
    for (const g of srcGroups.rows) {
      const ng = await db.query<{ id: number }>(
        `INSERT INTO criteria_groups (version_id, section_type, code, title, description, max_score, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [newVersionId, g.section_type, g.code, g.title, g.description, Number(g.max_score), g.sort_order],
      );
      groupMap.set(g.id, ng.rows[0].id);
    }

    const srcItems = await db.query<{
      group_id: number;
      section_type: string;
      code: string;
      title: string;
      scoring_guide: string;
      evidence_requirement: string;
      max_score: string;
      sort_order: number;
    }>(
      `SELECT * FROM criteria_items WHERE version_id = $1
       AND ($2 = TRUE OR section_type = 'fixed')
       ORDER BY sort_order ASC, id ASC`,
      [sourceId, includeSupplementary],
    );

    for (const item of srcItems.rows) {
      const mappedGroupId = groupMap.get(item.group_id);
      if (!mappedGroupId) continue;
      await db.query(
        `INSERT INTO criteria_items
          (version_id, group_id, section_type, code, title, scoring_guide, evidence_requirement, max_score, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newVersionId,
          mappedGroupId,
          item.section_type,
          item.code,
          item.title,
          item.scoring_guide,
          item.evidence_requirement,
          Number(item.max_score),
          item.sort_order,
        ],
      );
    }

    await writeAuditLog({
      user: req.user!,
      action: 'CLONE_SCORECARD',
      entityType: 'scorecard_version',
      entityId: newVersionId,
      summary: `Sao chép bộ tiêu chí từ "${source.title}" sang "${targetTitle}"`,
      details: { sourceId, includeSupplementary },
    });

    res.status(201).json({ version: newVerRes.rows[0] });
  } catch (err) {
    console.error('Clone scorecard error:', err);
    res.status(500).json({ error: 'Không thể sao chép bộ tiêu chí.' });
  }
});

// Publish or archive scorecard version (Admin only)
scorecardRouter.patch('/:id/status', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const versionId = Number(req.params.id);
    const status = String(req.body?.status ?? '');
    if (!['draft', 'published', 'archived'].includes(status)) {
      res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
      return;
    }

    const db = await getDb();
    const points = await getVersionPointSummary(db, versionId);
    if (status === 'published') {
      if (points.fixedMax <= 0) {
        res.status(400).json({ error: 'Không thể công bố bảng điểm khi chưa có tiêu chí cố định nào.' });
        return;
      }
      if (points.fixedMax > 60) {
        res.status(400).json({ error: `Tổng điểm cố định (${points.fixedMax}) vượt quá giới hạn 60 điểm.` });
        return;
      }
      if (points.supplementaryConfiguredMax > 40) {
        res.status(400).json({ error: `Tổng điểm bổ sung (${points.supplementaryConfiguredMax}) vượt quá giới hạn 40 điểm.` });
        return;
      }
    }

    await db.query(
      `UPDATE scorecard_versions
       SET status = $1,
           published_at = CASE WHEN $1 = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
           updated_at = NOW()
       WHERE id = $2`,
      [status, versionId],
    );

    // Ensure every active unit has an evaluation record when published
    if (status === 'published') {
      const units = await db.query<{ id: number }>('SELECT id FROM units WHERE active = TRUE');
      for (const u of units.rows) {
        await db.query(
          `INSERT INTO evaluations (version_id, unit_id, status, active_max_score)
           VALUES ($1, $2, 'not_started', $3)
           ON CONFLICT (version_id, unit_id) DO NOTHING`,
          [versionId, u.id, points.activeMaxScore],
        );
      }
    }

    await writeAuditLog({
      user: req.user!,
      action: status === 'published' ? 'PUBLISH_SCORECARD' : status === 'archived' ? 'ARCHIVE_SCORECARD' : 'SET_DRAFT_SCORECARD',
      entityType: 'scorecard_version',
      entityId: versionId,
      summary: `Chuyển trạng thái phiên bản bảng điểm #${versionId} sang "${status}"`,
    });

    res.json({ ok: true, status });
  } catch (err) {
    console.error('Update scorecard status error:', err);
    res.status(500).json({ error: 'Không thể cập nhật trạng thái phiên bản bảng điểm.' });
  }
});

// Publish Supplementary 40-point criteria (Admin only)
scorecardRouter.post('/:id/publish-supplementary', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const versionId = Number(req.params.id);
    const db = await getDb();
    const points = await getVersionPointSummary(db, versionId);

    if (points.supplementaryConfiguredMax <= 0) {
      res.status(400).json({ error: 'Chưa có tiêu chí bổ sung nào được thiết lập để công bố.' });
      return;
    }
    if (points.supplementaryConfiguredMax > 40) {
      res.status(400).json({ error: `Tổng điểm bổ sung (${points.supplementaryConfiguredMax}) vượt quá giới hạn 40 điểm.` });
      return;
    }
    if (points.fixedMax + points.supplementaryConfiguredMax > 100) {
      res.status(400).json({ error: 'Tổng điểm toàn hệ thống không được vượt quá 100 điểm.' });
      return;
    }

    await db.query(
      `UPDATE scorecard_versions
       SET supplementary_published = TRUE,
           supplementary_published_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [versionId],
    );

    // Recalculate active_max_score for all evaluations of this version
    const evals = await db.query<{ id: number }>('SELECT id FROM evaluations WHERE version_id = $1', [versionId]);
    for (const ev of evals.rows) {
      await recalculateEvaluationTotals(db, ev.id);
    }

    await writeAuditLog({
      user: req.user!,
      action: 'PUBLISH_SUPPLEMENTARY_CRITERIA',
      entityType: 'scorecard_version',
      entityId: versionId,
      summary: `Công bố bộ tiêu chí bổ sung (${points.supplementaryConfiguredMax}/40 điểm) cho bảng điểm #${versionId}`,
    });

    res.json({ ok: true, supplementaryMax: points.supplementaryConfiguredMax });
  } catch (err) {
    console.error('Publish supplementary error:', err);
    res.status(500).json({ error: 'Không thể công bố bộ tiêu chí bổ sung.' });
  }
});

// Create criteria group (Admin only)
scorecardRouter.post('/:id/groups', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const versionId = Number(req.params.id);
    const sectionType = req.body?.section_type === 'supplementary' ? 'supplementary' : 'fixed';
    const lockError = await checkCanModifySection(versionId, sectionType);
    if (lockError) {
      res.status(409).json({ error: lockError });
      return;
    }

    const code = String(req.body?.code ?? '').trim();
    const title = String(req.body?.title ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    const maxScore = Number(req.body?.max_score ?? 0);

    if (!code || !title) {
      res.status(400).json({ error: 'Vui lòng nhập mã nhóm và tên nhóm tiêu chí.' });
      return;
    }
    if (Number.isNaN(maxScore) || maxScore < 0) {
      res.status(400).json({ error: 'Điểm tối đa của nhóm không hợp lệ.' });
      return;
    }

    const db = await getDb();
    const ordRes = await db.query<{ max_ord: string }>(
      'SELECT COALESCE(MAX(sort_order), 0)::text AS max_ord FROM criteria_groups WHERE version_id = $1',
      [versionId],
    );
    const nextOrder = Number(ordRes.rows[0]?.max_ord ?? 0) + 1;

    const inserted = await db.query(
      `INSERT INTO criteria_groups (version_id, section_type, code, title, description, max_score, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [versionId, sectionType, code, title, description, maxScore, nextOrder],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'CREATE_CRITERIA_GROUP',
      entityType: 'criteria_group',
      entityId: String(inserted.rows[0].id),
      summary: `Thêm nhóm tiêu chí ${code} (${sectionType === 'fixed' ? '60 điểm cố định' : '40 điểm bổ sung'}): ${title}`,
    });

    res.status(201).json({ group: { ...inserted.rows[0], max_score: Number(inserted.rows[0].max_score) } });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Không thể tạo nhóm tiêu chí.' });
  }
});

// Delete criteria group (Admin only)
scorecardRouter.delete('/:id/groups/:groupId', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const versionId = Number(req.params.id);
    const groupId = Number(req.params.groupId);
    const db = await getDb();
    const gRes = await db.query<{ section_type: 'fixed' | 'supplementary'; code: string; title: string }>(
      'SELECT section_type, code, title FROM criteria_groups WHERE id = $1 AND version_id = $2',
      [groupId, versionId],
    );
    const group = gRes.rows[0];
    if (!group) {
      res.status(404).json({ error: 'Không tìm thấy nhóm tiêu chí.' });
      return;
    }
    const lockError = await checkCanModifySection(versionId, group.section_type);
    if (lockError) {
      res.status(409).json({ error: lockError });
      return;
    }

    await db.query('DELETE FROM criteria_groups WHERE id = $1', [groupId]);
    await writeAuditLog({
      user: req.user!,
      action: 'DELETE_CRITERIA_GROUP',
      entityType: 'criteria_group',
      entityId: groupId,
      summary: `Xóa nhóm tiêu chí ${group.code}: ${group.title}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete group error:', err);
    res.status(500).json({ error: 'Không thể xóa nhóm tiêu chí.' });
  }
});

// Create criterion item (Admin only, strict 60/40/100 validation)
scorecardRouter.post('/:id/items', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const versionId = Number(req.params.id);
    const groupId = Number(req.body?.group_id);
    const code = String(req.body?.code ?? '').trim();
    const title = String(req.body?.title ?? '').trim();
    const scoringGuide = String(req.body?.scoring_guide ?? '').trim();
    const evidenceReq = String(req.body?.evidence_requirement ?? '').trim();
    const maxScore = Number(req.body?.max_score);

    if (!groupId || !code || !title || Number.isNaN(maxScore) || maxScore <= 0) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ nhóm, mã tiêu chí, nội dung và điểm tối đa (> 0).' });
      return;
    }

    const db = await getDb();
    const gRes = await db.query<{ section_type: 'fixed' | 'supplementary' }>(
      'SELECT section_type FROM criteria_groups WHERE id = $1 AND version_id = $2',
      [groupId, versionId],
    );
    const group = gRes.rows[0];
    if (!group) {
      res.status(404).json({ error: 'Không tìm thấy nhóm tiêu chí.' });
      return;
    }

    const lockError = await checkCanModifySection(versionId, group.section_type);
    if (lockError) {
      res.status(409).json({ error: lockError });
      return;
    }

    // Validate 60 / 40 / 100 caps
    const points = await getVersionPointSummary(db, versionId);
    if (group.section_type === 'fixed' && points.fixedMax + maxScore > 60) {
      res.status(400).json({
        error: `Tổng điểm nhóm tiêu chí cố định không được vượt quá 60 điểm (hiện tại: ${points.fixedMax}, thêm: ${maxScore}).`,
      });
      return;
    }
    if (group.section_type === 'supplementary' && points.supplementaryConfiguredMax + maxScore > 40) {
      res.status(400).json({
        error: `Tổng điểm nhóm tiêu chí bổ sung không được vượt quá 40 điểm (hiện tại: ${points.supplementaryConfiguredMax}, thêm: ${maxScore}).`,
      });
      return;
    }
    if (points.fixedMax + points.supplementaryConfiguredMax + maxScore > 100) {
      res.status(400).json({ error: 'Tổng điểm tối đa toàn hệ thống không được vượt quá 100 điểm.' });
      return;
    }

    const ordRes = await db.query<{ max_ord: string }>(
      'SELECT COALESCE(MAX(sort_order), 0)::text AS max_ord FROM criteria_items WHERE version_id = $1',
      [versionId],
    );
    const nextOrder = Number(ordRes.rows[0]?.max_ord ?? 0) + 1;

    const inserted = await db.query(
      `INSERT INTO criteria_items
        (version_id, group_id, section_type, code, title, scoring_guide, evidence_requirement, max_score, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [versionId, groupId, group.section_type, code, title, scoringGuide, evidenceReq, maxScore, nextOrder],
    );

    // Sync group max_score to sum of its items
    await db.query(
      `UPDATE criteria_groups
       SET max_score = COALESCE((SELECT SUM(max_score) FROM criteria_items WHERE group_id = $1), 0)
       WHERE id = $1`,
      [groupId],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'CREATE_CRITERION',
      entityType: 'criteria_item',
      entityId: String(inserted.rows[0].id),
      summary: `Thêm tiêu chí ${code} (${maxScore} điểm): ${title}`,
    });

    res.status(201).json({ item: { ...inserted.rows[0], max_score: Number(inserted.rows[0].max_score) } });
  } catch (err) {
    console.error('Create item error:', err);
    res.status(500).json({ error: 'Không thể thêm tiêu chí mới.' });
  }
});

// Update criterion item (Admin only)
scorecardRouter.patch('/:id/items/:itemId', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const versionId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const db = await getDb();
    const existingRes = await db.query<{
      id: number;
      group_id: number;
      section_type: 'fixed' | 'supplementary';
      code: string;
      title: string;
      scoring_guide: string;
      evidence_requirement: string;
      max_score: string;
    }>('SELECT * FROM criteria_items WHERE id = $1 AND version_id = $2', [itemId, versionId]);
    const existing = existingRes.rows[0];
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy tiêu chí.' });
      return;
    }

    const lockError = await checkCanModifySection(versionId, existing.section_type);
    if (lockError) {
      res.status(409).json({ error: lockError });
      return;
    }

    const code = String(req.body?.code ?? existing.code).trim();
    const title = String(req.body?.title ?? existing.title).trim();
    const scoringGuide = String(req.body?.scoring_guide ?? existing.scoring_guide).trim();
    const evidenceReq = String(req.body?.evidence_requirement ?? existing.evidence_requirement).trim();
    const newMax = req.body?.max_score !== undefined ? Number(req.body.max_score) : Number(existing.max_score);
    const oldMax = Number(existing.max_score);

    if (!code || !title || Number.isNaN(newMax) || newMax <= 0) {
      res.status(400).json({ error: 'Thông tin tiêu chí không hợp lệ.' });
      return;
    }

    const points = await getVersionPointSummary(db, versionId);
    const delta = newMax - oldMax;
    if (existing.section_type === 'fixed' && points.fixedMax + delta > 60) {
      res.status(400).json({ error: `Tổng điểm cố định không được vượt quá 60 điểm (sau điều chỉnh: ${points.fixedMax + delta}).` });
      return;
    }
    if (existing.section_type === 'supplementary' && points.supplementaryConfiguredMax + delta > 40) {
      res.status(400).json({ error: `Tổng điểm bổ sung không được vượt quá 40 điểm (sau điều chỉnh: ${points.supplementaryConfiguredMax + delta}).` });
      return;
    }

    const updated = await db.query(
      `UPDATE criteria_items
       SET code = $1, title = $2, scoring_guide = $3, evidence_requirement = $4, max_score = $5
       WHERE id = $6 RETURNING *`,
      [code, title, scoringGuide, evidenceReq, newMax, itemId],
    );

    await db.query(
      `UPDATE criteria_groups
       SET max_score = COALESCE((SELECT SUM(max_score) FROM criteria_items WHERE group_id = $1), 0)
       WHERE id = $1`,
      [existing.group_id],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'UPDATE_CRITERION',
      entityType: 'criteria_item',
      entityId: itemId,
      summary: `Cập nhật tiêu chí ${code} (${oldMax} → ${newMax} điểm)`,
    });

    res.json({ item: { ...updated.rows[0], max_score: Number(updated.rows[0].max_score) } });
  } catch (err) {
    console.error('Update item error:', err);
    res.status(500).json({ error: 'Không thể cập nhật tiêu chí.' });
  }
});

// Delete criterion item (Admin only)
scorecardRouter.delete('/:id/items/:itemId', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const versionId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const db = await getDb();
    const existingRes = await db.query<{
      group_id: number;
      section_type: 'fixed' | 'supplementary';
      code: string;
      title: string;
    }>('SELECT group_id, section_type, code, title FROM criteria_items WHERE id = $1 AND version_id = $2', [itemId, versionId]);
    const existing = existingRes.rows[0];
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy tiêu chí.' });
      return;
    }

    const lockError = await checkCanModifySection(versionId, existing.section_type);
    if (lockError) {
      res.status(409).json({ error: lockError });
      return;
    }

    await db.query('DELETE FROM criteria_items WHERE id = $1', [itemId]);
    await db.query(
      `UPDATE criteria_groups
       SET max_score = COALESCE((SELECT SUM(max_score) FROM criteria_items WHERE group_id = $1), 0)
       WHERE id = $1`,
      [existing.group_id],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'DELETE_CRITERION',
      entityType: 'criteria_item',
      entityId: itemId,
      summary: `Xóa tiêu chí ${existing.code}: ${existing.title}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete item error:', err);
    res.status(500).json({ error: 'Không thể xóa tiêu chí.' });
  }
});

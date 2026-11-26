import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb } from '../db/client.js';
import { requireAuth, requireRoles, writeAuditLog } from '../auth.js';
import { getVersionPointSummary, recalculateEvaluationTotals } from '../scoring.js';

export const evaluationRouter = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error('Định dạng tệp không được hỗ trợ. Chỉ chấp nhận ảnh (PNG, JPG, WEBP), PDF, Word (.doc, .docx) và Excel (.xls, .xlsx).'));
      return;
    }
    cb(null, true);
  },
});

async function resolveDefaultVersionId(): Promise<number | null> {
  const db = await getDb();
  const res = await db.query<{ id: number }>(
    `SELECT id FROM scorecard_versions
     ORDER BY CASE status WHEN 'published' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, year DESC, id DESC
     LIMIT 1`,
  );
  return res.rows[0]?.id ?? null;
}

async function ensureEvaluationsExist(versionId: number): Promise<void> {
  const db = await getDb();
  const points = await getVersionPointSummary(db, versionId);
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

// Dashboard overview stats & unit summary
evaluationRouter.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const versionId = req.query.versionId ? Number(req.query.versionId) : await resolveDefaultVersionId();
    if (!versionId) {
      res.json({ version: null, stats: null, units: [] });
      return;
    }

    await ensureEvaluationsExist(versionId);
    const vRes = await db.query('SELECT * FROM scorecard_versions WHERE id = $1', [versionId]);
    const version = vRes.rows[0];
    const points = await getVersionPointSummary(db, versionId);

    // Count active criteria for completion progress
    const critCountRes = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM criteria_items
       WHERE version_id = $1 AND (section_type = 'fixed' OR $2 = TRUE)`,
      [versionId, points.supplementaryPublished],
    );
    const totalActiveCriteria = Number(critCountRes.rows[0]?.cnt ?? 0);

    const isUnitRole = req.user!.role === 'unit';
    const evalsRes = await db.query<{
      id: number;
      unit_id: number;
      unit_code: string;
      unit_name: string;
      unit_type: string;
      secretary_name: string;
      member_count: number;
      status: string;
      self_total: string;
      review_total: string | null;
      official_total: string | null;
      active_max_score: string;
      classification: string;
      submitted_at: string | null;
      confirmed_at: string | null;
      updated_at: string;
      self_filled_count: string;
      review_filled_count: string;
      needs_evidence_count: string;
    }>(
      `SELECT e.id, e.unit_id, u.code AS unit_code, u.name AS unit_name, u.unit_type,
              u.secretary_name, u.member_count, e.status,
              e.self_total::text, e.review_total::text, e.official_total::text,
              e.active_max_score::text, e.classification, e.submitted_at, e.confirmed_at, e.updated_at,
              (SELECT COUNT(*)::text FROM evaluation_scores es
               JOIN criteria_items ci ON ci.id = es.criterion_id
               WHERE es.evaluation_id = e.id AND es.self_score IS NOT NULL
                 AND (ci.section_type = 'fixed' OR $2 = TRUE)) AS self_filled_count,
              (SELECT COUNT(*)::text FROM evaluation_scores es
               JOIN criteria_items ci ON ci.id = es.criterion_id
               WHERE es.evaluation_id = e.id AND es.review_score IS NOT NULL
                 AND (ci.section_type = 'fixed' OR $2 = TRUE)) AS review_filled_count,
              (SELECT COUNT(*)::text FROM evaluation_scores es
               WHERE es.evaluation_id = e.id AND es.needs_evidence = TRUE) AS needs_evidence_count
       FROM evaluations e
       JOIN units u ON u.id = e.unit_id
       WHERE e.version_id = $1
       ORDER BY COALESCE(e.official_total, e.review_total, e.self_total) DESC, u.code ASC`,
      [versionId, points.supplementaryPublished],
    );

    const allRows = evalsRes.rows.map((r) => {
      const selfTotal = Number(r.self_total ?? 0);
      const reviewTotal = r.review_total !== null ? Number(r.review_total) : null;
      const officialTotal = r.official_total !== null ? Number(r.official_total) : null;
      const diff = reviewTotal !== null ? Number((reviewTotal - selfTotal).toFixed(2)) : null;
      return {
        ...r,
        self_total: selfTotal,
        review_total: reviewTotal,
        official_total: officialTotal,
        diff,
        active_max_score: Number(r.active_max_score ?? points.activeMaxScore),
        self_filled_count: Number(r.self_filled_count),
        review_filled_count: Number(r.review_filled_count),
        needs_evidence_count: Number(r.needs_evidence_count),
        total_active_criteria: totalActiveCriteria,
      };
    });

    const stats = {
      totalUnits: allRows.length,
      notStarted: allRows.filter((r) => r.status === 'not_started').length,
      selfAssessing: allRows.filter((r) => r.status === 'self_assessing').length,
      submitted: allRows.filter((r) => r.status === 'submitted').length,
      underReview: allRows.filter((r) => r.status === 'under_review').length,
      needsRevision: allRows.filter((r) => r.status === 'needs_revision').length,
      completed: allRows.filter((r) => r.status === 'completed').length,
      totalActiveCriteria,
    };

    // Unit role strictly only receives its own unit dossier rows
    const visibleUnits = isUnitRole
      ? allRows.filter((r) => r.unit_id === req.user!.unit_id)
      : allRows;

    res.json({
      version,
      points,
      stats,
      units: visibleUnits,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Không thể tải dữ liệu tổng quan Dashboard.' });
  }
});

// Get full evaluation dossier
evaluationRouter.get('/evaluations/:id', requireAuth, async (req, res) => {
  try {
    const evalId = Number(req.params.id);
    const db = await getDb();

    const evalRes = await db.query<{
      id: number;
      version_id: number;
      unit_id: number;
      status: string;
      submitted_at: string | null;
      returned_at: string | null;
      return_note: string;
      confirmed_at: string | null;
      overall_comment: string;
      self_total: string;
      review_total: string | null;
      official_total: string | null;
      active_max_score: string;
      classification: string;
      unit_code: string;
      unit_name: string;
      unit_type: string;
      secretary_name: string;
      member_count: number;
      version_code: string;
      version_title: string;
      version_year: number;
      version_period: string;
      supplementary_published: boolean;
    }>(
      `SELECT e.*,
              u.code AS unit_code, u.name AS unit_name, u.unit_type, u.secretary_name, u.member_count,
              v.code AS version_code, v.title AS version_title, v.year AS version_year, v.period AS version_period,
              v.supplementary_published
       FROM evaluations e
       JOIN units u ON u.id = e.unit_id
       JOIN scorecard_versions v ON v.id = e.version_id
       WHERE e.id = $1`,
      [evalId],
    );

    const evaluation = evalRes.rows[0];
    if (!evaluation) {
      res.status(404).json({ error: 'Không tìm thấy hồ sơ đánh giá.' });
      return;
    }

    // Strict isolation: Cơ sở Đoàn chỉ xem được hồ sơ của chính đơn vị mình
    if (req.user!.role === 'unit' && evaluation.unit_id !== req.user!.unit_id) {
      res.status(403).json({ error: 'Bạn chỉ có quyền truy cập hồ sơ đánh giá của đơn vị mình.' });
      return;
    }

    const points = await getVersionPointSummary(db, evaluation.version_id);

    const groupsRes = await db.query(
      `SELECT * FROM criteria_groups
       WHERE version_id = $1 AND (section_type = 'fixed' OR $2 = TRUE)
       ORDER BY section_type ASC, sort_order ASC, id ASC`,
      [evaluation.version_id, points.supplementaryPublished],
    );

    const itemsRes = await db.query(
      `SELECT * FROM criteria_items
       WHERE version_id = $1 AND (section_type = 'fixed' OR $2 = TRUE)
       ORDER BY sort_order ASC, id ASC`,
      [evaluation.version_id, points.supplementaryPublished],
    );

    const scoresRes = await db.query(
      `SELECT es.*, u.full_name AS reviewer_name
       FROM evaluation_scores es
       LEFT JOIN users u ON u.id = es.reviewed_by
       WHERE es.evaluation_id = $1`,
      [evalId],
    );

    const evidenceRes = await db.query(
      `SELECT ef.*, u.full_name AS uploader_name
       FROM evidence_files ef
       LEFT JOIN users u ON u.id = ef.uploaded_by
       WHERE ef.evaluation_id = $1
       ORDER BY ef.uploaded_at DESC`,
      [evalId],
    );

    const historyRes = await db.query(
      `SELECT * FROM score_history
       WHERE evaluation_id = $1
       ORDER BY created_at DESC, id DESC`,
      [evalId],
    );

    res.json({
      evaluation: {
        ...evaluation,
        self_total: Number(evaluation.self_total ?? 0),
        review_total: evaluation.review_total !== null ? Number(evaluation.review_total) : null,
        official_total: evaluation.official_total !== null ? Number(evaluation.official_total) : null,
        active_max_score: Number(evaluation.active_max_score ?? points.activeMaxScore),
      },
      points,
      groups: groupsRes.rows.map((g) => ({ ...g, max_score: Number(g.max_score) })),
      items: itemsRes.rows.map((i) => ({ ...i, max_score: Number(i.max_score) })),
      scores: scoresRes.rows.map((s) => ({
        ...s,
        self_score: s.self_score !== null ? Number(s.self_score) : null,
        review_score: s.review_score !== null ? Number(s.review_score) : null,
      })),
      evidences: evidenceRes.rows,
      history: historyRes.rows.map((h) => ({
        ...h,
        old_score: h.old_score !== null ? Number(h.old_score) : null,
        new_score: h.new_score !== null ? Number(h.new_score) : null,
      })),
    });
  } catch (err) {
    console.error('Get evaluation error:', err);
    res.status(500).json({ error: 'Không thể tải chi tiết hồ sơ đánh giá.' });
  }
});

// Round 1: Save self-assessment score & explanation (Auto-save / Manual save)
evaluationRouter.put('/evaluations/:id/self-score', requireAuth, async (req, res) => {
  try {
    const evalId = Number(req.params.id);
    const criterionId = Number(req.body?.criterion_id);
    const selfScoreRaw = req.body?.self_score;
    const explanation = String(req.body?.explanation ?? '');

    const db = await getDb();
    const evalRes = await db.query<{ unit_id: number; version_id: number; status: string }>(
      'SELECT unit_id, version_id, status FROM evaluations WHERE id = $1',
      [evalId],
    );
    const evaluation = evalRes.rows[0];
    if (!evaluation) {
      res.status(404).json({ error: 'Không tìm thấy hồ sơ đánh giá.' });
      return;
    }

    if (req.user!.role === 'unit' && evaluation.unit_id !== req.user!.unit_id) {
      res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa hồ sơ của đơn vị khác.' });
      return;
    }
    if (req.user!.role === 'reviewer') {
      res.status(403).json({ error: 'Cán bộ thẩm định không nhập điểm tự chấm của Cơ sở Đoàn.' });
      return;
    }
    if (!['not_started', 'self_assessing', 'needs_revision'].includes(evaluation.status)) {
      res.status(409).json({ error: 'Hồ sơ đã gửi về Đoàn xã và bị khóa chỉnh sửa. Chỉ được chỉnh sửa khi Đoàn xã trả hồ sơ.' });
      return;
    }

    const critRes = await db.query<{ max_score: string; code: string }>(
      'SELECT max_score, code FROM criteria_items WHERE id = $1 AND version_id = $2',
      [criterionId, evaluation.version_id],
    );
    const criterion = critRes.rows[0];
    if (!criterion) {
      res.status(404).json({ error: 'Không tìm thấy tiêu chí trong bảng điểm.' });
      return;
    }

    const maxScore = Number(criterion.max_score);
    const selfScore = selfScoreRaw === null || selfScoreRaw === '' || selfScoreRaw === undefined ? null : Number(selfScoreRaw);
    if (selfScore !== null && (Number.isNaN(selfScore) || selfScore < 0 || selfScore > maxScore)) {
      res.status(400).json({ error: `Điểm tự đánh giá của tiêu chí ${criterion.code} phải từ 0 đến ${maxScore}.` });
      return;
    }

    const prevRes = await db.query<{ self_score: string | null }>(
      'SELECT self_score FROM evaluation_scores WHERE evaluation_id = $1 AND criterion_id = $2',
      [evalId, criterionId],
    );
    const oldScore = prevRes.rows[0]?.self_score !== null && prevRes.rows[0]?.self_score !== undefined
      ? Number(prevRes.rows[0].self_score)
      : null;

    await db.query(
      `INSERT INTO evaluation_scores (evaluation_id, criterion_id, self_score, explanation, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (evaluation_id, criterion_id)
       DO UPDATE SET self_score = EXCLUDED.self_score, explanation = EXCLUDED.explanation, updated_at = NOW()`,
      [evalId, criterionId, selfScore, explanation],
    );

    if (evaluation.status === 'not_started') {
      await db.query("UPDATE evaluations SET status = 'self_assessing', updated_at = NOW() WHERE id = $1", [evalId]);
    }

    if (oldScore !== selfScore) {
      await db.query(
        `INSERT INTO score_history (evaluation_id, criterion_id, round, old_score, new_score, reason, actor_id, actor_name, actor_role)
         VALUES ($1, $2, 'self', $3, $4, $5, $6, $7, $8)`,
        [
          evalId,
          criterionId,
          oldScore,
          selfScore,
          oldScore === null ? 'Nhập điểm tự đánh giá Vòng 1' : 'Cập nhật điểm tự đánh giá Vòng 1',
          req.user!.id,
          req.user!.full_name,
          req.user!.role,
        ],
      );
    }

    const totals = await recalculateEvaluationTotals(db, evalId);
    res.json({ ok: true, totals, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Save self score error:', err);
    res.status(500).json({ error: 'Không thể lưu điểm tự đánh giá.' });
  }
});

// Round 1: Submit dossier to Đoàn xã (locks editing)
evaluationRouter.post('/evaluations/:id/submit', requireAuth, async (req, res) => {
  try {
    const evalId = Number(req.params.id);
    const db = await getDb();
    const evalRes = await db.query<{ unit_id: number; version_id: number; status: string }>(
      'SELECT unit_id, version_id, status FROM evaluations WHERE id = $1',
      [evalId],
    );
    const evaluation = evalRes.rows[0];
    if (!evaluation) {
      res.status(404).json({ error: 'Không tìm thấy hồ sơ đánh giá.' });
      return;
    }

    if (req.user!.role === 'unit' && evaluation.unit_id !== req.user!.unit_id) {
      res.status(403).json({ error: 'Bạn chỉ được gửi hồ sơ của đơn vị mình.' });
      return;
    }
    if (!['not_started', 'self_assessing', 'needs_revision'].includes(evaluation.status)) {
      res.status(409).json({ error: 'Hồ sơ đã được gửi hoặc đã hoàn tất.' });
      return;
    }

    const points = await getVersionPointSummary(db, evaluation.version_id);
    const missingRes = await db.query<{ code: string }>(
      `SELECT ci.code
       FROM criteria_items ci
       LEFT JOIN evaluation_scores es ON es.criterion_id = ci.id AND es.evaluation_id = $1
       WHERE ci.version_id = $2
         AND (ci.section_type = 'fixed' OR $3 = TRUE)
         AND es.self_score IS NULL
       ORDER BY ci.sort_order`,
      [evalId, evaluation.version_id, points.supplementaryPublished],
    );

    if (missingRes.rows.length > 0) {
      res.status(400).json({
        error: `Còn ${missingRes.rows.length} tiêu chí chưa nhập điểm tự đánh giá: ${missingRes.rows.map((r) => r.code).join(', ')}.`,
        missingCodes: missingRes.rows.map((r) => r.code),
      });
      return;
    }

    await db.query(
      `UPDATE evaluations
       SET status = 'submitted', submitted_at = NOW(), submitted_by = $1, updated_at = NOW()
       WHERE id = $2`,
      [req.user!.id, evalId],
    );

    const totals = await recalculateEvaluationTotals(db, evalId);

    await writeAuditLog({
      user: req.user!,
      action: 'SUBMIT_EVALUATION',
      entityType: 'evaluation',
      entityId: evalId,
      summary: `Gửi hồ sơ tự đánh giá về Đoàn xã (Tổng tự chấm: ${totals.selfTotal}/${totals.activeMaxScore})`,
    });

    res.json({ ok: true, status: 'submitted', totals });
  } catch (err) {
    console.error('Submit evaluation error:', err);
    res.status(500).json({ error: 'Không thể gửi hồ sơ đánh giá.' });
  }
});

// Round 2: Save appraisal score (Admin / Reviewer only)
evaluationRouter.put('/evaluations/:id/review-score', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const evalId = Number(req.params.id);
    const criterionId = Number(req.body?.criterion_id);
    const reviewScoreRaw = req.body?.review_score;
    const adjustmentReason = String(req.body?.adjustment_reason ?? '').trim();
    const reviewerComment = String(req.body?.reviewer_comment ?? '').trim();
    const needsEvidence = Boolean(req.body?.needs_evidence ?? false);

    const db = await getDb();
    const evalRes = await db.query<{ version_id: number; status: string }>(
      'SELECT version_id, status FROM evaluations WHERE id = $1',
      [evalId],
    );
    const evaluation = evalRes.rows[0];
    if (!evaluation) {
      res.status(404).json({ error: 'Không tìm thấy hồ sơ đánh giá.' });
      return;
    }
    if (evaluation.status === 'completed') {
      res.status(409).json({ error: 'Hồ sơ đã được xác nhận kết quả chính thức và khóa chỉnh sửa.' });
      return;
    }
    if (!['submitted', 'under_review', 'needs_revision'].includes(evaluation.status)) {
      res.status(409).json({ error: 'Hồ sơ chưa được Cơ sở Đoàn gửi lên để thẩm định.' });
      return;
    }

    const critRes = await db.query<{ max_score: string; code: string }>(
      'SELECT max_score, code FROM criteria_items WHERE id = $1 AND version_id = $2',
      [criterionId, evaluation.version_id],
    );
    const criterion = critRes.rows[0];
    if (!criterion) {
      res.status(404).json({ error: 'Không tìm thấy tiêu chí.' });
      return;
    }

    const maxScore = Number(criterion.max_score);
    const reviewScore = reviewScoreRaw === null || reviewScoreRaw === '' || reviewScoreRaw === undefined ? null : Number(reviewScoreRaw);
    if (reviewScore !== null && (Number.isNaN(reviewScore) || reviewScore < 0 || reviewScore > maxScore)) {
      res.status(400).json({ error: `Điểm thẩm định của tiêu chí ${criterion.code} phải từ 0 đến ${maxScore}.` });
      return;
    }

    const prevRes = await db.query<{ self_score: string | null; review_score: string | null }>(
      'SELECT self_score, review_score FROM evaluation_scores WHERE evaluation_id = $1 AND criterion_id = $2',
      [evalId, criterionId],
    );
    const selfScore = prevRes.rows[0]?.self_score !== null && prevRes.rows[0]?.self_score !== undefined
      ? Number(prevRes.rows[0].self_score)
      : null;
    const oldReview = prevRes.rows[0]?.review_score !== null && prevRes.rows[0]?.review_score !== undefined
      ? Number(prevRes.rows[0].review_score)
      : null;

    // MANDATORY RULE: Must provide reason whenever appraisal score differs from self-assessment score
    if (reviewScore !== null && selfScore !== null && reviewScore !== selfScore && !adjustmentReason) {
      res.status(400).json({
        error: `Bắt buộc ghi lý do điều chỉnh điểm cho tiêu chí ${criterion.code} (tự chấm: ${selfScore} → thẩm định: ${reviewScore}).`,
      });
      return;
    }

    await db.query(
      `INSERT INTO evaluation_scores
        (evaluation_id, criterion_id, review_score, adjustment_reason, reviewer_comment, needs_evidence, reviewed_by, reviewed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (evaluation_id, criterion_id)
       DO UPDATE SET
         review_score = EXCLUDED.review_score,
         adjustment_reason = EXCLUDED.adjustment_reason,
         reviewer_comment = EXCLUDED.reviewer_comment,
         needs_evidence = EXCLUDED.needs_evidence,
         reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = NOW(),
         updated_at = NOW()`,
      [evalId, criterionId, reviewScore, adjustmentReason, reviewerComment, needsEvidence, req.user!.id],
    );

    if (evaluation.status === 'submitted') {
      await db.query("UPDATE evaluations SET status = 'under_review', updated_at = NOW() WHERE id = $1", [evalId]);
    }

    if (oldReview !== reviewScore) {
      const historyReason = reviewScore === selfScore
        ? 'Thống nhất giữ nguyên điểm tự chấm của Cơ sở Đoàn'
        : adjustmentReason || 'Cập nhật điểm thẩm định Vòng 2';

      await db.query(
        `INSERT INTO score_history (evaluation_id, criterion_id, round, old_score, new_score, reason, actor_id, actor_name, actor_role)
         VALUES ($1, $2, 'review', $3, $4, $5, $6, $7, $8)`,
        [evalId, criterionId, oldReview ?? selfScore, reviewScore, historyReason, req.user!.id, req.user!.full_name, req.user!.role],
      );
    }

    const totals = await recalculateEvaluationTotals(db, evalId);
    res.json({ ok: true, totals, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Save review score error:', err);
    res.status(500).json({ error: 'Không thể lưu điểm thẩm định.' });
  }
});

// Round 2: Quick action to keep all remaining self scores as review scores
evaluationRouter.post('/evaluations/:id/keep-all-self', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const evalId = Number(req.params.id);
    const db = await getDb();
    const evalRes = await db.query<{ version_id: number; status: string }>(
      'SELECT version_id, status FROM evaluations WHERE id = $1',
      [evalId],
    );
    const evaluation = evalRes.rows[0];
    if (!evaluation || !['submitted', 'under_review'].includes(evaluation.status)) {
      res.status(409).json({ error: 'Hồ sơ không ở trạng thái thẩm định.' });
      return;
    }

    const rows = await db.query<{ criterion_id: number; self_score: string }>(
      `SELECT criterion_id, self_score::text FROM evaluation_scores
       WHERE evaluation_id = $1 AND self_score IS NOT NULL AND review_score IS NULL`,
      [evalId],
    );

    for (const r of rows.rows) {
      const val = Number(r.self_score);
      await db.query(
        `UPDATE evaluation_scores
         SET review_score = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE evaluation_id = $3 AND criterion_id = $4`,
        [val, req.user!.id, evalId, r.criterion_id],
      );
      await db.query(
        `INSERT INTO score_history (evaluation_id, criterion_id, round, old_score, new_score, reason, actor_id, actor_name, actor_role)
         VALUES ($1, $2, 'review', $3, $3, 'Giữ nguyên điểm tự chấm (thẩm định nhanh)', $4, $5, $6)`,
        [evalId, r.criterion_id, val, req.user!.id, req.user!.full_name, req.user!.role],
      );
    }

    if (evaluation.status === 'submitted') {
      await db.query("UPDATE evaluations SET status = 'under_review', updated_at = NOW() WHERE id = $1", [evalId]);
    }

    const totals = await recalculateEvaluationTotals(db, evalId);
    res.json({ ok: true, count: rows.rows.length, totals });
  } catch (err) {
    console.error('Keep all self error:', err);
    res.status(500).json({ error: 'Không thể áp dụng nhanh điểm tự chấm.' });
  }
});

// Round 2: Return dossier to Cơ sở Đoàn for revision
evaluationRouter.post('/evaluations/:id/return', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const evalId = Number(req.params.id);
    const returnNote = String(req.body?.return_note ?? '').trim();
    if (!returnNote) {
      res.status(400).json({ error: 'Vui lòng nhập nội dung yêu cầu bổ sung khi trả hồ sơ.' });
      return;
    }

    const db = await getDb();
    const evalRes = await db.query<{ status: string }>('SELECT status FROM evaluations WHERE id = $1', [evalId]);
    if (!evalRes.rows[0] || !['submitted', 'under_review'].includes(evalRes.rows[0].status)) {
      res.status(409).json({ error: 'Chỉ có thể trả hồ sơ đang chờ thẩm định hoặc đang thẩm định.' });
      return;
    }

    await db.query(
      `UPDATE evaluations
       SET status = 'needs_revision', returned_at = NOW(), return_note = $1, updated_at = NOW()
       WHERE id = $2`,
      [returnNote, evalId],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'RETURN_EVALUATION',
      entityType: 'evaluation',
      entityId: evalId,
      summary: `Trả hồ sơ #${evalId} về Cơ sở Đoàn để bổ sung: ${returnNote}`,
    });

    res.json({ ok: true, status: 'needs_revision' });
  } catch (err) {
    console.error('Return evaluation error:', err);
    res.status(500).json({ error: 'Không thể trả hồ sơ.' });
  }
});

// Round 2: Confirm official result
evaluationRouter.post('/evaluations/:id/confirm', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const evalId = Number(req.params.id);
    const overallComment = String(req.body?.overall_comment ?? '').trim();
    const db = await getDb();

    const evalRes = await db.query<{ version_id: number; status: string }>(
      'SELECT version_id, status FROM evaluations WHERE id = $1',
      [evalId],
    );
    const evaluation = evalRes.rows[0];
    if (!evaluation || !['submitted', 'under_review'].includes(evaluation.status)) {
      res.status(409).json({ error: 'Chỉ có thể xác nhận hồ sơ đang ở trạng thái đã gửi hoặc đang thẩm định.' });
      return;
    }

    const points = await getVersionPointSummary(db, evaluation.version_id);
    const missingRes = await db.query<{ code: string }>(
      `SELECT ci.code
       FROM criteria_items ci
       LEFT JOIN evaluation_scores es ON es.criterion_id = ci.id AND es.evaluation_id = $1
       WHERE ci.version_id = $2
         AND (ci.section_type = 'fixed' OR $3 = TRUE)
         AND es.review_score IS NULL
       ORDER BY ci.sort_order`,
      [evalId, evaluation.version_id, points.supplementaryPublished],
    );

    if (missingRes.rows.length > 0) {
      res.status(400).json({
        error: `Còn ${missingRes.rows.length} tiêu chí chưa nhập điểm thẩm định: ${missingRes.rows.map((r) => r.code).join(', ')}.`,
      });
      return;
    }

    await db.query(
      `UPDATE evaluations
       SET status = 'completed', confirmed_at = NOW(), confirmed_by = $1, overall_comment = $2, updated_at = NOW()
       WHERE id = $3`,
      [req.user!.id, overallComment, evalId],
    );

    // Clear needs_evidence flags upon official confirmation
    await db.query('UPDATE evaluation_scores SET needs_evidence = FALSE WHERE evaluation_id = $1', [evalId]);

    const totals = await recalculateEvaluationTotals(db, evalId);

    await writeAuditLog({
      user: req.user!,
      action: 'CONFIRM_EVALUATION',
      entityType: 'evaluation',
      entityId: evalId,
      summary: `Xác nhận kết quả chính thức hồ sơ #${evalId}: ${totals.officialTotal}/${totals.activeMaxScore} (${totals.classification})`,
    });

    res.json({ ok: true, status: 'completed', totals });
  } catch (err) {
    console.error('Confirm evaluation error:', err);
    res.status(500).json({ error: 'Không thể xác nhận kết quả chính thức.' });
  }
});

// Upload evidence file for a criterion
evaluationRouter.post(
  '/evaluations/:id/criteria/:criterionId/evidence',
  requireAuth,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message || 'Lỗi tải lên tệp minh chứng.' });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const evalId = Number(req.params.id);
      const criterionId = Number(req.params.criterionId);
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Vui lòng chọn tệp minh chứng để tải lên.' });
        return;
      }

      const db = await getDb();
      const evalRes = await db.query<{ unit_id: number; status: string }>(
        'SELECT unit_id, status FROM evaluations WHERE id = $1',
        [evalId],
      );
      const evaluation = evalRes.rows[0];
      if (!evaluation) {
        fs.unlinkSync(file.path);
        res.status(404).json({ error: 'Không tìm thấy hồ sơ đánh giá.' });
        return;
      }

      if (req.user!.role === 'unit') {
        if (evaluation.unit_id !== req.user!.unit_id) {
          fs.unlinkSync(file.path);
          res.status(403).json({ error: 'Bạn không có quyền tải minh chứng cho đơn vị khác.' });
          return;
        }
        if (!['not_started', 'self_assessing', 'needs_revision'].includes(evaluation.status)) {
          fs.unlinkSync(file.path);
          res.status(409).json({ error: 'Hồ sơ đã khóa chỉnh sửa, không thể tải thêm minh chứng.' });
          return;
        }
      }

      // Decode UTF-8 original filename cleanly
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      const inserted = await db.query(
        `INSERT INTO evidence_files (evaluation_id, criterion_id, original_name, stored_name, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [evalId, criterionId, originalName, file.filename, file.mimetype, file.size, req.user!.id],
      );

      await writeAuditLog({
        user: req.user!,
        action: 'UPLOAD_EVIDENCE',
        entityType: 'evidence_file',
        entityId: String(inserted.rows[0].id),
        summary: `Tải lên minh chứng "${originalName}" cho hồ sơ #${evalId}`,
      });

      res.status(201).json({ evidence: inserted.rows[0] });
    } catch (err) {
      console.error('Upload evidence error:', err);
      res.status(500).json({ error: 'Không thể lưu tệp minh chứng.' });
    }
  },
);

// Protected download / preview of evidence file
evaluationRouter.get('/evidence/:fileId', requireAuth, async (req, res) => {
  try {
    const fileId = Number(req.params.fileId);
    const db = await getDb();
    const fRes = await db.query<{
      original_name: string;
      stored_name: string;
      mime_type: string;
      unit_id: number;
    }>(
      `SELECT ef.original_name, ef.stored_name, ef.mime_type, e.unit_id
       FROM evidence_files ef
       JOIN evaluations e ON e.id = ef.evaluation_id
       WHERE ef.id = $1`,
      [fileId],
    );
    const file = fRes.rows[0];
    if (!file) {
      res.status(404).json({ error: 'Không tìm thấy tệp minh chứng.' });
      return;
    }

    if (req.user!.role === 'unit' && file.unit_id !== req.user!.unit_id) {
      res.status(403).json({ error: 'Bạn không có quyền truy cập tệp minh chứng của đơn vị khác.' });
      return;
    }

    const fullPath = path.join(UPLOAD_DIR, path.basename(file.stored_name));
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Tệp minh chứng không còn tồn tại trên máy chủ.' });
      return;
    }

    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
    fs.createReadStream(fullPath).pipe(res);
  } catch (err) {
    console.error('Download evidence error:', err);
    res.status(500).json({ error: 'Không thể tải tệp minh chứng.' });
  }
});

// Delete evidence file
evaluationRouter.delete('/evidence/:fileId', requireAuth, async (req, res) => {
  try {
    const fileId = Number(req.params.fileId);
    const db = await getDb();
    const fRes = await db.query<{
      stored_name: string;
      original_name: string;
      unit_id: number;
      status: string;
    }>(
      `SELECT ef.stored_name, ef.original_name, e.unit_id, e.status
       FROM evidence_files ef
       JOIN evaluations e ON e.id = ef.evaluation_id
       WHERE ef.id = $1`,
      [fileId],
    );
    const file = fRes.rows[0];
    if (!file) {
      res.status(404).json({ error: 'Không tìm thấy tệp minh chứng.' });
      return;
    }

    if (req.user!.role === 'unit') {
      if (file.unit_id !== req.user!.unit_id) {
        res.status(403).json({ error: 'Không có quyền xóa minh chứng của đơn vị khác.' });
        return;
      }
      if (!['not_started', 'self_assessing', 'needs_revision'].includes(file.status)) {
        res.status(409).json({ error: 'Hồ sơ đã khóa, không thể xóa minh chứng.' });
        return;
      }
    }

    await db.query('DELETE FROM evidence_files WHERE id = $1', [fileId]);
    const fullPath = path.join(UPLOAD_DIR, path.basename(file.stored_name));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

    await writeAuditLog({
      user: req.user!,
      action: 'DELETE_EVIDENCE',
      entityType: 'evidence_file',
      entityId: fileId,
      summary: `Xóa tệp minh chứng "${file.original_name}"`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete evidence error:', err);
    res.status(500).json({ error: 'Không thể xóa tệp minh chứng.' });
  }
});

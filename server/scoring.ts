import type { DbClient } from './db/client.js';

export interface ActiveScoreSummary {
  fixedMax: number;
  supplementaryConfiguredMax: number;
  supplementaryPublished: boolean;
  activeMaxScore: number;
  unconfiguredSupplementary: number;
}

export function classifyScore(officialScore: number | null, activeMaxScore: number): string {
  if (officialScore === null || Number.isNaN(officialScore) || activeMaxScore <= 0) {
    return 'Chưa xếp loại';
  }
  const pct = (officialScore / activeMaxScore) * 100;
  if (pct >= 90) return 'Hoàn thành xuất sắc';
  if (pct >= 80) return 'Hoàn thành tốt';
  if (pct >= 65) return 'Hoàn thành nhiệm vụ';
  if (pct >= 50) return 'Trung bình';
  return 'Chưa hoàn thành';
}

export async function getVersionPointSummary(db: DbClient, versionId: number): Promise<ActiveScoreSummary> {
  const vRes = await db.query<{ supplementary_published: boolean }>(
    'SELECT supplementary_published FROM scorecard_versions WHERE id = $1',
    [versionId],
  );
  const supplementaryPublished = Boolean(vRes.rows[0]?.supplementary_published);

  const itemsRes = await db.query<{ section_type: string; total: string }>(
    `SELECT section_type, COALESCE(SUM(max_score), 0)::text AS total
     FROM criteria_items
     WHERE version_id = $1
     GROUP BY section_type`,
    [versionId],
  );

  let fixedMax = 0;
  let supplementaryConfiguredMax = 0;
  for (const row of itemsRes.rows) {
    if (row.section_type === 'fixed') fixedMax = Number(row.total);
    if (row.section_type === 'supplementary') supplementaryConfiguredMax = Number(row.total);
  }

  // IMPORTANT RULE: Never treat unconfigured or unpublished 40 supplementary points as 0 score penalty.
  // Only published supplementary criteria count toward the active maximum score.
  const activeMaxScore = fixedMax + (supplementaryPublished ? supplementaryConfiguredMax : 0);
  const unconfiguredSupplementary = Math.max(0, 40 - supplementaryConfiguredMax);

  return {
    fixedMax,
    supplementaryConfiguredMax,
    supplementaryPublished,
    activeMaxScore,
    unconfiguredSupplementary,
  };
}

export async function recalculateEvaluationTotals(db: DbClient, evaluationId: number): Promise<{
  selfTotal: number;
  reviewTotal: number | null;
  officialTotal: number | null;
  activeMaxScore: number;
  classification: string;
}> {
  const evalRes = await db.query<{ version_id: number; status: string }>(
    'SELECT version_id, status FROM evaluations WHERE id = $1',
    [evaluationId],
  );
  if (evalRes.rows.length === 0) {
    throw new Error('Không tìm thấy hồ sơ đánh giá.');
  }
  const { version_id: versionId, status } = evalRes.rows[0];
  const summary = await getVersionPointSummary(db, versionId);

  const scoreRes = await db.query<{
    self_total: string;
    review_total: string | null;
    reviewed_count: string;
  }>(
    `SELECT
       COALESCE(SUM(es.self_score), 0)::text AS self_total,
       CASE WHEN COUNT(es.review_score) > 0 THEN COALESCE(SUM(es.review_score), 0)::text ELSE NULL END AS review_total,
       COUNT(es.review_score)::text AS reviewed_count
     FROM criteria_items ci
     LEFT JOIN evaluation_scores es
       ON es.criterion_id = ci.id AND es.evaluation_id = $1
     WHERE ci.version_id = $2
       AND (ci.section_type = 'fixed' OR $3 = TRUE)`,
    [evaluationId, versionId, summary.supplementaryPublished],
  );

  const selfTotal = Number(scoreRes.rows[0]?.self_total ?? 0);
  const reviewTotal = scoreRes.rows[0]?.review_total !== null && scoreRes.rows[0]?.review_total !== undefined
    ? Number(scoreRes.rows[0].review_total)
    : null;
  const officialTotal = status === 'completed' ? reviewTotal : null;
  const classification = status === 'completed'
    ? classifyScore(officialTotal, summary.activeMaxScore)
    : 'Chưa xếp loại';

  await db.query(
    `UPDATE evaluations
     SET self_total = $1,
         review_total = $2,
         official_total = $3,
         active_max_score = $4,
         classification = $5,
         updated_at = NOW()
     WHERE id = $6`,
    [selfTotal, reviewTotal, officialTotal, summary.activeMaxScore, classification, evaluationId],
  );

  return {
    selfTotal,
    reviewTotal,
    officialTotal,
    activeMaxScore: summary.activeMaxScore,
    classification,
  };
}

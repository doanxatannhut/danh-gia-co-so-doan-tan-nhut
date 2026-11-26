import type { DbClient } from './client.js';

export async function initSchema(db: DbClient): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS units (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      unit_type TEXT NOT NULL DEFAULT 'dia_ban_dan_cu',
      secretary_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      member_count INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'unit')),
      unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS scorecard_versions (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      year INTEGER NOT NULL,
      period TEXT NOT NULL,
      version_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')) DEFAULT 'draft',
      fixed_max_cap NUMERIC(5,2) NOT NULL DEFAULT 60,
      supplementary_max_cap NUMERIC(5,2) NOT NULL DEFAULT 40,
      supplementary_published BOOLEAN NOT NULL DEFAULT FALSE,
      supplementary_published_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      cloned_from_id INTEGER REFERENCES scorecard_versions(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS criteria_groups (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES scorecard_versions(id) ON DELETE CASCADE,
      section_type TEXT NOT NULL CHECK (section_type IN ('fixed', 'supplementary')),
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      max_score NUMERIC(5,2) NOT NULL CHECK (max_score >= 0),
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS criteria_items (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES scorecard_versions(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES criteria_groups(id) ON DELETE CASCADE,
      section_type TEXT NOT NULL CHECK (section_type IN ('fixed', 'supplementary')),
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      scoring_guide TEXT NOT NULL DEFAULT '',
      evidence_requirement TEXT NOT NULL DEFAULT '',
      max_score NUMERIC(5,2) NOT NULL CHECK (max_score > 0),
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id SERIAL PRIMARY KEY,
      version_id INTEGER NOT NULL REFERENCES scorecard_versions(id) ON DELETE CASCADE,
      unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('not_started', 'self_assessing', 'submitted', 'under_review', 'needs_revision', 'completed')) DEFAULT 'not_started',
      submitted_at TIMESTAMPTZ,
      submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      returned_at TIMESTAMPTZ,
      return_note TEXT NOT NULL DEFAULT '',
      confirmed_at TIMESTAMPTZ,
      confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      overall_comment TEXT NOT NULL DEFAULT '',
      self_total NUMERIC(6,2) NOT NULL DEFAULT 0,
      review_total NUMERIC(6,2),
      official_total NUMERIC(6,2),
      active_max_score NUMERIC(6,2) NOT NULL DEFAULT 60,
      classification TEXT NOT NULL DEFAULT 'Chưa xếp loại',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (version_id, unit_id)
    );

    CREATE TABLE IF NOT EXISTS evaluation_scores (
      id SERIAL PRIMARY KEY,
      evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
      criterion_id INTEGER NOT NULL REFERENCES criteria_items(id) ON DELETE CASCADE,
      self_score NUMERIC(5,2),
      explanation TEXT NOT NULL DEFAULT '',
      review_score NUMERIC(5,2),
      adjustment_reason TEXT NOT NULL DEFAULT '',
      reviewer_comment TEXT NOT NULL DEFAULT '',
      needs_evidence BOOLEAN NOT NULL DEFAULT FALSE,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (evaluation_id, criterion_id)
    );

    CREATE TABLE IF NOT EXISTS evidence_files (
      id SERIAL PRIMARY KEY,
      evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
      criterion_id INTEGER NOT NULL REFERENCES criteria_items(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS score_history (
      id SERIAL PRIMARY KEY,
      evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
      criterion_id INTEGER NOT NULL REFERENCES criteria_items(id) ON DELETE CASCADE,
      round TEXT NOT NULL CHECK (round IN ('self', 'review')),
      old_score NUMERIC(5,2),
      new_score NUMERIC(5,2),
      reason TEXT NOT NULL DEFAULT '',
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_criteria_groups_version ON criteria_groups(version_id);
    CREATE INDEX IF NOT EXISTS idx_criteria_items_version ON criteria_items(version_id);
    CREATE INDEX IF NOT EXISTS idx_evaluations_version ON evaluations(version_id);
    CREATE INDEX IF NOT EXISTS idx_evaluation_scores_eval ON evaluation_scores(evaluation_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_files_eval ON evidence_files(evaluation_id);
    CREATE INDEX IF NOT EXISTS idx_score_history_eval ON score_history(evaluation_id, criterion_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
  `);
}

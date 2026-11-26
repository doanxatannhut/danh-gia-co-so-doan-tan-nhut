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

export interface DemoAccount {
  username: string;
  full_name: string;
  role: UserRole;
  title: string;
  unit_name: string | null;
}

export interface PointSummary {
  fixedMax: number;
  supplementaryConfiguredMax: number;
  supplementaryPublished: boolean;
  activeMaxScore: number;
  unconfiguredSupplementary: number;
}

export interface ScorecardVersion {
  id: number;
  code: string;
  title: string;
  year: number;
  period: string;
  version_number: number;
  status: 'draft' | 'published' | 'archived';
  fixed_max_cap: number;
  supplementary_max_cap: number;
  supplementary_published: boolean;
  supplementary_published_at: string | null;
  published_at: string | null;
  created_at: string;
  points?: PointSummary;
  activeEvaluations?: number;
}

export interface CriteriaGroup {
  id: number;
  version_id: number;
  section_type: 'fixed' | 'supplementary';
  code: string;
  title: string;
  description: string;
  max_score: number;
  sort_order: number;
}

export interface CriteriaItem {
  id: number;
  version_id: number;
  group_id: number;
  section_type: 'fixed' | 'supplementary';
  code: string;
  title: string;
  scoring_guide: string;
  evidence_requirement: string;
  max_score: number;
  sort_order: number;
}

export type EvaluationStatus =
  | 'not_started'
  | 'self_assessing'
  | 'submitted'
  | 'under_review'
  | 'needs_revision'
  | 'completed';

export interface DashboardUnitRow {
  id: number;
  unit_id: number;
  unit_code: string;
  unit_name: string;
  unit_type: string;
  secretary_name: string;
  member_count: number;
  status: EvaluationStatus;
  self_total: number;
  review_total: number | null;
  official_total: number | null;
  diff: number | null;
  active_max_score: number;
  classification: string;
  submitted_at: string | null;
  confirmed_at: string | null;
  updated_at: string;
  self_filled_count: number;
  review_filled_count: number;
  needs_evidence_count: number;
  total_active_criteria: number;
}

export interface DashboardStats {
  totalUnits: number;
  notStarted: number;
  selfAssessing: number;
  submitted: number;
  underReview: number;
  needsRevision: number;
  completed: number;
  totalActiveCriteria: number;
}

export interface DashboardData {
  version: ScorecardVersion | null;
  points: PointSummary | null;
  stats: DashboardStats | null;
  units: DashboardUnitRow[];
}

export interface EvaluationScore {
  id: number;
  evaluation_id: number;
  criterion_id: number;
  self_score: number | null;
  explanation: string;
  review_score: number | null;
  adjustment_reason: string;
  reviewer_comment: string;
  needs_evidence: boolean;
  reviewed_by: number | null;
  reviewer_name?: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

export interface EvidenceFile {
  id: number;
  evaluation_id: number;
  criterion_id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: number | null;
  uploader_name?: string | null;
  uploaded_at: string;
}

export interface ScoreHistoryItem {
  id: number;
  evaluation_id: number;
  criterion_id: number;
  round: 'self' | 'review';
  old_score: number | null;
  new_score: number | null;
  reason: string;
  actor_id: number | null;
  actor_name: string;
  actor_role: string;
  created_at: string;
}

export interface EvaluationDetail {
  evaluation: {
    id: number;
    version_id: number;
    unit_id: number;
    status: EvaluationStatus;
    submitted_at: string | null;
    returned_at: string | null;
    return_note: string;
    confirmed_at: string | null;
    overall_comment: string;
    self_total: number;
    review_total: number | null;
    official_total: number | null;
    active_max_score: number;
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
  };
  points: PointSummary;
  groups: CriteriaGroup[];
  items: CriteriaItem[];
  scores: EvaluationScore[];
  evidences: EvidenceFile[];
  history: ScoreHistoryItem[];
}

export interface ReportRow {
  rank: number | null;
  evaluation_id: number;
  unit_id: number;
  unit_code: string;
  unit_name: string;
  secretary_name: string;
  status: EvaluationStatus;
  status_label: string;
  self_total: number;
  review_total: number | null;
  diff: number | null;
  official_total: number | null;
  active_max_score: number;
  completion_pct: number;
  classification: string;
  submitted_at: string | null;
  confirmed_at: string | null;
}

export interface AuditLogItem {
  id: number;
  actor_id: number | null;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

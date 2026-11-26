import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Paperclip,
  Upload,
  Trash2,
  Download,
  CheckCircle2,
  Send,
  RotateCcw,
  Lock,
  AlertTriangle,
  History,
  Save,
  CheckCheck,
  FileText,
  Filter,
  Info,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  DashboardUnitRow,
  EvaluationDetail,
  EvaluationScore,
} from '../types';
import {
  apiFetch,
  formatDateTime,
  formatFileSize,
  formatScore,
  ROLE_LABELS,
  STATUS_META,
} from '../utils/api';

interface ScoringPageProps {
  user: AuthUser;
  evaluationId: number | null;
  allUnits: DashboardUnitRow[];
  onSelectEvaluation: (id: number) => void;
  onDataChanged: () => void;
}

interface DraftReviewState {
  review_score: string;
  adjustment_reason: string;
  reviewer_comment: string;
  needs_evidence: boolean;
}

interface DraftSelfState {
  self_score: string;
  explanation: string;
}

export const ScoringPage: React.FC<ScoringPageProps> = ({
  user,
  evaluationId,
  allUnits,
  onSelectEvaluation,
  onDataChanged,
}) => {
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [filterMode, setFilterMode] = useState<'all' | 'incomplete' | 'needs_evidence' | 'adjusted'>('all');

  const [selfDrafts, setSelfDrafts] = useState<Record<number, DraftSelfState>>({});
  const [reviewDrafts, setReviewDrafts] = useState<Record<number, DraftReviewState>>({});
  const [autoSaveStatus, setAutoSaveStatus] = useState<string>('');
  const [uploadingCritId, setUploadingCritId] = useState<number | null>(null);
  const [savingReviewId, setSavingReviewId] = useState<number | null>(null);

  // Modals
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [overallComment, setOverallComment] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const saveTimers = useRef<Record<number, number>>({});

  async function loadDetail(id: number) {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<EvaluationDetail>(`/api/evaluations/${id}`);
      setDetail(res);
      const sMap: Record<number, DraftSelfState> = {};
      const rMap: Record<number, DraftReviewState> = {};
      const scoreByCrit = new Map<number, EvaluationScore>();
      for (const s of res.scores) scoreByCrit.set(s.criterion_id, s);

      for (const item of res.items) {
        const sc = scoreByCrit.get(item.id);
        sMap[item.id] = {
          self_score: sc?.self_score !== null && sc?.self_score !== undefined ? String(sc.self_score) : '',
          explanation: sc?.explanation ?? '',
        };
        rMap[item.id] = {
          review_score: sc?.review_score !== null && sc?.review_score !== undefined ? String(sc.review_score) : '',
          adjustment_reason: sc?.adjustment_reason ?? '',
          reviewer_comment: sc?.reviewer_comment ?? '',
          needs_evidence: Boolean(sc?.needs_evidence),
        };
      }
      setSelfDrafts(sMap);
      setReviewDrafts(rMap);
      setOverallComment(res.evaluation.overall_comment || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải hồ sơ đánh giá.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (evaluationId) {
      loadDetail(evaluationId);
    } else if (allUnits.length > 0) {
      onSelectEvaluation(allUnits[0].id);
    }
  }, [evaluationId, allUnits.length]);

  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach((t) => window.clearTimeout(t));
    };
  }, []);

  function showToastMsg(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3500);
  }

  const scoreMap = useMemo(() => {
    const m = new Map<number, EvaluationScore>();
    if (detail) {
      for (const s of detail.scores) m.set(s.criterion_id, s);
    }
    return m;
  }, [detail]);

  const evidenceByCrit = useMemo(() => {
    const m = new Map<number, typeof detail extends null ? never : NonNullable<typeof detail>['evidences']>();
    if (detail) {
      for (const ev of detail.evidences) {
        const arr = m.get(ev.criterion_id) ?? [];
        arr.push(ev);
        m.set(ev.criterion_id, arr);
      }
    }
    return m;
  }, [detail]);

  const historyByCrit = useMemo(() => {
    const m = new Map<number, NonNullable<typeof detail>['history']>();
    if (detail) {
      for (const h of detail.history) {
        const arr = m.get(h.criterion_id) ?? [];
        arr.push(h);
        m.set(h.criterion_id, arr);
      }
    }
    return m;
  }, [detail]);

  if (!evaluationId && allUnits.length === 0) {
    return (
      <div className="card-surface p-10 text-center text-sm text-[var(--text-secondary)]">
        Chưa có hồ sơ đánh giá nào trong phiên bản bảng điểm này.
      </div>
    );
  }

  if (loading && !detail) {
    return (
      <div className="card-surface p-10 text-center text-sm text-[var(--text-secondary)]">
        Đang tải bảng điểm chi tiết...
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="card-surface p-6 text-red-600 dark:text-red-400 text-sm">{error}</div>
    );
  }

  if (!detail) return null;

  const ev = detail.evaluation;
  const isCompleted = ev.status === 'completed';
  const canSelfEdit =
    (user.role === 'unit' || user.role === 'admin') &&
    ['not_started', 'self_assessing', 'needs_revision'].includes(ev.status);
  const canReviewEdit =
    (user.role === 'admin' || user.role === 'reviewer') &&
    ['submitted', 'under_review', 'needs_revision'].includes(ev.status);

  const statusMeta = STATUS_META[ev.status];

  const incompleteCount = detail.items.filter((item) => {
    const d = selfDrafts[item.id];
    return !d || d.self_score === '';
  }).length;

  const needsEvidenceCount = detail.items.filter((item) => scoreMap.get(item.id)?.needs_evidence).length;

  function toggleExpand(critId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(critId)) next.delete(critId);
      else next.add(critId);
      return next;
    });
  }

  function scheduleSelfAutoSave(criterionId: number, nextDraft: DraftSelfState, maxScore: number) {
    if (saveTimers.current[criterionId]) {
      window.clearTimeout(saveTimers.current[criterionId]);
    }
    const numVal = nextDraft.self_score === '' ? null : Number(nextDraft.self_score);
    if (numVal !== null && (Number.isNaN(numVal) || numVal < 0 || numVal > maxScore)) {
      setError(`Điểm tự chấm phải nằm trong khoảng 0 đến ${maxScore}.`);
      return;
    }
    setError('');
    setAutoSaveStatus('Đang tự động lưu...');

    saveTimers.current[criterionId] = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{
          totals: { selfTotal: number; reviewTotal: number | null; officialTotal: number | null; activeMaxScore: number };
          savedAt: string;
        }>(`/api/evaluations/${ev.id}/self-score`, {
          method: 'PUT',
          body: JSON.stringify({
            criterion_id: criterionId,
            self_score: numVal,
            explanation: nextDraft.explanation,
          }),
        });
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                evaluation: {
                  ...prev.evaluation,
                  status: prev.evaluation.status === 'not_started' ? 'self_assessing' : prev.evaluation.status,
                  self_total: res.totals.selfTotal,
                },
              }
            : prev,
        );
        const t = new Date(res.savedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setAutoSaveStatus(`Đã tự động lưu lúc ${t}`);
        onDataChanged();
      } catch (err) {
        setAutoSaveStatus('');
        setError(err instanceof Error ? err.message : 'Lỗi tự động lưu.');
      }
    }, 650);
  }

  function handleSelfChange(criterionId: number, patch: Partial<DraftSelfState>, maxScore: number) {
    const current = selfDrafts[criterionId] ?? { self_score: '', explanation: '' };
    const updated = { ...current, ...patch };
    setSelfDrafts((prev) => ({ ...prev, [criterionId]: updated }));
    scheduleSelfAutoSave(criterionId, updated, maxScore);
  }

  async function handleSaveReview(criterionId: number, maxScore: number) {
    const draft = reviewDrafts[criterionId];
    const selfVal = selfDrafts[criterionId]?.self_score !== '' ? Number(selfDrafts[criterionId]?.self_score) : null;
    const revVal = draft.review_score === '' ? null : Number(draft.review_score);

    if (revVal !== null && (Number.isNaN(revVal) || revVal < 0 || revVal > maxScore)) {
      setError(`Điểm Đoàn xã chấm phải nằm trong khoảng 0 đến ${maxScore}.`);
      return;
    }
    if (revVal !== null && selfVal !== null && revVal !== selfVal && !draft.adjustment_reason.trim()) {
      setError('Bắt buộc nhập lý do điều chỉnh điểm khi điểm thẩm định khác điểm tự chấm.');
      setExpandedIds((prev) => new Set(prev).add(criterionId));
      return;
    }

    setSavingReviewId(criterionId);
    setError('');
    try {
      await apiFetch(`/api/evaluations/${ev.id}/review-score`, {
        method: 'PUT',
        body: JSON.stringify({
          criterion_id: criterionId,
          review_score: revVal,
          adjustment_reason: draft.adjustment_reason,
          reviewer_comment: draft.reviewer_comment,
          needs_evidence: draft.needs_evidence,
        }),
      });
      await loadDetail(ev.id);
      onDataChanged();
      showToastMsg('Đã lưu điểm thẩm định và ghi nhận lịch sử.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu điểm thẩm định.');
    } finally {
      setSavingReviewId(null);
    }
  }

  async function handleUploadEvidence(criterionId: number, file: File) {
    setUploadingCritId(criterionId);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiFetch(`/api/evaluations/${ev.id}/criteria/${criterionId}/evidence`, {
        method: 'POST',
        body: fd,
      });
      await loadDetail(ev.id);
      showToastMsg(`Đã tải lên minh chứng "${file.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tải lên tệp minh chứng.');
    } finally {
      setUploadingCritId(null);
    }
  }

  async function handleDeleteEvidence(fileId: number) {
    try {
      await apiFetch(`/api/evidence/${fileId}`, { method: 'DELETE' });
      await loadDetail(ev.id);
      showToastMsg('Đã xóa tệp minh chứng.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa minh chứng.');
    }
  }

  async function handleSubmitDossier() {
    setActionBusy(true);
    setError('');
    try {
      await apiFetch(`/api/evaluations/${ev.id}/submit`, { method: 'POST' });
      setShowSubmitModal(false);
      await loadDetail(ev.id);
      onDataChanged();
      showToastMsg('Đã gửi hồ sơ tự đánh giá về Đoàn xã Tân Nhựt.');
    } catch (err) {
      setShowSubmitModal(false);
      setError(err instanceof Error ? err.message : 'Không thể gửi hồ sơ.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleKeepAllSelf() {
    setActionBusy(true);
    setError('');
    try {
      const res = await apiFetch<{ count: number }>(`/api/evaluations/${ev.id}/keep-all-self`, {
        method: 'POST',
      });
      await loadDetail(ev.id);
      onDataChanged();
      showToastMsg(`Đã giữ nguyên điểm tự chấm cho ${res.count} tiêu chí chưa thẩm định.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi áp dụng điểm.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleReturnDossier() {
    if (!returnNote.trim()) {
      setError('Vui lòng nhập nội dung yêu cầu bổ sung trước khi trả hồ sơ.');
      return;
    }
    setActionBusy(true);
    setError('');
    try {
      await apiFetch(`/api/evaluations/${ev.id}/return`, {
        method: 'POST',
        body: JSON.stringify({ return_note: returnNote }),
      });
      setShowReturnModal(false);
      setReturnNote('');
      await loadDetail(ev.id);
      onDataChanged();
      showToastMsg('Đã trả hồ sơ về Cơ sở Đoàn để bổ sung.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể trả hồ sơ.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleConfirmOfficial() {
    setActionBusy(true);
    setError('');
    try {
      await apiFetch(`/api/evaluations/${ev.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ overall_comment: overallComment }),
      });
      setShowConfirmModal(false);
      await loadDetail(ev.id);
      onDataChanged();
      showToastMsg('Đã xác nhận kết quả thẩm định chính thức!');
    } catch (err) {
      setShowConfirmModal(false);
      setError(err instanceof Error ? err.message : 'Không thể xác nhận kết quả.');
    } finally {
      setActionBusy(false);
    }
  }

  // Group items by group_id
  let globalRowIndex = 0;

  return (
    <div className="space-y-5">
      {/* Unit Switcher for Admin/Reviewer */}
      {user.role !== 'unit' && allUnits.length > 0 && (
        <div className="card-surface p-3 flex items-center gap-2 overflow-x-auto no-print">
          <span className="text-xs font-semibold text-[var(--text-secondary)] shrink-0 px-1">
            Chọn Cơ sở Đoàn:
          </span>
          {allUnits.map((u) => {
            const active = u.id === ev.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onSelectEvaluation(u.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition cursor-pointer ${
                  active
                    ? 'bg-[#005baa] text-white border-[#005baa]'
                    : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                {u.unit_code} – {u.unit_name}
              </button>
            );
          })}
        </div>
      )}

      {/* Alerts / Toasts */}
      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="p-1 cursor-pointer" aria-label="Đóng thông báo">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {toast && (
        <div role="status" className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm font-medium">
          {toast}
        </div>
      )}

      {/* Dossier Header Card */}
      <div className="card-surface p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950 text-[#005baa] dark:text-sky-300 font-mono text-xs font-bold">
                {ev.unit_code}
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${statusMeta.badgeClass}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`} />
                {statusMeta.label}
              </span>
              {autoSaveStatus && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  • {autoSaveStatus}
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold">{ev.unit_name}</h1>
            <div className="text-xs text-[var(--text-secondary)] flex flex-wrap gap-x-4 gap-y-1">
              <span>Bí thư: <strong>{ev.secretary_name}</strong></span>
              <span>Đoàn viên: <strong>{ev.member_count}</strong></span>
              <span>Bảng điểm: <strong>{ev.version_title}</strong></span>
              {ev.submitted_at && <span>Gửi hồ sơ: <strong>{formatDateTime(ev.submitted_at)}</strong></span>}
              {ev.confirmed_at && <span>Xác nhận: <strong>{formatDateTime(ev.confirmed_at)}</strong></span>}
            </div>
          </div>

          {/* Score Summary Boxes */}
          <div className="grid grid-cols-3 gap-2.5 shrink-0">
            <div className="px-3.5 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-center">
              <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 uppercase">Tự chấm</div>
              <div className="text-lg sm:text-xl font-bold text-blue-700 dark:text-blue-300">
                {formatScore(ev.self_total)}
                <span className="text-xs font-normal">/{ev.active_max_score}</span>
              </div>
            </div>
            <div
              className={`px-3.5 py-2.5 rounded-xl border text-center ${
                isCompleted
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                  : 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800'
              }`}
            >
              <div
                className={`text-[11px] font-semibold uppercase ${
                  isCompleted ? 'text-emerald-700 dark:text-emerald-300' : 'text-orange-700 dark:text-orange-300'
                }`}
              >
                {isCompleted ? 'Chính thức' : 'Đoàn xã chấm'}
              </div>
              <div
                className={`text-lg sm:text-xl font-bold ${
                  isCompleted ? 'text-emerald-700 dark:text-emerald-300' : 'text-orange-700 dark:text-orange-300'
                }`}
              >
                {ev.review_total !== null ? (
                  <>
                    {formatScore(ev.review_total)}
                    <span className="text-xs font-normal">/{ev.active_max_score}</span>
                  </>
                ) : (
                  '—'
                )}
              </div>
            </div>
            <div className="px-3.5 py-2.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-center">
              <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase">Xếp loại</div>
              <div className="text-xs sm:text-sm font-bold mt-1 leading-tight">
                {isCompleted ? (
                  <span className="text-emerald-700 dark:text-emerald-300">{ev.classification}</span>
                ) : (
                  <span className="text-slate-500">Chưa chốt</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Supplementary 40-pt Notice */}
        {!detail.points.supplementaryPublished && (
          <div className="p-3 rounded-xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-xs text-sky-900 dark:text-sky-200 flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0 text-sky-600" />
            <span>
              Thang điểm hiệu lực hiện tại là <strong>{detail.points.activeMaxScore}/100 điểm</strong> (60 điểm cố định). Phần{' '}
              <strong>40 điểm bổ sung</strong> chưa được Đoàn xã công bố nên <strong>không tính thành 0 điểm</strong> và không ảnh hưởng tỷ lệ xếp loại của đơn vị.
            </span>
          </div>
        )}

        {/* Return Note Banner */}
        {ev.status === 'needs_revision' && ev.return_note && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-sm flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Yêu cầu bổ sung từ Đoàn xã Tân Nhựt ({formatDateTime(ev.returned_at)}):</div>
              <div className="mt-0.5">{ev.return_note}</div>
            </div>
          </div>
        )}

        {/* Locked Notice for Unit */}
        {user.role === 'unit' && !canSelfEdit && !isCompleted && (
          <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              Hồ sơ đã được gửi về Đoàn xã lúc <strong>{formatDateTime(ev.submitted_at)}</strong> và đã khóa chỉnh sửa. Chỉ có thể chỉnh sửa lại nếu Đoàn xã trả hồ sơ yêu cầu bổ sung.
            </span>
          </div>
        )}

        {/* Official Confirmation Comment */}
        {isCompleted && ev.overall_comment && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-sm flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Nhận xét kết luận của Đoàn xã Tân Nhựt:</div>
              <div className="mt-0.5">{ev.overall_comment}</div>
            </div>
          </div>
        )}

        {/* Filter Bar + Color Legend */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-[var(--text-secondary)] mr-1" />
            {[
              { id: 'all', label: `Tất cả (${detail.items.length})` },
              { id: 'incomplete', label: `Chưa chấm (${incompleteCount})` },
              { id: 'needs_evidence', label: `Cần bổ sung (${needsEvidenceCount})` },
              { id: 'adjusted', label: 'Có điều chỉnh điểm' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterMode(f.id as typeof filterMode)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                  filterMode === f.id
                    ? 'bg-[#005baa] text-white'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* 5 Required Color Indicators Legend */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600" /> Tự đánh giá
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Điểm Đoàn xã chấm
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Chưa chấm
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Cần bổ sung
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Đã xác nhận
            </span>
          </div>
        </div>
      </div>

      {/* Main Structured Scoring Table */}
      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse min-w-[920px]">
            <thead>
              <tr className="bg-[#005baa] text-white text-xs uppercase tracking-wider">
                <th className="py-3 px-3 font-semibold w-14 text-center">STT</th>
                <th className="py-3 px-3 font-semibold w-24">Mã tiêu chí</th>
                <th className="py-3 px-3 font-semibold">Nội dung đánh giá</th>
                <th className="py-3 px-3 font-semibold w-24 text-center">Điểm tối đa</th>
                <th className="py-3 px-3 font-semibold w-28 text-center">Điểm tự chấm</th>
                <th className="py-3 px-3 font-semibold w-32 text-center">Điểm Đoàn xã chấm</th>
                <th className="py-3 px-3 font-semibold w-28 text-center">Minh chứng</th>
                <th className="py-3 px-3 font-semibold w-48">Nhận xét</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {detail.groups.map((group) => {
                const groupItems = detail.items.filter((it) => {
                  if (it.group_id !== group.id) return false;
                  const sDraft = selfDrafts[it.id];
                  const rDraft = reviewDrafts[it.id];
                  const sc = scoreMap.get(it.id);
                  if (filterMode === 'incomplete') return !sDraft || sDraft.self_score === '';
                  if (filterMode === 'needs_evidence') return Boolean(sc?.needs_evidence || rDraft?.needs_evidence);
                  if (filterMode === 'adjusted') {
                    return (
                      sc?.self_score !== null &&
                      sc?.self_score !== undefined &&
                      sc?.review_score !== null &&
                      sc?.review_score !== undefined &&
                      sc.self_score !== sc.review_score
                    );
                  }
                  return true;
                });

                if (groupItems.length === 0) return null;

                const groupSelfSum = groupItems.reduce((acc, it) => {
                  const v = selfDrafts[it.id]?.self_score;
                  return acc + (v !== '' && v !== undefined ? Number(v) || 0 : 0);
                }, 0);
                const groupReviewSum = groupItems.reduce((acc, it) => {
                  const v = reviewDrafts[it.id]?.review_score;
                  return acc + (v !== '' && v !== undefined ? Number(v) || 0 : 0);
                }, 0);

                return (
                  <React.Fragment key={group.id}>
                    {/* Group Header Row */}
                    <tr className="bg-[var(--bg-subtle)]">
                      <td colSpan={3} className="py-2.5 px-3 font-bold text-xs sm:text-sm text-[#005baa] dark:text-sky-400">
                        <span className="mr-2">
                          {group.section_type === 'supplementary' ? '[BỔ SUNG]' : '[CỐ ĐỊNH]'} Nhóm {group.code}.
                        </span>
                        {group.title}
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-xs">{group.max_score}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-xs text-blue-700 dark:text-blue-300">
                        {formatScore(groupSelfSum)}
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-xs text-orange-700 dark:text-orange-300">
                        {ev.review_total !== null ? formatScore(groupReviewSum) : '—'}
                      </td>
                      <td colSpan={2} className="py-2.5 px-3 text-xs text-[var(--text-secondary)]">
                        {group.description}
                      </td>
                    </tr>

                    {/* Criteria Rows */}
                    {groupItems.map((item) => {
                      globalRowIndex += 1;
                      const expanded = expandedIds.has(item.id);
                      const sDraft = selfDrafts[item.id] ?? { self_score: '', explanation: '' };
                      const rDraft = reviewDrafts[item.id] ?? {
                        review_score: '',
                        adjustment_reason: '',
                        reviewer_comment: '',
                        needs_evidence: false,
                      };
                      const sc = scoreMap.get(item.id);
                      const files = evidenceByCrit.get(item.id) ?? [];
                      const hist = historyByCrit.get(item.id) ?? [];

                      const isUnscored = sDraft.self_score === '';
                      const needsEv = Boolean(sc?.needs_evidence || rDraft.needs_evidence);
                      const selfNum = sDraft.self_score === '' ? null : Number(sDraft.self_score);
                      const revNum = rDraft.review_score === '' ? null : Number(rDraft.review_score);
                      const isAdjusted = selfNum !== null && revNum !== null && selfNum !== revNum;

                      // Visual row accent
                      const rowBg = needsEv
                        ? 'bg-amber-50/70 dark:bg-amber-950/20'
                        : isCompleted
                          ? 'bg-emerald-50/25 dark:bg-emerald-950/10'
                          : isUnscored
                            ? 'bg-slate-50/50 dark:bg-slate-900/20'
                            : '';

                      return (
                        <React.Fragment key={item.id}>
                          <tr className={`${rowBg} hover:bg-[var(--bg-subtle)]/50 transition align-top`}>
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => toggleExpand(item.id)}
                                className="inline-flex items-center gap-0.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[#005baa] cursor-pointer"
                                aria-expanded={expanded}
                                aria-label={`Mở rộng tiêu chí ${item.code}`}
                              >
                                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                {globalRowIndex}
                              </button>
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-block px-2 py-0.5 rounded font-mono text-xs font-bold ${
                                  needsEv
                                    ? 'bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200'
                                    : isCompleted
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                                      : isUnscored
                                        ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                                        : 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'
                                }`}
                              >
                                {item.code}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <button
                                type="button"
                                onClick={() => toggleExpand(item.id)}
                                className="text-left font-medium text-[var(--text-primary)] hover:text-[#005baa] cursor-pointer leading-snug"
                              >
                                {item.title}
                              </button>
                              {needsEv && (
                                <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-[11px] font-semibold">
                                  <AlertTriangle className="w-3 h-3" /> Cần bổ sung minh chứng
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-[var(--text-primary)]">
                              {item.max_score}
                            </td>

                            {/* Điểm tự chấm (Blue) */}
                            <td className="py-3 px-3 text-center">
                              {canSelfEdit ? (
                                <input
                                  type="number"
                                  min={0}
                                  max={item.max_score}
                                  step={0.5}
                                  aria-label={`Điểm tự chấm ${item.code}`}
                                  value={sDraft.self_score}
                                  onChange={(e) => handleSelfChange(item.id, { self_score: e.target.value }, item.max_score)}
                                  placeholder="—"
                                  className="w-20 text-center py-1 px-2 rounded-lg border-2 border-blue-300 dark:border-blue-700 bg-blue-50/70 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 font-bold text-sm"
                                />
                              ) : (
                                <span
                                  className={`inline-block min-w-12 px-2.5 py-1 rounded-lg font-bold text-sm ${
                                    isUnscored
                                      ? 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                                      : 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                                  }`}
                                >
                                  {isUnscored ? '—' : sDraft.self_score}
                                </span>
                              )}
                            </td>

                            {/* Điểm thẩm định (Orange / Green when confirmed) */}
                            <td className="py-3 px-3 text-center">
                              {canReviewEdit ? (
                                <div className="flex flex-col items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    max={item.max_score}
                                    step={0.5}
                                    aria-label={`Điểm Đoàn xã chấm ${item.code}`}
                                    value={rDraft.review_score}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setReviewDrafts((prev) => ({
                                        ...prev,
                                        [item.id]: { ...rDraft, review_score: val },
                                      }));
                                      if (val !== '' && selfNum !== null && Number(val) !== selfNum) {
                                        setExpandedIds((prev) => new Set(prev).add(item.id));
                                      }
                                    }}
                                    placeholder="—"
                                    className="w-20 text-center py-1 px-2 rounded-lg border-2 border-orange-300 dark:border-orange-700 bg-orange-50/70 dark:bg-orange-950/40 text-orange-800 dark:text-orange-200 font-bold text-sm"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSaveReview(item.id, item.max_score)}
                                    disabled={savingReviewId === item.id}
                                    className="text-[11px] font-semibold text-orange-700 dark:text-orange-300 hover:underline cursor-pointer"
                                  >
                                    {savingReviewId === item.id ? 'Đang lưu...' : 'Lưu điểm'}
                                  </button>
                                </div>
                              ) : (
                                <span
                                  className={`inline-block min-w-12 px-2.5 py-1 rounded-lg font-bold text-sm ${
                                    rDraft.review_score === ''
                                      ? 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                                      : isCompleted
                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                        : 'bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300'
                                  }`}
                                >
                                  {rDraft.review_score === '' ? '—' : rDraft.review_score}
                                </span>
                              )}
                            </td>

                            {/* Minh chứng */}
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => toggleExpand(item.id)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                                  files.length > 0
                                    ? 'bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-950/40 dark:border-sky-800 dark:text-sky-300'
                                    : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700'
                                }`}
                              >
                                <Paperclip className="w-3.5 h-3.5" />
                                {files.length} tệp
                              </button>
                            </td>

                            {/* Nhận xét */}
                            <td className="py-3 px-3 text-xs text-[var(--text-secondary)]">
                              {rDraft.reviewer_comment ? (
                                <div className="line-clamp-2">{rDraft.reviewer_comment}</div>
                              ) : isAdjusted && rDraft.adjustment_reason ? (
                                <div className="text-orange-700 dark:text-orange-300 line-clamp-2">
                                  Lý do: {rDraft.adjustment_reason}
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">Chưa có nhận xét</span>
                              )}
                            </td>
                          </tr>

                          {/* Expanded Criterion Details Drawer */}
                          {expanded && (
                            <tr className="bg-[var(--bg-canvas)]/80">
                              <td colSpan={8} className="p-4 sm:p-5">
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                                  {/* Left Column: Guide + Round 1 Explanation + Evidence */}
                                  <div className="lg:col-span-7 space-y-4">
                                    <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs space-y-1.5">
                                      <div>
                                        <span className="font-bold text-[#005baa] dark:text-sky-400">Hướng dẫn chấm điểm: </span>
                                        <span>{item.scoring_guide || 'Theo quy định chung của Đoàn xã Tân Nhựt.'}</span>
                                      </div>
                                      <div>
                                        <span className="font-bold text-[#005baa] dark:text-sky-400">Yêu cầu minh chứng: </span>
                                        <span>{item.evidence_requirement || 'Biên bản, hình ảnh hoặc báo cáo đính kèm.'}</span>
                                      </div>
                                    </div>

                                    {/* Round 1 Explanation */}
                                    <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2">
                                      <label className="block text-xs font-bold text-blue-700 dark:text-blue-300 uppercase">
                                        Giải trình tự đánh giá (Vòng 1 – Cơ sở Đoàn)
                                      </label>
                                      {canSelfEdit ? (
                                        <textarea
                                          rows={3}
                                          value={sDraft.explanation}
                                          onChange={(e) =>
                                            handleSelfChange(item.id, { explanation: e.target.value }, item.max_score)
                                          }
                                          placeholder="Nhập nội dung giải trình kết quả thực hiện tiêu chí của đơn vị..."
                                          className="w-full p-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-xs sm:text-sm"
                                        />
                                      ) : (
                                        <p className="text-xs sm:text-sm text-[var(--text-primary)] whitespace-pre-wrap">
                                          {sDraft.explanation || <span className="italic text-slate-400">Chưa có giải trình.</span>}
                                        </p>
                                      )}
                                    </div>

                                    {/* Evidence Files */}
                                    <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs font-bold uppercase text-[var(--text-primary)] flex items-center gap-1.5">
                                          <Paperclip className="w-3.5 h-3.5 text-[#005baa]" />
                                          Hồ sơ minh chứng ({files.length})
                                        </div>
                                        {(canSelfEdit || user.role === 'admin') && !isCompleted && (
                                          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-xs font-semibold cursor-pointer transition">
                                            <Upload className="w-3.5 h-3.5" />
                                            {uploadingCritId === item.id ? 'Đang tải lên...' : 'Tải minh chứng'}
                                            <input
                                              type="file"
                                              className="hidden"
                                              accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx"
                                              disabled={uploadingCritId === item.id}
                                              onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) handleUploadEvidence(item.id, f);
                                                e.target.value = '';
                                              }}
                                            />
                                          </label>
                                        )}
                                      </div>

                                      {files.length === 0 ? (
                                        <div className="text-xs text-[var(--text-secondary)] italic">
                                          Chưa có tệp minh chứng đính kèm (Hỗ trợ Ảnh PNG/JPG/WEBP, PDF, Word, Excel – tối đa 15MB).
                                        </div>
                                      ) : (
                                        <ul className="space-y-1.5">
                                          {files.map((f) => (
                                            <li
                                              key={f.id}
                                              className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--bg-subtle)] text-xs"
                                            >
                                              <div className="flex items-center gap-2 min-w-0">
                                                <FileText className="w-4 h-4 text-[#005baa] shrink-0" />
                                                <div className="min-w-0">
                                                  <a
                                                    href={`/api/evidence/${f.id}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="font-medium hover:underline truncate block"
                                                  >
                                                    {f.original_name}
                                                  </a>
                                                  <div className="text-[11px] text-[var(--text-secondary)]">
                                                    {formatFileSize(f.size_bytes)} • {formatDateTime(f.uploaded_at)}
                                                  </div>
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-1 shrink-0">
                                                <a
                                                  href={`/api/evidence/${f.id}?download=1`}
                                                  className="p-1.5 rounded hover:bg-white/60 dark:hover:bg-slate-700 text-sky-700 dark:text-sky-300"
                                                  title="Tải xuống"
                                                >
                                                  <Download className="w-3.5 h-3.5" />
                                                </a>
                                                {(canSelfEdit || user.role === 'admin') && !isCompleted && (
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDeleteEvidence(f.id)}
                                                    className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 cursor-pointer"
                                                    title="Xóa tệp"
                                                  >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                  </button>
                                                )}
                                              </div>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  </div>

                                  {/* Right Column: Round 2 Appraisal + Score History */}
                                  <div className="lg:col-span-5 space-y-4">
                                    <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-orange-200 dark:border-orange-900/60 space-y-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold uppercase text-orange-700 dark:text-orange-300">
                                          Thẩm định của Đoàn xã (Vòng 2)
                                        </span>
                                        {canReviewEdit && selfNum !== null && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setReviewDrafts((prev) => ({
                                                ...prev,
                                                [item.id]: {
                                                  ...rDraft,
                                                  review_score: String(selfNum),
                                                  adjustment_reason: '',
                                                },
                                              }))
                                            }
                                            className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 cursor-pointer"
                                          >
                                            Giữ nguyên ({selfNum})
                                          </button>
                                        )}
                                      </div>

                                      {canReviewEdit ? (
                                        <div className="space-y-2.5 text-xs">
                                          {isAdjusted && (
                                            <div>
                                              <label className="block font-semibold text-red-700 dark:text-red-400 mb-1">
                                                Lý do điều chỉnh điểm (Bắt buộc) *
                                              </label>
                                              <input
                                                type="text"
                                                value={rDraft.adjustment_reason}
                                                onChange={(e) =>
                                                  setReviewDrafts((prev) => ({
                                                    ...prev,
                                                    [item.id]: { ...rDraft, adjustment_reason: e.target.value },
                                                  }))
                                                }
                                                placeholder="Ghi rõ lý do tăng/giảm điểm so với tự chấm..."
                                                className="w-full px-2.5 py-1.5 rounded-lg border border-red-300 dark:border-red-700 bg-[var(--bg-surface)]"
                                              />
                                            </div>
                                          )}

                                          <div>
                                            <label className="block font-semibold mb-1">Nhận xét theo tiêu chí</label>
                                            <textarea
                                              rows={2}
                                              value={rDraft.reviewer_comment}
                                              onChange={(e) =>
                                                setReviewDrafts((prev) => ({
                                                  ...prev,
                                                  [item.id]: { ...rDraft, reviewer_comment: e.target.value },
                                                }))
                                              }
                                              placeholder="Nhận xét, góp ý hoặc hướng dẫn hoàn thiện..."
                                              className="w-full p-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                                            />
                                          </div>

                                          <label className="flex items-center gap-2 cursor-pointer font-medium text-amber-800 dark:text-amber-300">
                                            <input
                                              type="checkbox"
                                              checked={rDraft.needs_evidence}
                                              onChange={(e) =>
                                                setReviewDrafts((prev) => ({
                                                  ...prev,
                                                  [item.id]: { ...rDraft, needs_evidence: e.target.checked },
                                                }))
                                              }
                                              className="rounded"
                                            />
                                            Yêu cầu đơn vị bổ sung minh chứng cho tiêu chí này
                                          </label>

                                          <button
                                            type="button"
                                            onClick={() => handleSaveReview(item.id, item.max_score)}
                                            disabled={savingReviewId === item.id}
                                            className="w-full py-2 px-3 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                                          >
                                            <Save className="w-3.5 h-3.5" />
                                            {savingReviewId === item.id ? 'Đang lưu...' : 'Lưu thẩm định tiêu chí này'}
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="space-y-1.5 text-xs">
                                          <div>
                                            <span className="text-[var(--text-secondary)]">Điểm Đoàn xã chấm: </span>
                                            <strong className="text-orange-700 dark:text-orange-300">
                                              {rDraft.review_score !== '' ? `${rDraft.review_score} / ${item.max_score}` : 'Chưa thẩm định'}
                                            </strong>
                                          </div>
                                          {rDraft.adjustment_reason && (
                                            <div>
                                              <span className="text-[var(--text-secondary)]">Lý do điều chỉnh: </span>
                                              <span className="font-medium text-red-700 dark:text-red-400">
                                                {rDraft.adjustment_reason}
                                              </span>
                                            </div>
                                          )}
                                          <div>
                                            <span className="text-[var(--text-secondary)]">Nhận xét: </span>
                                            <span>{rDraft.reviewer_comment || '—'}</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Per-Criterion Score History */}
                                    <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2">
                                      <div className="text-xs font-bold uppercase flex items-center gap-1.5">
                                        <History className="w-3.5 h-3.5 text-[#005baa]" />
                                        Lịch sử thay đổi điểm ({hist.length})
                                      </div>
                                      {hist.length === 0 ? (
                                        <div className="text-xs text-[var(--text-secondary)] italic">Chưa có lịch sử chấm điểm.</div>
                                      ) : (
                                        <ul className="space-y-2 max-h-44 overflow-y-auto pr-1">
                                          {hist.map((h) => (
                                            <li key={h.id} className="text-xs p-2 rounded-lg bg-[var(--bg-subtle)] space-y-0.5">
                                              <div className="flex items-center justify-between gap-2">
                                                <span className={`font-bold ${h.round === 'self' ? 'text-blue-700 dark:text-blue-300' : 'text-orange-700 dark:text-orange-300'}`}>
                                                  {h.round === 'self' ? 'Vòng 1' : 'Vòng 2'}: {formatScore(h.old_score)} → {formatScore(h.new_score)}
                                                </span>
                                                <span className="text-[10px] text-[var(--text-secondary)]">
                                                  {formatDateTime(h.created_at)}
                                                </span>
                                              </div>
                                              <div className="text-[11px] text-[var(--text-primary)]">{h.reason}</div>
                                              <div className="text-[10px] text-[var(--text-secondary)]">
                                                Người thao tác: {h.actor_name} ({ROLE_LABELS[h.actor_role] ?? h.actor_role})
                                              </div>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Footer Bar */}
      <div className="card-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
        <div className="text-xs text-[var(--text-secondary)]">
          {incompleteCount > 0 ? (
            <span className="text-amber-700 dark:text-amber-400 font-semibold">
              Còn {incompleteCount} tiêu chí chưa nhập điểm tự đánh giá.
            </span>
          ) : (
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
              Đã nhập đầy đủ điểm tự đánh giá cho tất cả {detail.items.length} tiêu chí hiệu lực.
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Round 1 Actions */}
          {canSelfEdit && (
            <>
              <button
                type="button"
                onClick={() => setFilterMode(filterMode === 'incomplete' ? 'all' : 'incomplete')}
                className="px-3.5 py-2 rounded-lg border border-[var(--border-color)] text-xs font-semibold hover:bg-[var(--bg-subtle)] cursor-pointer"
              >
                {filterMode === 'incomplete' ? 'Hiện tất cả tiêu chí' : `Kiểm tra chưa hoàn thành (${incompleteCount})`}
              </button>
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-xs sm:text-sm font-semibold transition cursor-pointer"
              >
                <Send className="w-4 h-4" />
                Gửi hồ sơ về Đoàn xã
              </button>
            </>
          )}

          {/* Round 2 Actions */}
          {canReviewEdit && (
            <>
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleKeepAllSelf}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 text-xs font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                Giữ nguyên điểm tự chấm
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setShowReturnModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Trả hồ sơ bổ sung
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setShowConfirmModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                Xác nhận kết quả chính thức
              </button>
            </>
          )}
        </div>
      </div>

      {/* Modal: Submit Dossier */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="card-surface max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold">Xác nhận gửi hồ sơ về Đoàn xã?</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Tổng điểm tự đánh giá hiện tại của <strong>{ev.unit_name}</strong> là{' '}
              <strong className="text-blue-700 dark:text-blue-300">
                {formatScore(ev.self_total)}/{ev.active_max_score}
              </strong>
              . Sau khi gửi, hệ thống sẽ ghi nhận thời gian và <strong>khóa chỉnh sửa</strong> cho đến khi Đoàn xã phản hồi hoặc trả hồ sơ.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm font-medium cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleSubmitDossier}
                className="px-4 py-2 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-sm font-semibold cursor-pointer"
              >
                {actionBusy ? 'Đang gửi...' : 'Xác nhận gửi hồ sơ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Return Dossier */}
      {showReturnModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="card-surface max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold">Trả hồ sơ về Cơ sở Đoàn</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Hồ sơ của <strong>{ev.unit_name}</strong> sẽ được mở khóa để đơn vị bổ sung minh chứng và hoàn thiện lại.
            </p>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Nội dung yêu cầu bổ sung *</label>
              <textarea
                rows={4}
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                placeholder="Nêu rõ các tiêu chí cần bổ sung minh chứng hoặc giải trình lại..."
                className="w-full p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReturnModal(false)}
                className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm font-medium cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleReturnDossier}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold cursor-pointer"
              >
                {actionBusy ? 'Đang xử lý...' : 'Xác nhận trả hồ sơ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Official Result */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="card-surface max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold">Xác nhận kết quả thẩm định chính thức</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Điểm Đoàn xã chấm của <strong>{ev.unit_name}</strong> là{' '}
              <strong className="text-emerald-700 dark:text-emerald-300">
                {formatScore(ev.review_total)}/{ev.active_max_score}
              </strong>
              . Sau khi xác nhận, kết quả sẽ được chốt chính thức và đưa vào bảng xếp hạng toàn xã.
            </p>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Nhận xét chung của Đoàn xã (Tùy chọn)</label>
              <textarea
                rows={3}
                value={overallComment}
                onChange={(e) => setOverallComment(e.target.value)}
                placeholder="Ghi nhận kết quả nổi bật và định hướng khắc phục..."
                className="w-full p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm font-medium cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleConfirmOfficial}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer"
              >
                {actionBusy ? 'Đang xác nhận...' : 'Chốt kết quả chính thức'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

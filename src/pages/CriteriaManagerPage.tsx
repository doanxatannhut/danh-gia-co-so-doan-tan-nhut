import React, { useEffect, useState } from 'react';
import {
  Plus,
  Copy,
  CheckCircle2,
  Archive,
  Trash2,
  Edit3,
  Lock,
  Sparkles,
  Layers,
  AlertCircle,
  X,
} from 'lucide-react';
import type {
  CriteriaGroup,
  CriteriaItem,
  PointSummary,
  ScorecardVersion,
} from '../types';
import { apiFetch, formatDateTime } from '../utils/api';

interface CriteriaManagerPageProps {
  versions: ScorecardVersion[];
  selectedVersionId: number | null;
  onSelectVersion: (id: number) => void;
  onVersionsChanged: () => void;
}

interface VersionDetailResponse {
  version: ScorecardVersion;
  points: PointSummary;
  activeEvaluations: number;
  groups: CriteriaGroup[];
  items: CriteriaItem[];
}

export const CriteriaManagerPage: React.FC<CriteriaManagerPageProps> = ({
  versions,
  selectedVersionId,
  onSelectVersion,
  onVersionsChanged,
}) => {
  const [detail, setDetail] = useState<VersionDetailResponse | null>(null);
  const [sectionTab, setSectionTab] = useState<'fixed' | 'supplementary'>('fixed');
  const [loading, setLoading] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Modals
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [newVerForm, setNewVerForm] = useState({ title: '', year: new Date().getFullYear(), period: `Đợt tổng kết năm ${new Date().getFullYear()}` });

  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneForm, setCloneForm] = useState({
    year: 2027,
    period: 'Đợt tổng kết năm 2027',
    title: '',
    includeSupplementary: false,
  });

  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupForm, setGroupForm] = useState({ code: '', title: '', description: '' });

  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CriteriaItem | null>(null);
  const [itemForm, setItemForm] = useState({
    group_id: 0,
    code: '',
    title: '',
    scoring_guide: '',
    evidence_requirement: '',
    max_score: '5',
  });

  async function loadDetail(id: number) {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<VersionDetailResponse>(`/api/scorecards/${id}`);
      setDetail(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải bộ tiêu chí.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedVersionId) {
      loadDetail(selectedVersionId);
    } else {
      setDetail(null);
    }
  }, [selectedVersionId]);

  async function handleDeleteVersion(v: ScorecardVersion) {
    if (!window.confirm(`Xóa vĩnh viễn phiên bản bảng điểm "${v.title}" (${v.code})?`)) return;
    setError('');
    try {
      await apiFetch(`/api/scorecards/${v.id}`, { method: 'DELETE' });
      onVersionsChanged();
      if (selectedVersionId === v.id) {
        const remaining = versions.filter((item) => item.id !== v.id);
        if (remaining[0]) onSelectVersion(remaining[0].id);
        else setDetail(null);
      }
      showToastMsg(`Đã xóa phiên bản bảng điểm ${v.code}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa phiên bản bảng điểm.');
    }
  }

  function showToastMsg(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3500);
  }

  async function handleCreateVersion(e: React.FormEvent) {
    e.preventDefault();
    if (creatingVersion) return;
    setError('');
    setCreatingVersion(true);
    try {
      const res = await apiFetch<{ version: ScorecardVersion }>('/api/scorecards', {
        method: 'POST',
        body: JSON.stringify(newVerForm),
      });
      setShowNewVersion(false);
      setNewVerForm({ title: '', year: new Date().getFullYear(), period: `Đợt tổng kết năm ${new Date().getFullYear()}` });
      onSelectVersion(res.version.id);
      onVersionsChanged();
      showToastMsg(`Đã tạo phiên bản bảng điểm mới (${res.version.code}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tạo phiên bản bảng điểm.');
    } finally {
      setCreatingVersion(false);
    }
  }

  async function handleCloneVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setError('');
    try {
      const res = await apiFetch<{ version: ScorecardVersion }>(`/api/scorecards/${detail.version.id}/clone`, {
        method: 'POST',
        body: JSON.stringify(cloneForm),
      });
      setShowCloneModal(false);
      onVersionsChanged();
      onSelectVersion(res.version.id);
      showToastMsg('Đã sao chép bộ tiêu chí sang phiên bản mới.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi sao chép bộ tiêu chí.');
    }
  }

  async function handleStatusChange(status: 'published' | 'archived' | 'draft') {
    if (!detail) return;
    setError('');
    try {
      await apiFetch(`/api/scorecards/${detail.version.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadDetail(detail.version.id);
      onVersionsChanged();
      showToastMsg(
        status === 'published'
          ? 'Đã công bố phiên bản bảng điểm để áp dụng cho các Cơ sở Đoàn.'
          : 'Đã cập nhật trạng thái phiên bản bảng điểm.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đổi trạng thái.');
    }
  }

  async function handlePublishSupplementary() {
    if (!detail) return;
    setError('');
    try {
      await apiFetch(`/api/scorecards/${detail.version.id}/publish-supplementary`, {
        method: 'POST',
      });
      await loadDetail(detail.version.id);
      onVersionsChanged();
      showToastMsg('Đã công bố bộ tiêu chí bổ sung! Thang điểm hiệu lực đã được cập nhật.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể công bố bộ tiêu chí bổ sung.');
    }
  }

  async function handleAddGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setError('');
    try {
      await apiFetch(`/api/scorecards/${detail.version.id}/groups`, {
        method: 'POST',
        body: JSON.stringify({
          ...groupForm,
          section_type: sectionTab,
          max_score: 0,
        }),
      });
      setShowGroupModal(false);
      setGroupForm({ code: '', title: '', description: '' });
      await loadDetail(detail.version.id);
      showToastMsg('Đã thêm nhóm tiêu chí mới.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể thêm nhóm tiêu chí.');
    }
  }

  async function handleDeleteGroup(groupId: number) {
    if (!detail || !window.confirm('Xóa nhóm tiêu chí này và toàn bộ tiêu chí con bên trong?')) return;
    setError('');
    try {
      await apiFetch(`/api/scorecards/${detail.version.id}/groups/${groupId}`, { method: 'DELETE' });
      await loadDetail(detail.version.id);
      showToastMsg('Đã xóa nhóm tiêu chí.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa nhóm.');
    }
  }

  function openNewItemModal(groupId: number) {
    setEditingItem(null);
    setItemForm({
      group_id: groupId,
      code: sectionTab === 'supplementary' ? 'BS-1.1' : 'TC-5.1',
      title: '',
      scoring_guide: '',
      evidence_requirement: '',
      max_score: '5',
    });
    setShowItemModal(true);
  }

  function openEditItemModal(item: CriteriaItem) {
    setEditingItem(item);
    setItemForm({
      group_id: item.group_id,
      code: item.code,
      title: item.title,
      scoring_guide: item.scoring_guide,
      evidence_requirement: item.evidence_requirement,
      max_score: String(item.max_score),
    });
    setShowItemModal(true);
  }

  async function handleSaveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setError('');
    try {
      const payload = {
        group_id: itemForm.group_id,
        code: itemForm.code,
        title: itemForm.title,
        scoring_guide: itemForm.scoring_guide,
        evidence_requirement: itemForm.evidence_requirement,
        max_score: Number(itemForm.max_score),
      };
      if (editingItem) {
        await apiFetch(`/api/scorecards/${detail.version.id}/items/${editingItem.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToastMsg('Đã cập nhật tiêu chí.');
      } else {
        await apiFetch(`/api/scorecards/${detail.version.id}/items`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToastMsg('Đã thêm tiêu chí mới.');
      }
      setShowItemModal(false);
      await loadDetail(detail.version.id);
      onVersionsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu tiêu chí.');
    }
  }

  async function handleDeleteItem(itemId: number) {
    if (!detail || !window.confirm('Xóa tiêu chí này khỏi bảng điểm?')) return;
    setError('');
    try {
      await apiFetch(`/api/scorecards/${detail.version.id}/items/${itemId}`, { method: 'DELETE' });
      await loadDetail(detail.version.id);
      onVersionsChanged();
      showToastMsg('Đã xóa tiêu chí.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa tiêu chí.');
    }
  }

  if (loading && !detail) {
    return <div className="card-surface p-10 text-center text-sm text-[var(--text-secondary)]">Đang tải bộ tiêu chí...</div>;
  }
  if (!detail) {
    return (
      <div className="space-y-4">
        {error && (
          <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} className="cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
        )}
        <div className="card-surface p-10 text-center space-y-4">
          <AlertCircle className="w-10 h-10 mx-auto text-[#005baa]" />
          <div className="text-lg font-bold">Chưa có phiên bản bảng điểm nào</div>
          <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto">
            Hãy tạo phiên bản bảng điểm mới để thiết lập bộ 60 điểm cố định và 40 điểm bổ sung cho các Cơ sở Đoàn xã Tân Nhựt.
          </p>
          <button
            type="button"
            onClick={() => setShowNewVersion(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-sm font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Tạo phiên bản bảng điểm mới
          </button>
        </div>

        {showNewVersion && (
          <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <form onSubmit={handleCreateVersion} className="card-surface max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold">Tạo phiên bản bảng điểm mới</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <label className="block font-medium mb-1">Tên bảng điểm *</label>
                  <input
                    required
                    value={newVerForm.title}
                    onChange={(e) => setNewVerForm({ ...newVerForm, title: e.target.value })}
                    placeholder="Ví dụ: Bảng điểm đánh giá Cơ sở Đoàn năm 2026"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium mb-1">Năm *</label>
                    <input
                      type="number"
                      required
                      value={newVerForm.year}
                      onChange={(e) => setNewVerForm({ ...newVerForm, year: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                    />
                  </div>
                  <div>
                    <label className="block font-medium mb-1">Đợt đánh giá *</label>
                    <input
                      required
                      value={newVerForm.period}
                      onChange={(e) => setNewVerForm({ ...newVerForm, period: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowNewVersion(false)} className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm cursor-pointer">Hủy</button>
                <button type="submit" disabled={creatingVersion} className="px-4 py-2 rounded-lg bg-[#005baa] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer">
                  {creatingVersion ? 'Đang tạo...' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  const { version, points, activeEvaluations, groups, items } = detail;
  const filteredGroups = groups.filter((g) => g.section_type === sectionTab);

  const isSectionLocked =
    version.status === 'archived' ||
    (activeEvaluations > 0 && (sectionTab === 'fixed' || version.supplementary_published));

  return (
    <div className="space-y-5">
      {/* Header & Version Controls */}
      <div className="card-surface p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-[#005baa] dark:text-sky-300 font-mono text-xs font-bold">
                {version.code}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  version.status === 'published'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                    : version.status === 'archived'
                      ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
                }`}
              >
                {version.status === 'published'
                  ? 'Đang áp dụng'
                  : version.status === 'archived'
                    ? 'Ngừng áp dụng (Lưu trữ)'
                    : 'Bản nháp'}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                • {activeEvaluations} hồ sơ đang đánh giá
              </span>
            </div>
            <h1 className="text-xl font-bold mt-1">{version.title}</h1>
            <p className="text-xs text-[var(--text-secondary)]">
              Năm {version.year} • {version.period} • Công bố: {formatDateTime(version.published_at)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNewVersion(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-color)] text-xs font-semibold hover:bg-[var(--bg-subtle)] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Tạo phiên bản mới
            </button>
            <button
              type="button"
              onClick={() => {
                setCloneForm({
                  year: version.year + 1,
                  period: `Đợt tổng kết năm ${version.year + 1}`,
                  title: `Bảng điểm đánh giá Cơ sở Đoàn năm ${version.year + 1}`,
                  includeSupplementary: false,
                });
                setShowCloneModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#005baa] text-[#005baa] dark:text-sky-400 dark:border-sky-500 text-xs font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" /> Sao chép sang năm/phiên bản mới
            </button>
            {version.status === 'draft' && (
              <button
                type="button"
                onClick={() => handleStatusChange('published')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Công bố phiên bản
              </button>
            )}
            {version.status === 'published' && (
              <button
                type="button"
                onClick={() => handleStatusChange('archived')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-600 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" /> Ngừng áp dụng
              </button>
            )}
          </div>
        </div>

        {/* 60 / 40 / 100 Budget Meters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-[var(--border-subtle)]">
          <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between text-xs font-semibold text-blue-800 dark:text-blue-300">
              <span>NHÓM CỐ ĐỊNH (TỐI ĐA 60)</span>
              <span>{points.fixedMax} / 60 điểm</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-blue-200 dark:bg-blue-900 overflow-hidden">
              <div className="h-full bg-[#005baa] rounded-full" style={{ width: `${Math.min(100, (points.fixedMax / 60) * 100)}%` }} />
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] mt-1.5">
              Còn trống: <strong>{Math.max(0, 60 - points.fixedMax)} điểm</strong>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-900 dark:text-amber-300">
              <span>NHÓM BỔ SUNG (TỐI ĐA 40)</span>
              <span>{points.supplementaryConfiguredMax} / 40 điểm</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-amber-200 dark:bg-amber-900 overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full"
                style={{ width: `${Math.min(100, (points.supplementaryConfiguredMax / 40) * 100)}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
              <span className="text-[var(--text-secondary)]">
                {points.supplementaryPublished ? (
                  <strong className="text-emerald-700 dark:text-emerald-400">Đã công bố áp dụng</strong>
                ) : (
                  <span>Chưa công bố (không tính 0 điểm)</span>
                )}
              </span>
              {!points.supplementaryPublished && points.supplementaryConfiguredMax > 0 && version.status !== 'archived' && (
                <button
                  type="button"
                  onClick={handlePublishSupplementary}
                  className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
                >
                  Công bố 40đ
                </button>
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-900 dark:text-emerald-300">
              <span>THANG ĐIỂM HIỆU LỰC</span>
              <span>{points.activeMaxScore} / 100 điểm</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-emerald-200 dark:bg-emerald-900 overflow-hidden">
              <div
                className="h-full bg-emerald-600 rounded-full"
                style={{ width: `${Math.min(100, points.activeMaxScore)}%` }}
              />
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] mt-1.5">
              Tổng thiết lập: <strong>{points.fixedMax + points.supplementaryConfiguredMax}/100</strong>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}
      {toast && (
        <div role="status" className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm font-medium">
          {toast}
        </div>
      )}

      {/* Section Tabs: 60 Fixed vs 40 Supplementary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={() => setSectionTab('fixed')}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer flex items-center gap-2 ${
              sectionTab === 'fixed' ? 'bg-[#005baa] text-white' : 'text-[var(--text-secondary)]'
            }`}
          >
            <Layers className="w-4 h-4" />
            60 điểm cố định ({points.fixedMax}/60)
          </button>
          <button
            type="button"
            onClick={() => setSectionTab('supplementary')}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer flex items-center gap-2 ${
              sectionTab === 'supplementary' ? 'bg-amber-500 text-white' : 'text-[var(--text-secondary)]'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            40 điểm bổ sung ({points.supplementaryConfiguredMax}/40)
          </button>
        </div>

        {!isSectionLocked && (
          <button
            type="button"
            onClick={() => {
              setGroupForm({
                code: sectionTab === 'supplementary' ? `BS-${filteredGroups.length + 1}` : `N-${filteredGroups.length + 1}`,
                title: '',
                description: '',
              });
              setShowGroupModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-xs sm:text-sm font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Thêm nhóm tiêu chí {sectionTab === 'supplementary' ? 'bổ sung' : 'cố định'}
          </button>
        )}
      </div>

      {/* Immutability Guard Warning */}
      {isSectionLocked && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs sm:text-sm flex items-center gap-2.5">
          <Lock className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            {version.status === 'archived'
              ? 'Phiên bản này đã ngừng áp dụng và chỉ để tra cứu. Hãy sao chép sang phiên bản mới để chỉnh sửa.'
              : `Phiên bản này đã có ${activeEvaluations} hồ sơ đang đánh giá nên bộ tiêu chí này đã được khóa bảo vệ. Để điều chỉnh, vui lòng nhấn "Sao chép sang năm/phiên bản mới".`}
          </span>
        </div>
      )}

      {/* Groups & Criteria List */}
      {filteredGroups.length === 0 ? (
        <div className="card-surface p-10 text-center space-y-3">
          <AlertCircle className="w-10 h-10 mx-auto text-amber-500" />
          <div className="text-base font-bold">
            {sectionTab === 'supplementary'
              ? 'Phần 40 điểm bổ sung hiện đang để trống'
              : 'Chưa có nhóm tiêu chí cố định nào'}
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-lg mx-auto">
            {sectionTab === 'supplementary'
              ? 'Theo quy định, 40 điểm bổ sung ban đầu để trống và không bị tính 0 điểm. Quản trị viên Đoàn xã có thể thêm nhóm tiêu chí, phân bổ tối đa 40 điểm và chỉ áp dụng sau khi nhấn "Công bố 40đ".'
              : 'Hãy nhấn "Thêm nhóm tiêu chí cố định" để bắt đầu thiết lập bộ 60 điểm chuẩn.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => {
            const gItems = items.filter((i) => i.group_id === group.id);
            return (
              <div key={group.id} className="card-surface overflow-hidden">
                <div className="p-4 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-sm text-[#005baa] dark:text-sky-400">
                      Nhóm {group.code}. {group.title} ({group.max_score} điểm)
                    </div>
                    {group.description && (
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5">{group.description}</div>
                    )}
                  </div>
                  {!isSectionLocked && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openNewItemModal(group.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-xs font-semibold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Thêm tiêu chí con
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(group.id)}
                        className="p-1.5 rounded-lg text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50 cursor-pointer"
                        title="Xóa nhóm"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="divide-y divide-[var(--border-subtle)]">
                  {gItems.length === 0 ? (
                    <div className="p-4 text-xs text-[var(--text-secondary)] italic">
                      Nhóm này chưa có tiêu chí con nào.
                    </div>
                  ) : (
                    gItems.map((it) => (
                      <div key={it.id} className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-[#005baa] dark:text-sky-300 font-mono text-xs font-bold">
                              {it.code}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                              {it.max_score} điểm
                            </span>
                          </div>
                          <div className="font-semibold text-sm">{it.title}</div>
                          {it.scoring_guide && (
                            <div className="text-xs text-[var(--text-secondary)]">
                              <strong>Hướng dẫn chấm:</strong> {it.scoring_guide}
                            </div>
                          )}
                          {it.evidence_requirement && (
                            <div className="text-xs text-[var(--text-secondary)]">
                              <strong>Minh chứng:</strong> {it.evidence_requirement}
                            </div>
                          )}
                        </div>
                        {!isSectionLocked && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditItemModal(it)}
                              className="p-1.5 rounded-lg hover:bg-[var(--bg-subtle)] text-[#005baa] cursor-pointer"
                              title="Chỉnh sửa tiêu chí"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(it.id)}
                              className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/50 text-red-600 cursor-pointer"
                              title="Xóa tiêu chí"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Version History Table */}
      <div className="card-surface p-5 space-y-3">
        <h2 className="text-sm font-bold">Danh sách các phiên bản bảng điểm</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm text-left border-collapse">
            <thead>
              <tr className="bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-xs uppercase">
                <th className="py-2.5 px-3">Mã</th>
                <th className="py-2.5 px-3">Tên bảng điểm</th>
                <th className="py-2.5 px-3 text-center">Năm</th>
                <th className="py-2.5 px-3 text-center">Cố định / Bổ sung</th>
                <th className="py-2.5 px-3 text-center">Trạng thái</th>
                <th className="py-2.5 px-3 text-right">Chọn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {versions.map((v) => (
                <tr key={v.id} className={v.id === version.id ? 'bg-blue-50/60 dark:bg-blue-950/20' : ''}>
                  <td className="py-2.5 px-3 font-mono font-bold text-xs">{v.code}</td>
                  <td className="py-2.5 px-3 font-medium">{v.title}</td>
                  <td className="py-2.5 px-3 text-center">{v.year}</td>
                  <td className="py-2.5 px-3 text-center">
                    {v.points ? `${v.points.fixedMax}/60 • ${v.points.supplementaryConfiguredMax}/40` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {v.status === 'published' ? 'Đang áp dụng' : v.status === 'draft' ? 'Nháp' : 'Lưu trữ'}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectVersion(v.id)}
                        className="text-xs font-semibold text-[#005baa] dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        {v.id === version.id ? 'Đang xem' : 'Quản lý'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteVersion(v)}
                        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/50 text-red-600 cursor-pointer"
                        title="Xóa phiên bản bảng điểm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: New Version */}
      {showNewVersion && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form onSubmit={handleCreateVersion} className="card-surface max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold">Tạo phiên bản bảng điểm mới</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block font-medium mb-1">Tên bảng điểm *</label>
                <input
                  required
                  value={newVerForm.title}
                  onChange={(e) => setNewVerForm({ ...newVerForm, title: e.target.value })}
                  placeholder="Ví dụ: Bảng điểm đánh giá Cơ sở Đoàn năm 2027"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Năm *</label>
                  <input
                    type="number"
                    required
                    value={newVerForm.year}
                    onChange={(e) => setNewVerForm({ ...newVerForm, year: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Đợt đánh giá *</label>
                  <input
                    required
                    value={newVerForm.period}
                    onChange={(e) => setNewVerForm({ ...newVerForm, period: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewVersion(false)} className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm cursor-pointer">Hủy</button>
              <button type="submit" disabled={creatingVersion} className="px-4 py-2 rounded-lg bg-[#005baa] text-white text-sm font-semibold disabled:opacity-60 cursor-pointer">
                {creatingVersion ? 'Đang tạo...' : 'Tạo mới'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Clone Version */}
      {showCloneModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form onSubmit={handleCloneVersion} className="card-surface max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold">Sao chép bộ tiêu chí sang phiên bản mới</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block font-medium mb-1">Tên phiên bản mới *</label>
                <input
                  required
                  value={cloneForm.title}
                  onChange={(e) => setCloneForm({ ...cloneForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Năm áp dụng *</label>
                  <input
                    type="number"
                    required
                    value={cloneForm.year}
                    onChange={(e) => setCloneForm({ ...cloneForm, year: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Đợt đánh giá *</label>
                  <input
                    required
                    value={cloneForm.period}
                    onChange={(e) => setCloneForm({ ...cloneForm, period: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={cloneForm.includeSupplementary}
                  onChange={(e) => setCloneForm({ ...cloneForm, includeSupplementary: e.target.checked })}
                />
                Sao chép kèm cả phần tiêu chí bổ sung (mặc định để trống 40 điểm bổ sung)
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCloneModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm cursor-pointer">Hủy</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#005baa] text-white text-sm font-semibold cursor-pointer">Sao chép</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Add Group */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form onSubmit={handleAddGroup} className="card-surface max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold">
              Thêm nhóm tiêu chí ({sectionTab === 'supplementary' ? '40 điểm bổ sung' : '60 điểm cố định'})
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block font-medium mb-1">Mã nhóm *</label>
                <input
                  required
                  value={groupForm.code}
                  onChange={(e) => setGroupForm({ ...groupForm, code: e.target.value })}
                  placeholder="Ví dụ: BS-I hoặc V"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Tên nhóm tiêu chí *</label>
                <input
                  required
                  value={groupForm.title}
                  onChange={(e) => setGroupForm({ ...groupForm, title: e.target.value })}
                  placeholder="Ví dụ: Nhiệm vụ trọng tâm Chuyển đổi số năm 2026"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Mô tả ngắn</label>
                <textarea
                  rows={2}
                  value={groupForm.description}
                  onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowGroupModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm cursor-pointer">Hủy</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#005baa] text-white text-sm font-semibold cursor-pointer">Lưu nhóm</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Add / Edit Criterion Item */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form onSubmit={handleSaveItem} className="card-surface max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold">
              {editingItem ? `Chỉnh sửa tiêu chí ${editingItem.code}` : 'Thêm tiêu chí con mới'}
            </h3>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Mã tiêu chí *</label>
                  <input
                    required
                    value={itemForm.code}
                    onChange={(e) => setItemForm({ ...itemForm, code: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Điểm tối đa *</label>
                  <input
                    type="number"
                    step={0.5}
                    min={0.5}
                    max={40}
                    required
                    value={itemForm.max_score}
                    onChange={(e) => setItemForm({ ...itemForm, max_score: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">Nội dung đánh giá *</label>
                <textarea
                  required
                  rows={2}
                  value={itemForm.title}
                  onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Hướng dẫn chấm điểm</label>
                <textarea
                  rows={2}
                  value={itemForm.scoring_guide}
                  onChange={(e) => setItemForm({ ...itemForm, scoring_guide: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Yêu cầu minh chứng</label>
                <input
                  value={itemForm.evidence_requirement}
                  onChange={(e) => setItemForm({ ...itemForm, evidence_requirement: e.target.value })}
                  placeholder="Biên bản, hình ảnh, báo cáo PDF..."
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowItemModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm cursor-pointer">Hủy</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#005baa] text-white text-sm font-semibold cursor-pointer">
                {editingItem ? 'Lưu thay đổi' : 'Thêm tiêu chí'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

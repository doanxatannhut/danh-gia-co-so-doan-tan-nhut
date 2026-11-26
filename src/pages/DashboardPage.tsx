import React, { useMemo, useState } from 'react';
import {
  Building2,
  Clock,
  Edit3,
  Send,
  SearchCheck,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Search,
  Info,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { AuthUser, DashboardData, EvaluationStatus } from '../types';
import { formatDateTime, formatScore, STATUS_META } from '../utils/api';

interface DashboardPageProps {
  user: AuthUser;
  data: DashboardData | null;
  loading: boolean;
  onOpenEvaluation: (evalId: number) => void;
  onGoToCriteria?: () => void;
}

const PIE_COLORS = ['#94a3b8', '#2563eb', '#0284c7', '#ea580c', '#d97706', '#059669'];

export const DashboardPage: React.FC<DashboardPageProps> = ({
  user,
  data,
  loading,
  onOpenEvaluation,
  onGoToCriteria,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredUnits = useMemo(() => {
    if (!data?.units) return [];
    return data.units.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          u.unit_name.toLowerCase().includes(q) ||
          u.unit_code.toLowerCase().includes(q) ||
          u.secretary_name.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, search, statusFilter]);

  if (loading && !data) {
    return (
      <div className="card-surface p-10 text-center text-sm text-[var(--text-secondary)]">
        Đang tải dữ liệu Dashboard Tuổi trẻ Tân Nhựt...
      </div>
    );
  }

  if (!data || !data.version || !data.stats || !data.points) {
    return (
      <div className="card-surface p-10 text-center space-y-3">
        <div className="text-sm text-[var(--text-secondary)]">
          Chưa có phiên bản bảng điểm nào được thiết lập.
        </div>
        {(user.role === 'admin' || user.role === 'reviewer') && onGoToCriteria && (
          <button
            type="button"
            onClick={onGoToCriteria}
            className="px-4 py-2 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-xs sm:text-sm font-semibold cursor-pointer"
          >
            Đi tới Quản lý tiêu chí (60/40) để tạo bảng điểm
          </button>
        )}
      </div>
    );
  }

  const { stats, points, version } = data;

  const kpiCards = [
    { label: 'Tổng Cơ sở Đoàn', value: stats.totalUnits, icon: <Building2 className="w-5 h-5" />, color: 'text-[#005baa] bg-blue-50 dark:bg-blue-950/50 dark:text-sky-400', filter: 'all' },
    { label: 'Chưa đánh giá', value: stats.notStarted, icon: <Clock className="w-5 h-5" />, color: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300', filter: 'not_started' },
    { label: 'Đang tự đánh giá', value: stats.selfAssessing, icon: <Edit3 className="w-5 h-5" />, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50 dark:text-blue-300', filter: 'self_assessing' },
    { label: 'Đã gửi hồ sơ', value: stats.submitted, icon: <Send className="w-5 h-5" />, color: 'text-sky-600 bg-sky-50 dark:bg-sky-950/50 dark:text-sky-300', filter: 'submitted' },
    { label: 'Đang đánh giá', value: stats.underReview, icon: <SearchCheck className="w-5 h-5" />, color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/50 dark:text-orange-300', filter: 'under_review' },
    { label: 'Cần bổ sung', value: stats.needsRevision, icon: <AlertTriangle className="w-5 h-5" />, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300', filter: 'needs_revision' },
    { label: 'Đã hoàn tất', value: stats.completed, icon: <CheckCircle2 className="w-5 h-5" />, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300', filter: 'completed' },
  ];

  const statusChartData = [
    { name: 'Chưa đánh giá', value: stats.notStarted },
    { name: 'Đang tự chấm', value: stats.selfAssessing },
    { name: 'Đã gửi', value: stats.submitted },
    { name: 'Đang đánh giá', value: stats.underReview },
    { name: 'Cần bổ sung', value: stats.needsRevision },
    { name: 'Hoàn tất', value: stats.completed },
  ].filter((d) => d.value > 0);

  const scoreChartData = data.units.map((u) => ({
    name: u.unit_code,
    fullName: u.unit_name,
    'Tự đánh giá': u.self_total,
    'Điểm Đoàn xã chấm': u.review_total ?? 0,
  }));

  return (
    <div className="space-y-6">
      {/* Banner: Active Scorecard & 60/40 Point Structure */}
      <div className="youth-gradient rounded-2xl p-5 sm:p-6 text-white shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
              <Sparkles className="w-3.5 h-3.5" />
              {version.code} • Năm {version.year}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold">{version.title}</h1>
            <p className="text-sky-100 text-xs sm:text-sm">
              Thang điểm đang áp dụng:{' '}
              <strong className="text-white">{points.activeMaxScore} / 100 điểm</strong>{' '}
              (Cố định: <strong>{points.fixedMax}/60</strong> • Bổ sung:{' '}
              <strong>
                {points.supplementaryPublished
                  ? `${points.supplementaryConfiguredMax}/40 đã công bố`
                  : `${points.supplementaryConfiguredMax}/40 chưa công bố`}
              </strong>
              )
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!points.supplementaryPublished && (
              <div className="px-3.5 py-2 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 text-xs flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-300 shrink-0" />
                <span>40 điểm bổ sung chưa công bố — không tính 0 điểm</span>
              </div>
            )}
            {(user.role === 'admin' || user.role === 'reviewer') && onGoToCriteria && (
              <button
                type="button"
                onClick={onGoToCriteria}
                className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs sm:text-sm transition cursor-pointer"
              >
                Thiết lập tiêu chí 60/40
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 7 KPI Cards (Commune Admin / Reviewer only — units only see their own dossier) */}
      {user.role !== 'unit' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
          {kpiCards.map((kpi) => {
            const active = statusFilter === kpi.filter;
            return (
              <button
                key={kpi.label}
                type="button"
                onClick={() => setStatusFilter(kpi.filter)}
                className={`card-surface p-4 text-left transition hover:shadow-md cursor-pointer ${
                  active ? 'ring-2 ring-[#005baa]' : ''
                }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${kpi.color}`}>
                  {kpi.icon}
                </div>
                <div className="mt-3 text-2xl font-bold tracking-tight">{kpi.value}</div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5 leading-tight">{kpi.label}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Charts Section */}
      {user.role !== 'unit' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="card-surface p-5 lg:col-span-5">
            <h2 className="text-sm font-bold mb-1">Biểu đồ tiến độ đánh giá toàn xã</h2>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              Phân bổ trạng thái hồ sơ của {stats.totalUnits} Cơ sở Đoàn trực thuộc
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={86}
                    paddingAngle={3}
                  >
                    {statusChartData.map((entry, idx) => (
                      <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card-surface p-5 lg:col-span-7">
            <h2 className="text-sm font-bold mb-1">So sánh điểm Tự đánh giá & Điểm Đoàn xã chấm</h2>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              Thang điểm hiệu lực hiện tại: {points.activeMaxScore} điểm (Xanh dương: Tự chấm • Cam: Điểm Đoàn xã chấm)
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={scoreChartData} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, points.activeMaxScore]} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(val: unknown, name: unknown) => [`${val} / ${points.activeMaxScore}`, String(name)]}
                    labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullName || ''}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="Tự đánh giá" fill="#2563eb" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Điểm Đoàn xã chấm" fill="#ea580c" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Unit Summary Table */}
      <div className="card-surface overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">
              {user.role === 'unit' ? 'Hồ sơ đánh giá của đơn vị' : 'Bảng tổng hợp điểm các Cơ sở Đoàn'}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {user.role === 'unit'
                ? 'Nhấn "Mở bảng điểm" để thực hiện tự đánh giá và theo dõi kết quả của đơn vị.'
                : 'Nhấn vào từng đơn vị để mở bảng điểm chi tiết và thực hiện chấm điểm / đánh giá.'}
            </p>
          </div>
          {user.role !== 'unit' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm tên Chi đoàn, mã..."
                  className="pl-9 pr-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-xs sm:text-sm w-52"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Lọc theo trạng thái"
                className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-xs sm:text-sm"
              >
                <option value="all">Tất cả trạng thái</option>
                {(Object.keys(STATUS_META) as EvaluationStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {STATUS_META[st].label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                <th className="py-3 px-4 font-semibold">Cơ sở Đoàn</th>
                <th className="py-3 px-3 font-semibold">Trạng thái</th>
                <th className="py-3 px-3 font-semibold text-center">Tiến độ tiêu chí</th>
                <th className="py-3 px-3 font-semibold text-center text-blue-700 dark:text-blue-400">Điểm tự chấm</th>
                <th className="py-3 px-3 font-semibold text-center text-orange-700 dark:text-orange-400">Điểm Đoàn xã chấm</th>
                <th className="py-3 px-3 font-semibold text-center">Chênh lệch</th>
                <th className="py-3 px-3 font-semibold">Xếp loại chính thức</th>
                <th className="py-3 px-4 font-semibold text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredUnits.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-[var(--text-secondary)]">
                    Không có đơn vị nào phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filteredUnits.map((u) => {
                  const meta = STATUS_META[u.status];
                  const pct =
                    u.total_active_criteria > 0
                      ? Math.round((u.self_filled_count / u.total_active_criteria) * 100)
                      : 0;
                  return (
                    <tr key={u.id} className="hover:bg-[var(--bg-subtle)]/60 transition">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-[var(--text-primary)]">{u.unit_name}</div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          {u.unit_code} • Bí thư: {u.secretary_name}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${meta.badgeClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                          {meta.label}
                        </span>
                        {u.needs_evidence_count > 0 && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 font-medium">
                            {u.needs_evidence_count} tiêu chí cần bổ sung
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <div className="text-xs font-medium">
                          {u.self_filled_count}/{u.total_active_criteria} ({pct}%)
                        </div>
                        <div className="w-24 mx-auto mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div
                            className="h-full bg-[#005baa] dark:bg-sky-400 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span className="inline-block px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-bold text-sm">
                          {u.status === 'not_started' ? '—' : `${formatScore(u.self_total)}/${u.active_max_score}`}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        {u.review_total !== null ? (
                          <span
                            className={`inline-block px-2.5 py-1 rounded-lg font-bold text-sm ${
                              u.status === 'completed'
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                : 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300'
                            }`}
                          >
                            {formatScore(u.review_total)}/{u.active_max_score}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">Chưa chấm</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-center text-xs font-semibold">
                        {u.diff !== null ? (
                          <span
                            className={
                              u.diff < 0
                                ? 'text-red-600 dark:text-red-400'
                                : u.diff > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-500'
                            }
                          >
                            {u.diff > 0 ? `+${formatScore(u.diff)}` : formatScore(u.diff)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        {u.status === 'completed' ? (
                          <div>
                            <span className="inline-block px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 font-semibold text-xs">
                              {u.classification}
                            </span>
                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                              Chốt: {formatDateTime(u.confirmed_at)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--text-secondary)]">Chưa xác nhận</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onOpenEvaluation(u.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-xs font-semibold transition cursor-pointer"
                        >
                          {user.role === 'unit' ? 'Mở bảng điểm' : 'Xem & Đánh giá'}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

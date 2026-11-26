import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, FileText, Printer, Trophy, Medal, Filter } from 'lucide-react';
import type { AuthUser, PointSummary, ReportRow, ScorecardVersion } from '../types';
import { apiFetch, formatDateTime, formatScore, STATUS_META } from '../utils/api';

interface ReportsPageProps {
  user: AuthUser;
  selectedVersionId: number | null;
}

interface ReportResponse {
  version: ScorecardVersion;
  points: PointSummary;
  totalActiveCriteria: number;
  rows: ReportRow[];
}

export const ReportsPage: React.FC<ReportsPageProps> = ({ user, selectedVersionId }) => {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedVersionId) return;
    setLoading(true);
    apiFetch<ReportResponse>(`/api/reports/summary?versionId=${selectedVersionId}`)
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedVersionId]);

  if (loading && !data) {
    return <div className="card-surface p-10 text-center text-sm text-[var(--text-secondary)]">Đang tổng hợp báo cáo...</div>;
  }
  if (!data) {
    return <div className="card-surface p-10 text-center text-sm text-[var(--text-secondary)]">Chưa có dữ liệu báo cáo.</div>;
  }

  const displayedRows =
    unitFilter === 'all'
      ? data.rows
      : data.rows.filter((r) => String(r.unit_id) === unitFilter);

  const excelUrl = `/api/reports/export/excel?versionId=${data.version.id}${unitFilter !== 'all' ? `&unitId=${unitFilter}` : ''}`;
  const pdfUrl = `/api/reports/export/pdf?versionId=${data.version.id}${unitFilter !== 'all' ? `&unitId=${unitFilter}` : ''}`;

  const top3 = data.rows.filter((r) => r.rank !== null && r.rank <= 3);

  return (
    <div className="space-y-5">
      {/* Header + Export Buttons */}
      <div className="card-surface p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-[#005baa] dark:text-sky-400">
            {user.role === 'unit' ? 'Báo cáo & Kết quả xếp loại của đơn vị' : 'Báo cáo tổng hợp & Bảng xếp hạng'}
          </div>
          <h1 className="text-xl font-bold mt-0.5">{data.version.title}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Thang điểm áp dụng: <strong>{data.points.activeMaxScore}/100</strong> (Cố định: {data.points.fixedMax}/60 • Bổ sung:{' '}
            {data.points.supplementaryPublished ? `${data.points.supplementaryConfiguredMax}/40 đã công bố` : 'Chưa công bố'})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          {user.role !== 'unit' && (
            <div className="inline-flex items-center gap-1.5">
              <Filter className="w-4 h-4 text-[var(--text-secondary)]" />
              <select
                aria-label="Lọc theo Cơ sở Đoàn"
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-xs font-medium"
              >
                <option value="all">Toàn xã ({data.rows.length} đơn vị)</option>
                {data.rows.map((r) => (
                  <option key={r.unit_id} value={String(r.unit_id)}>
                    {r.unit_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <a
            href={excelUrl}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition"
          >
            <FileSpreadsheet className="w-4 h-4" /> Xuất Excel
          </a>
          <a
            href={pdfUrl}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition"
          >
            <FileText className="w-4 h-4" /> Xuất PDF
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-xs font-semibold transition cursor-pointer"
          >
            <Printer className="w-4 h-4" /> In trực tiếp
          </button>
        </div>
      </div>

      {/* Top Ranking Podium (Official Confirmed Units) */}
      {user.role !== 'unit' && top3.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {top3.map((r) => (
            <div key={r.unit_id} className="card-surface p-4 flex items-center gap-3.5 border-l-4 border-l-amber-400">
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 font-bold ${
                  r.rank === 1
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                    : r.rank === 2
                      ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                      : 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
                }`}
              >
                {r.rank === 1 ? <Trophy className="w-5 h-5" /> : <Medal className="w-5 h-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold uppercase text-amber-600 dark:text-amber-400">
                  Hạng #{r.rank}
                </div>
                <div className="font-bold text-sm truncate">{r.unit_name}</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Chính thức:{' '}
                  <strong className="text-emerald-700 dark:text-emerald-300">
                    {formatScore(r.official_total)}/{r.active_max_score}
                  </strong>{' '}
                  • {r.classification}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detailed Report Table */}
      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="bg-[#005baa] text-white text-xs uppercase tracking-wider">
                <th className="py-3 px-3 text-center w-14">Hạng</th>
                <th className="py-3 px-3">Cơ sở Đoàn</th>
                <th className="py-3 px-3">Trạng thái</th>
                <th className="py-3 px-3 text-center">Tiến độ</th>
                <th className="py-3 px-3 text-center">Tự đánh giá</th>
                <th className="py-3 px-3 text-center">Điểm Đoàn xã chấm</th>
                <th className="py-3 px-3 text-center">Chênh lệch</th>
                <th className="py-3 px-3 text-center">Điểm chính thức</th>
                <th className="py-3 px-3">Kết quả xếp loại</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {displayedRows.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.unit_id} className="hover:bg-[var(--bg-subtle)]/60">
                    <td className="py-3 px-3 text-center font-bold">
                      {r.rank ? `#${r.rank}` : '—'}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold">{r.unit_name}</div>
                      <div className="text-xs text-[var(--text-secondary)]">
                        {r.unit_code} • {r.secretary_name}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium ${meta.badgeClass}`}>
                        {r.status_label}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center text-xs font-semibold">{r.completion_pct}%</td>
                    <td className="py-3 px-3 text-center font-bold text-blue-700 dark:text-blue-300">
                      {formatScore(r.self_total)}
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-orange-700 dark:text-orange-300">
                      {formatScore(r.review_total)}
                    </td>
                    <td className="py-3 px-3 text-center text-xs font-semibold">
                      {r.diff !== null ? (
                        <span className={r.diff < 0 ? 'text-red-600' : r.diff > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                          {r.diff > 0 ? `+${formatScore(r.diff)}` : formatScore(r.diff)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-emerald-700 dark:text-emerald-300">
                      {r.official_total !== null ? `${formatScore(r.official_total)}/${r.active_max_score}` : '—'}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-xs">{r.classification}</div>
                      {r.confirmed_at && (
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {formatDateTime(r.confirmed_at)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

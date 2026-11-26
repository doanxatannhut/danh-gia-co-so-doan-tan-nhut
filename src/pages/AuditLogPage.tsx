import React, { useEffect, useState } from 'react';
import { History, Search, RefreshCw } from 'lucide-react';
import type { AuditLogItem } from '../types';
import { apiFetch, formatDateTime, ROLE_LABELS } from '../utils/api';

export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadLogs(q = search) {
    setLoading(true);
    try {
      const qs = q.trim() ? `?search=${encodeURIComponent(q.trim())}` : '';
      const res = await apiFetch<{ logs: AuditLogItem[] }>(`/api/reports/audit-logs${qs}`);
      setLogs(res.logs);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs('');
  }, []);

  return (
    <div className="space-y-5">
      <div className="card-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <History className="w-5 h-5 text-[#005baa]" />
            Nhật ký hoạt động hệ thống (Audit Log)
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Ghi nhận toàn bộ thao tác đăng nhập, quản lý tiêu chí, gửi hồ sơ, thẩm định, trả hồ sơ và xác nhận kết quả.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadLogs(search);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo người dùng, hành động..."
              className="pl-9 pr-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-xs sm:text-sm w-60"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-[#005baa] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Tải lại
          </button>
        </form>
      </div>

      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm text-left border-collapse">
            <thead>
              <tr className="bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-xs uppercase">
                <th className="py-3 px-4 w-40">Thời gian</th>
                <th className="py-3 px-3 w-48">Người thao tác</th>
                <th className="py-3 px-3 w-44">Mã hành động</th>
                <th className="py-3 px-4">Nội dung chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[var(--text-secondary)]">
                    Không có bản ghi nhật ký nào.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-[var(--bg-subtle)]/50">
                    <td className="py-3 px-4 whitespace-nowrap text-xs text-[var(--text-secondary)]">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold">{log.actor_name}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {ROLE_LABELS[log.actor_role] ?? log.actor_role}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] font-semibold">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4">{log.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

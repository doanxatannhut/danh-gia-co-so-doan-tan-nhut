import React, { useState } from 'react';
import {
  Award,
  LayoutDashboard,
  ClipboardCheck,
  SlidersHorizontal,
  BarChart3,
  History,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ChevronDown,
} from 'lucide-react';
import type { AuthUser, ScorecardVersion } from '../types';
import { ROLE_LABELS } from '../utils/api';

export type NavTab = 'dashboard' | 'scoring' | 'criteria' | 'reports' | 'audit';

interface LayoutProps {
  user: AuthUser;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  versions: ScorecardVersion[];
  selectedVersionId: number | null;
  onSelectVersion: (id: number) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  user,
  activeTab,
  onSelectTab,
  versions,
  selectedVersionId,
  onSelectVersion,
  onLogout,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const meta = document.querySelector('meta[name="color-scheme"]');
    return meta?.getAttribute('content') === 'dark';
  });

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      meta.setAttribute('content', next ? 'dark' : 'light');
    }
  }

  const navItems: { id: NavTab; label: string; icon: React.ReactNode; visible: boolean }[] = [
    {
      id: 'dashboard',
      label: 'Tổng quan Dashboard',
      icon: <LayoutDashboard className="w-4 h-4" />,
      visible: true,
    },
    {
      id: 'scoring',
      label: user.role === 'unit' ? 'Bảng tự đánh giá' : 'Hồ sơ & Thẩm định',
      icon: <ClipboardCheck className="w-4 h-4" />,
      visible: true,
    },
    {
      id: 'criteria',
      label: 'Quản lý tiêu chí (60/40)',
      icon: <SlidersHorizontal className="w-4 h-4" />,
      visible: user.role === 'admin',
    },
    {
      id: 'reports',
      label: 'Báo cáo & Xếp hạng',
      icon: <BarChart3 className="w-4 h-4" />,
      visible: true,
    },
    {
      id: 'audit',
      label: 'Nhật ký hoạt động',
      icon: <History className="w-4 h-4" />,
      visible: user.role === 'admin' || user.role === 'reviewer',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--bg-canvas)]">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 shrink-0 bg-[var(--bg-surface)] border-r border-[var(--border-subtle)]">
        <div className="p-5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl youth-gradient text-white flex items-center justify-center shadow-sm shrink-0">
              <Award className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm tracking-tight text-[#005baa] dark:text-sky-400 truncate">
                TUỔI TRẺ TÂN NHỰT
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] truncate">
                Đánh giá Cơ sở Đoàn
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="Điều hướng chính">
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition cursor-pointer ${
                    active
                      ? 'bg-[#005baa] text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
        </nav>

        <div className="p-4 border-t border-[var(--border-subtle)] space-y-3">
          <div className="p-3 rounded-xl bg-[var(--bg-subtle)] text-xs space-y-0.5">
            <div className="font-semibold text-[var(--text-primary)] truncate">{user.full_name}</div>
            <div className="text-[#005baa] dark:text-sky-400 font-medium truncate">
              {ROLE_LABELS[user.role]}
            </div>
            {user.unit_name && (
              <div className="text-[var(--text-secondary)] truncate">{user.unit_name}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-color)] text-xs font-semibold text-[var(--text-secondary)] hover:bg-red-50 hover:text-red-700 hover:border-red-200 dark:hover:bg-red-950/40 dark:hover:text-red-300 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Đăng xuất
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="no-print sticky top-0 z-30 bg-[var(--bg-surface)]/95 backdrop-blur border-b border-[var(--border-subtle)] px-4 lg:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 rounded-lg border border-[var(--border-subtle)] cursor-pointer"
              aria-label="Mở menu điều hướng"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#005baa] dark:text-sky-400 uppercase tracking-wider hidden sm:block">
                Đoàn TNCS Hồ Chí Minh xã Tân Nhựt
              </div>
              <div className="text-sm sm:text-base font-bold truncate">
                {navItems.find((n) => n.id === activeTab)?.label}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Version Selector */}
            {versions.length > 0 && (
              <div className="relative">
                <select
                  aria-label="Chọn phiên bản bảng điểm"
                  value={selectedVersionId ?? ''}
                  onChange={(e) => onSelectVersion(Number(e.target.value))}
                  className="appearance-none pl-3 pr-8 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-xs sm:text-sm font-medium max-w-[180px] sm:max-w-xs truncate cursor-pointer"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.year} – {v.period} ({v.status === 'published' ? 'Đang áp dụng' : v.status === 'draft' ? 'Nháp' : 'Lưu trữ'})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              </div>
            )}

            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] transition cursor-pointer"
              title={darkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
              aria-label="Chuyển đổi giao diện sáng/tối"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
            </button>
          </div>
        </header>

        {/* Mobile Nav Drawer */}
        {mobileOpen && (
          <div className="no-print lg:hidden bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] p-3 space-y-1">
            {navItems
              .filter((item) => item.visible)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(item.id);
                    setMobileOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                    activeTab === item.id
                      ? 'bg-[#005baa] text-white'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            <div className="pt-2 mt-2 border-t border-[var(--border-subtle)] flex items-center justify-between px-2">
              <div className="text-xs">
                <div className="font-semibold">{user.full_name}</div>
                <div className="text-[var(--text-secondary)]">{ROLE_LABELS[user.role]}</div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        )}

        {/* Page Body */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { Award, ShieldCheck, LogIn, Lock, User } from 'lucide-react';
import type { AuthUser } from '../types';
import { apiFetch } from '../utils/api';

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left Brand Banner */}
      <div className="youth-gradient text-white lg:w-5/12 p-8 lg:p-12 flex flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white/15 backdrop-blur-sm border border-white/20 text-xs font-semibold tracking-wide uppercase">
            <Award className="w-4 h-4 text-amber-300" />
            Dashboard Tuổi trẻ Tân Nhựt
          </div>
          <h1 className="mt-6 text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight">
            Phân hệ Đánh giá, Chấm điểm Cơ sở Đoàn
          </h1>
          <p className="mt-3 text-sky-100 text-sm sm:text-base max-w-md leading-relaxed">
            Hệ thống quản lý đánh giá, chấm điểm hai vòng và xếp loại chất lượng hoạt động các Cơ sở Đoàn trực thuộc{' '}
            <strong className="text-white">Đoàn TNCS Hồ Chí Minh xã Tân Nhựt</strong>.
          </p>

          <div className="mt-8 grid gap-3 max-w-md">
            <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl p-3.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-400/20 text-amber-300 flex items-center justify-center shrink-0 font-bold text-sm">
                60+40
              </div>
              <div className="text-xs sm:text-sm">
                <div className="font-semibold">Thang điểm 100 linh hoạt</div>
                <div className="text-sky-100/90 mt-0.5">
                  60 điểm cố định & 40 điểm bổ sung mở rộng sau khi Đoàn xã công bố.
                </div>
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-xl p-3.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-400/20 text-emerald-200 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="text-xs sm:text-sm">
                <div className="font-semibold">Quy trình 2 vòng minh bạch</div>
                <div className="text-sky-100/90 mt-0.5">
                  Cơ sở Đoàn tự đánh giá, đính kèm minh chứng → Đoàn xã chấm điểm & lưu lịch sử chi tiết.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-8 pt-6 border-t border-white/15 text-xs text-sky-100/80">
          Đoàn TNCS Hồ Chí Minh xã Tân Nhựt • Tích hợp hệ sinh thái Dashboard Tuổi trẻ Tân Nhựt
        </div>
      </div>

      {/* Right Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Đăng nhập hệ thống</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Sử dụng tài khoản do Quản trị viên Đoàn xã Tân Nhựt cấp để truy cập phân hệ.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="card-surface p-6 space-y-4">
            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm"
              >
                {error}
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-medium mb-1.5">
                Tên đăng nhập
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-sm"
                  placeholder="Nhập tên đăng nhập"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1.5">
                Mật khẩu
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-sm"
                  placeholder="Nhập mật khẩu"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white font-semibold text-sm flex items-center justify-center gap-2 transition disabled:opacity-60 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              {loading ? 'Đang xác thực...' : 'Đăng nhập'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

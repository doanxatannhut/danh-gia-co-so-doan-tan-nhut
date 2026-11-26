import React, { useEffect, useState } from 'react';
import {
  Building2,
  Users,
  Plus,
  Edit3,
  Trash2,
  ShieldCheck,
  UserCheck,
  KeyRound,
  X,
} from 'lucide-react';
import type { AuthUser, UserRole } from '../types';
import { apiFetch, ROLE_LABELS } from '../utils/api';

interface AdminUnit {
  id: number;
  code: string;
  name: string;
  unit_type: string;
  secretary_name: string;
  phone: string;
  member_count: number;
  active: boolean;
  account_count?: number;
}

interface AdminUserRow {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  unit_id: number | null;
  unit_code: string | null;
  unit_name: string | null;
  title: string;
  active: boolean;
  created_at: string;
}

interface AdminUsersUnitsPageProps {
  currentUser: AuthUser;
  onDataChanged: () => void;
}

const UNIT_TYPE_LABELS: Record<string, string> = {
  dia_ban_dan_cu: 'Địa bàn dân cư (Ấp)',
  truong_hoc: 'Trường học',
  co_quan: 'Cơ quan / Hành chính',
  luc_luong_vu_trang: 'Lực lượng vũ trang',
  doanh_nghiep: 'Doanh nghiệp / Khác',
};

export const AdminUsersUnitsPage: React.FC<AdminUsersUnitsPageProps> = ({
  currentUser,
  onDataChanged,
}) => {
  const [subTab, setSubTab] = useState<'units' | 'users'>('units');
  const [units, setUnits] = useState<AdminUnit[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Unit modal
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [editingUnit, setEditingUnit] = useState<AdminUnit | null>(null);
  const [unitForm, setUnitForm] = useState({
    code: '',
    name: '',
    unit_type: 'dia_ban_dan_cu',
    secretary_name: '',
    phone: '',
    member_count: '0',
  });

  // User modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'unit' as UserRole,
    unit_id: '',
    title: '',
    active: true,
  });

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [uRes, usRes] = await Promise.all([
        apiFetch<{ units: AdminUnit[] }>('/api/admin/units'),
        apiFetch<{ users: AdminUserRow[] }>('/api/admin/users'),
      ]);
      setUnits(uRes.units);
      setUsers(usRes.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu quản trị.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function showToastMsg(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3500);
  }

  function openNewUnit() {
    setEditingUnit(null);
    setUnitForm({
      code: '',
      name: '',
      unit_type: 'dia_ban_dan_cu',
      secretary_name: '',
      phone: '',
      member_count: '0',
    });
    setShowUnitModal(true);
  }

  function openEditUnit(u: AdminUnit) {
    setEditingUnit(u);
    setUnitForm({
      code: u.code,
      name: u.name,
      unit_type: u.unit_type,
      secretary_name: u.secretary_name,
      phone: u.phone,
      member_count: String(u.member_count),
    });
    setShowUnitModal(true);
  }

  async function handleSaveUnit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        ...unitForm,
        member_count: Number(unitForm.member_count) || 0,
      };
      if (editingUnit) {
        await apiFetch(`/api/admin/units/${editingUnit.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToastMsg('Đã cập nhật Cơ sở Đoàn.');
      } else {
        await apiFetch('/api/admin/units', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToastMsg('Đã tạo mới Cơ sở Đoàn và khởi tạo hồ sơ đánh giá.');
      }
      setShowUnitModal(false);
      await loadAll();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu Cơ sở Đoàn.');
    }
  }

  async function handleDeleteUnit(u: AdminUnit) {
    if (!window.confirm(`Xóa Cơ sở Đoàn "${u.name}"? Toàn bộ hồ sơ đánh giá của đơn vị này cũng sẽ bị xóa.`)) return;
    setError('');
    try {
      await apiFetch(`/api/admin/units/${u.id}`, { method: 'DELETE' });
      await loadAll();
      onDataChanged();
      showToastMsg(`Đã xóa Cơ sở Đoàn "${u.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa Cơ sở Đoàn.');
    }
  }

  function openNewUser() {
    setEditingUser(null);
    setUserForm({
      username: '',
      password: '',
      full_name: '',
      role: units.length > 0 ? 'unit' : 'reviewer',
      unit_id: units[0] ? String(units[0].id) : '',
      title: '',
      active: true,
    });
    setShowUserModal(true);
  }

  function openEditUser(u: AdminUserRow) {
    setEditingUser(u);
    setUserForm({
      username: u.username,
      password: '',
      full_name: u.full_name,
      role: u.role,
      unit_id: u.unit_id ? String(u.unit_id) : '',
      title: u.title,
      active: u.active,
    });
    setShowUserModal(true);
  }

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (editingUser) {
        const payload: Record<string, unknown> = {
          full_name: userForm.full_name,
          role: userForm.role,
          unit_id: userForm.role === 'unit' ? Number(userForm.unit_id) : null,
          title: userForm.title,
          active: userForm.active,
        };
        if (userForm.password.trim()) payload.password = userForm.password.trim();
        await apiFetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToastMsg('Đã cập nhật tài khoản và phân quyền.');
      } else {
        await apiFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            username: userForm.username,
            password: userForm.password,
            full_name: userForm.full_name,
            role: userForm.role,
            unit_id: userForm.role === 'unit' ? Number(userForm.unit_id) : null,
            title: userForm.title,
          }),
        });
        showToastMsg('Đã tạo tài khoản mới thành công.');
      }
      setShowUserModal(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu tài khoản.');
    }
  }

  async function handleDeleteUser(u: AdminUserRow) {
    if (!window.confirm(`Xóa tài khoản "${u.username}" (${u.full_name})?`)) return;
    setError('');
    try {
      await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      await loadAll();
      showToastMsg(`Đã xóa tài khoản "${u.username}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa tài khoản.');
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Quản trị Cơ sở Đoàn & Phân quyền tài khoản</h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">
            Tạo danh sách các Cơ sở Đoàn trực thuộc, cấp tài khoản đăng nhập và phân quyền Quản trị viên Đoàn xã / Cán bộ Đoàn xã / Cơ sở Đoàn.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openNewUnit}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#005baa] text-[#005baa] dark:text-sky-400 dark:border-sky-500 text-xs font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Thêm Cơ sở Đoàn
          </button>
          <button
            type="button"
            onClick={openNewUser}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Tạo tài khoản
          </button>
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

      {/* Sub-tabs */}
      <div className="inline-flex p-1 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => setSubTab('units')}
          className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer transition ${
            subTab === 'units' ? 'bg-[#005baa] text-white' : 'text-[var(--text-secondary)]'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Danh sách Cơ sở Đoàn ({units.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('users')}
          className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer transition ${
            subTab === 'users' ? 'bg-[#005baa] text-white' : 'text-[var(--text-secondary)]'
          }`}
        >
          <Users className="w-4 h-4" />
          Tài khoản & Phân quyền ({users.length})
        </button>
      </div>

      {/* Tab 1: Units */}
      {subTab === 'units' && (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-xs uppercase">
                  <th className="py-3 px-4">Mã đơn vị</th>
                  <th className="py-3 px-3">Tên Cơ sở Đoàn</th>
                  <th className="py-3 px-3">Khối / Loại hình</th>
                  <th className="py-3 px-3">Bí thư & Liên hệ</th>
                  <th className="py-3 px-3 text-center">Đoàn viên</th>
                  <th className="py-3 px-3 text-center">Tài khoản</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {loading && units.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-[var(--text-secondary)]">Đang tải...</td>
                  </tr>
                ) : units.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-[var(--text-secondary)]">
                      Chưa có Cơ sở Đoàn nào. Hãy nhấn <strong>"Thêm Cơ sở Đoàn"</strong> để bắt đầu tạo danh sách thực tế của xã Tân Nhựt.
                    </td>
                  </tr>
                ) : (
                  units.map((u) => (
                    <tr key={u.id} className="hover:bg-[var(--bg-subtle)]/50">
                      <td className="py-3 px-4 font-mono font-bold text-xs text-[#005baa] dark:text-sky-400">{u.code}</td>
                      <td className="py-3 px-3 font-semibold">{u.name}</td>
                      <td className="py-3 px-3 text-xs text-[var(--text-secondary)]">
                        {UNIT_TYPE_LABELS[u.unit_type] ?? u.unit_type}
                      </td>
                      <td className="py-3 px-3 text-xs">
                        <div>{u.secretary_name || '—'}</div>
                        {u.phone && <div className="text-[var(--text-secondary)]">{u.phone}</div>}
                      </td>
                      <td className="py-3 px-3 text-center font-semibold">{u.member_count}</td>
                      <td className="py-3 px-3 text-center text-xs">{u.account_count ?? 0}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditUnit(u)}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-subtle)] text-[#005baa] cursor-pointer"
                            title="Sửa Cơ sở Đoàn"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteUnit(u)}
                            className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/50 text-red-600 cursor-pointer"
                            title="Xóa Cơ sở Đoàn"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Users */}
      {subTab === 'users' && (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-xs uppercase">
                  <th className="py-3 px-4">Tên đăng nhập</th>
                  <th className="py-3 px-3">Họ và tên / Chức vụ</th>
                  <th className="py-3 px-3">Vai trò phân quyền</th>
                  <th className="py-3 px-3">Đơn vị quản lý</th>
                  <th className="py-3 px-3 text-center">Trạng thái</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--bg-subtle)]/50">
                    <td className="py-3 px-4 font-mono font-bold text-xs">{u.username}</td>
                    <td className="py-3 px-3">
                      <div className="font-semibold">{u.full_name}</div>
                      {u.title && <div className="text-xs text-[var(--text-secondary)]">{u.title}</div>}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          u.role === 'admin'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'
                            : u.role === 'reviewer'
                              ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                        }`}
                      >
                        {u.role === 'admin' && <ShieldCheck className="w-3.5 h-3.5" />}
                        {u.role === 'reviewer' && <UserCheck className="w-3.5 h-3.5" />}
                        {u.role === 'unit' && <Users className="w-3.5 h-3.5" />}
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-xs">
                      {u.unit_name ? `${u.unit_code} – ${u.unit_name}` : 'Toàn xã Tân Nhựt'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          u.active
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {u.active ? 'Đang hoạt động' : 'Đã khóa'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditUser(u)}
                          className="p-1.5 rounded-lg hover:bg-[var(--bg-subtle)] text-[#005baa] cursor-pointer"
                          title="Chỉnh sửa / Đổi mật khẩu"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        {u.id !== currentUser.id && (
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u)}
                            className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/50 text-red-600 cursor-pointer"
                            title="Xóa tài khoản"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Unit */}
      {showUnitModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form onSubmit={handleSaveUnit} className="card-surface max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold">
              {editingUnit ? `Sửa Cơ sở Đoàn (${editingUnit.code})` : 'Thêm Cơ sở Đoàn mới'}
            </h3>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Mã đơn vị *</label>
                  <input
                    required
                    value={unitForm.code}
                    onChange={(e) => setUnitForm({ ...unitForm, code: e.target.value })}
                    placeholder="VD: CD-AP1"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Số đoàn viên</label>
                  <input
                    type="number"
                    min={0}
                    value={unitForm.member_count}
                    onChange={(e) => setUnitForm({ ...unitForm, member_count: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">Tên Cơ sở Đoàn *</label>
                <input
                  required
                  value={unitForm.name}
                  onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
                  placeholder="VD: Chi đoàn Ấp 1"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Khối / Loại hình</label>
                <select
                  value={unitForm.unit_type}
                  onChange={(e) => setUnitForm({ ...unitForm, unit_type: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                >
                  {Object.entries(UNIT_TYPE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Bí thư Chi đoàn</label>
                  <input
                    value={unitForm.secretary_name}
                    onChange={(e) => setUnitForm({ ...unitForm, secretary_name: e.target.value })}
                    placeholder="Họ và tên"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Số điện thoại</label>
                  <input
                    value={unitForm.phone}
                    onChange={(e) => setUnitForm({ ...unitForm, phone: e.target.value })}
                    placeholder="09xx..."
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowUnitModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm cursor-pointer">Hủy</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#005baa] text-white text-sm font-semibold cursor-pointer">
                {editingUnit ? 'Lưu thay đổi' : 'Tạo Cơ sở Đoàn'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: User */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form onSubmit={handleSaveUser} className="card-surface max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold">
              {editingUser ? `Chỉnh sửa tài khoản "${editingUser.username}"` : 'Tạo tài khoản & Phân quyền mới'}
            </h3>
            <div className="space-y-3 text-sm">
              {!editingUser && (
                <div>
                  <label className="block font-medium mb-1">Tên đăng nhập *</label>
                  <input
                    required
                    value={userForm.username}
                    onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                    placeholder="VD: cd_ap1 hoặc canbo_tan"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
              )}
              <div>
                <label className="block font-medium mb-1">
                  {editingUser ? 'Đặt mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu (>= 6 ký tự) *'}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  minLength={editingUser ? undefined : 6}
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder={editingUser ? 'Nhập mật khẩu mới nếu muốn đổi' : 'Nhập mật khẩu'}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Họ và tên *</label>
                <input
                  required
                  value={userForm.full_name}
                  onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                  placeholder="Họ và tên cán bộ / Bí thư"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Chức vụ</label>
                <input
                  value={userForm.title}
                  onChange={(e) => setUserForm({ ...userForm, title: e.target.value })}
                  placeholder="VD: Phó Bí thư Đoàn xã / Bí thư Chi đoàn"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Vai trò phân quyền *</label>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value as UserRole })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                >
                  <option value="admin">Quản trị viên Đoàn xã (Toàn quyền hệ thống)</option>
                  <option value="reviewer">Cán bộ Đoàn xã (Đánh giá, chấm điểm, trả & chốt hồ sơ)</option>
                  <option value="unit">Cơ sở Đoàn (Tự đánh giá & nộp minh chứng của đơn vị)</option>
                </select>
              </div>
              {userForm.role === 'unit' && (
                <div>
                  <label className="block font-medium mb-1">Gắn với Cơ sở Đoàn *</label>
                  {units.length === 0 ? (
                    <div className="text-xs text-amber-700 dark:text-amber-400 p-2 rounded bg-amber-50 dark:bg-amber-950/40">
                      Chưa có Cơ sở Đoàn nào. Vui lòng tạo Cơ sở Đoàn trước khi cấp tài khoản cho đơn vị.
                    </div>
                  ) : (
                    <select
                      required
                      value={userForm.unit_id}
                      onChange={(e) => setUserForm({ ...userForm, unit_id: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                    >
                      <option value="">-- Chọn Cơ sở Đoàn --</option>
                      {units.map((u) => (
                        <option key={u.id} value={String(u.id)}>
                          {u.code} – {u.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {editingUser && editingUser.id !== currentUser.id && (
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={userForm.active}
                    onChange={(e) => setUserForm({ ...userForm, active: e.target.checked })}
                  />
                  Cho phép tài khoản hoạt động
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowUserModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm cursor-pointer">Hủy</button>
              <button
                type="submit"
                disabled={userForm.role === 'unit' && units.length === 0}
                className="px-4 py-2 rounded-lg bg-[#005baa] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {editingUser ? 'Lưu thay đổi' : 'Tạo tài khoản'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

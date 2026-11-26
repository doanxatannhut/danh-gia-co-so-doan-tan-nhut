import type { EvaluationStatus } from '../types';

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    let message = `Lỗi máy chủ (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatScore(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}

export const STATUS_META: Record<
  EvaluationStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  not_started: {
    label: 'Chưa đánh giá',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    dotClass: 'bg-slate-400',
  },
  self_assessing: {
    label: 'Đang tự đánh giá',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
    dotClass: 'bg-blue-500',
  },
  submitted: {
    label: 'Đã gửi hồ sơ',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800',
    dotClass: 'bg-sky-500',
  },
  under_review: {
    label: 'Đang thẩm định',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800',
    dotClass: 'bg-orange-500',
  },
  needs_revision: {
    label: 'Cần bổ sung',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700',
    dotClass: 'bg-amber-500',
  },
  completed: {
    label: 'Đã hoàn tất',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    dotClass: 'bg-emerald-500',
  },
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị viên Đoàn xã',
  reviewer: 'Cán bộ thẩm định',
  unit: 'Cơ sở Đoàn',
};

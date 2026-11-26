import React, { useCallback, useEffect, useState } from 'react';
import type { AuthUser, DashboardData, ScorecardVersion } from './types';
import { apiFetch } from './utils/api';
import { LoginPage } from './components/LoginPage';
import { Layout, type NavTab } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ScoringPage } from './pages/ScoringPage';
import { CriteriaManagerPage } from './pages/CriteriaManagerPage';
import { ReportsPage } from './pages/ReportsPage';
import { AuditLogPage } from './pages/AuditLogPage';

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [versions, setVersions] = useState<ScorecardVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);
  const [selectedEvalId, setSelectedEvalId] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<{ user: AuthUser }>('/api/auth/me')
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  const loadVersions = useCallback(async () => {
    try {
      const res = await apiFetch<{ versions: ScorecardVersion[] }>('/api/scorecards');
      setVersions(res.versions);
      setSelectedVersionId((prev) => {
        if (prev && res.versions.some((v) => v.id === prev)) return prev;
        const pub = res.versions.find((v) => v.status === 'published');
        return pub?.id ?? res.versions[0]?.id ?? null;
      });
    } catch {
      // ignore
    }
  }, []);

  const loadDashboard = useCallback(async (versionId: number | null) => {
    if (!versionId) return;
    setLoadingDash(true);
    try {
      const res = await apiFetch<DashboardData>(`/api/dashboard?versionId=${versionId}`);
      setDashboard(res);
      setSelectedEvalId((prev) => {
        if (prev && res.units.some((u) => u.id === prev)) return prev;
        return res.units[0]?.id ?? null;
      });
    } catch {
      // ignore
    } finally {
      setLoadingDash(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadVersions();
    }
  }, [user, loadVersions]);

  useEffect(() => {
    if (user && selectedVersionId) {
      loadDashboard(selectedVersionId);
    }
  }, [user, selectedVersionId, loadDashboard]);

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
    setDashboard(null);
    setSelectedEvalId(null);
    setActiveTab('dashboard');
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[var(--text-secondary)]">
        Đang khởi tạo Dashboard Tuổi trẻ Tân Nhựt...
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={(u) => setUser(u)} />;
  }

  return (
    <Layout
      user={user}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      versions={versions}
      selectedVersionId={selectedVersionId}
      onSelectVersion={(id) => {
        setSelectedVersionId(id);
        setSelectedEvalId(null);
      }}
      onLogout={handleLogout}
    >
      {activeTab === 'dashboard' && (
        <DashboardPage
          user={user}
          data={dashboard}
          loading={loadingDash}
          onOpenEvaluation={(evalId) => {
            setSelectedEvalId(evalId);
            setActiveTab('scoring');
          }}
          onGoToCriteria={user.role === 'admin' ? () => setActiveTab('criteria') : undefined}
        />
      )}

      {activeTab === 'scoring' && (
        <ScoringPage
          user={user}
          evaluationId={selectedEvalId}
          allUnits={dashboard?.units ?? []}
          onSelectEvaluation={(id) => setSelectedEvalId(id)}
          onDataChanged={() => loadDashboard(selectedVersionId)}
        />
      )}

      {activeTab === 'criteria' && user.role === 'admin' && (
        <CriteriaManagerPage
          versions={versions}
          selectedVersionId={selectedVersionId}
          onSelectVersion={(id) => setSelectedVersionId(id)}
          onVersionsChanged={() => {
            loadVersions();
            loadDashboard(selectedVersionId);
          }}
        />
      )}

      {activeTab === 'reports' && (
        <ReportsPage user={user} selectedVersionId={selectedVersionId} />
      )}

      {activeTab === 'audit' && (user.role === 'admin' || user.role === 'reviewer') && (
        <AuditLogPage />
      )}
    </Layout>
  );
}

export default App;

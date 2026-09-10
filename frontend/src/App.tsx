import { Routes, Route, Navigate } from 'react-router-dom';
import { GhostLoader } from '@/components/ui';
import { AuthProvider, useAuth } from '@/hooks/useAuth';

import Layout from '@/components/Layout';
import Login from '@/pages/Login';

import Overview from '@/pages/Overview';
import Incidents from '@/pages/Incidents';
import IncidentDetail from '@/pages/IncidentDetail';
import AgentActivity from '@/pages/AgentActivity';
import Investigations from '@/pages/Investigations';
import Actions from '@/pages/Actions';
import Approvals from '@/pages/Approvals';
import Integrations from '@/pages/Integrations';
import Audit from '@/pages/Audit';
import Ingest from '@/pages/Ingest';
import Analytics from '@/pages/Analytics';
import Settings from '@/pages/Settings';

function AppShell() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <GhostLoader label="Checking session…" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/incidents" element={<Incidents />} />
        <Route path="/incidents/:id" element={<IncidentDetail />} />
        <Route path="/agent" element={<AgentActivity />} />
        <Route path="/investigations" element={<Investigations />} />
        <Route path="/actions" element={<Actions />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/ingest" element={<Ingest />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
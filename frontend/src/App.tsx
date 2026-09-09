import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';

import Overview from '@/pages/Overview';
import Incidents from '@/pages/Incidents';
import IncidentDetail from '@/pages/IncidentDetail';
import AgentActivity from '@/pages/AgentActivity';
import Investigations from '@/pages/Investigations';
import Actions from '@/pages/Actions';
import Approvals from '@/pages/Approvals';
import Integrations from '@/pages/Integrations';
import Analytics from '@/pages/Analytics';
import Settings from '@/pages/Settings';

export default function App() {
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
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, setToken } from './api/client.js';
import LoginPage from './pages/Login.js';
import RegisterPage from './pages/Register.js';
import ParentDashboard from './pages/ParentDashboard.js';
import TasksPage from './pages/Tasks.js';
import RewardsPage from './pages/Rewards.js';
import ChildMap from './pages/ChildMap.js';
import ChildCheckin from './pages/ChildCheckin.js';
import ChildRewards from './pages/ChildRewards.js';

function isLoggedIn(): boolean {
  return !!localStorage.getItem('parent_token');
}

function isChildSession(): boolean {
  return !!document.cookie.match(/child_session=/);
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn() && !isChildSession()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function Nav() {
  const location = useLocation();
  const isChild = location.pathname.startsWith('/child');
  const isAuth = location.pathname === '/login' || location.pathname === '/register';

  if (isAuth) return null;

  const links = isChild
    ? [
        { to: '/child/map', label: '成长地图' },
        { to: '/child/checkin', label: '打卡' },
        { to: '/child/rewards', label: '兑换' },
      ]
    : [
        { to: '/parent/dashboard', label: '看板' },
        { to: '/parent/tasks', label: '任务' },
        { to: '/parent/rewards', label: '奖励' },
      ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around py-2 z-50">
      {links.map(l => (
        <Link
          key={l.to}
          to={l.to}
          className={`px-4 py-2 rounded-lg text-sm ${location.pathname === l.to ? 'bg-brand-500 text-white' : 'text-gray-600'}`}
        >
          {l.label}
        </Link>
      ))}
      {!isChild && (
        <button
          onClick={() => { setToken(null); window.location.href = '/login'; }}
          className="px-4 py-2 text-sm text-gray-400"
        >
          退出
        </button>
      )}
    </nav>
  );
}

export default function App() {
  return (
    <div className="min-h-screen pb-16">
      <Routes>
        <Route path="/" element={<Navigate to={isLoggedIn() ? '/parent/dashboard' : '/login'} replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/child/auth" element={<ChildAuthRedirect />} />

        {/* Parent routes */}
        <Route path="/parent/dashboard" element={<ProtectedRoute><ParentDashboard /></ProtectedRoute>} />
        <Route path="/parent/tasks" element={<ProtectedRoute><TasksPage /></ProtectedRoute>} />
        <Route path="/parent/rewards" element={<ProtectedRoute><RewardsPage /></ProtectedRoute>} />

        {/* Child routes */}
        <Route path="/child/map" element={<ProtectedRoute><ChildMap /></ProtectedRoute>} />
        <Route path="/child/checkin" element={<ProtectedRoute><ChildCheckin /></ProtectedRoute>} />
        <Route path="/child/rewards" element={<ProtectedRoute><ChildRewards /></ProtectedRoute>} />
      </Routes>
      <Nav />
    </div>
  );
}

function ChildAuthRedirect() {
  // The /child/auth?token=xxx URL is handled by the API directly via cookie
  // This component redirects to the child map after cookie is set
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    // Fetch the JWT and set cookie
    fetch(`/api/child/auth?token=${token}`)
      .then(res => res.json())
      .then(() => { window.location.href = '/child/map'; })
      .catch(() => { window.location.href = '/login'; });
  }
  return <div className="flex items-center justify-center min-h-screen text-gray-500">正在验证...</div>;
}

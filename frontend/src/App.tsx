import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

const AppShell = lazy(() => import('@/components/layout/AppShell').then(module => ({ default: module.AppShell })));

const NotFoundPage = lazy(() => import('@/pages/NotFound').then(module => ({ default: module.NotFoundPage })));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};

export default function App() {
  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Navigate to="/sdlc" replace />} />
          <Route path="/auth" element={<Navigate to="/sdlc" replace />} />
          <Route path="/admin/*" element={<Navigate to="/sdlc" replace />} />
          <Route path="/upgrade" element={<Navigate to="/sdlc" replace />} />
          <Route path="/app/*" element={<Navigate to="/sdlc" replace />} />
          
          {/* ── AIDLC Control Platform ── */}
          <Route
            path="/sdlc/*"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          />




          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

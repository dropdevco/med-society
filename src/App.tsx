import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { SearchPage } from './pages/SearchPage';
import { PricingPage } from './pages/PricingPage';
import { ContactPage } from './pages/ContactPage';
import { LoginPage } from './pages/LoginPage';
import { ClaimPage } from './pages/ClaimPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProviderPage } from './pages/ProviderPage';
import { BorderhealthPage } from './pages/BorderhealthPage';
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
import { ForumPage } from './pages/ForumPage';
import { ForumThreadPage } from './pages/ForumThreadPage';
import { FORUM_PATH } from './lib/forumRoutes';
import { ProviderModal } from './components/provider/ProviderModal';
import { AnalyticsBridge } from './components/AnalyticsBridge';
import { FeedbackWidget } from './components/feedback/FeedbackWidget';
import './index.css';

/**
 * A refresh keeps `history.state`, so a reload on a modal URL would reopen the
 * modal over its background page. A reload (like a shared link) should show
 * the full provider page instead, so the background reference is dropped once,
 * before the router reads the state.
 */
try {
  const st = window.history.state;
  if (st?.usr?.backgroundLocation) {
    window.history.replaceState({ ...st, usr: { ...st.usr, backgroundLocation: undefined } }, '');
  }
} catch { /* history unavailable, nothing to strip */ }

interface BackgroundState { backgroundLocation?: ReturnType<typeof useLocation> }

/**
 * "Background location" routing: opening a provider from a list navigates to
 * /providers/:id with the current location in state. The main <Routes> keeps
 * rendering that background page (so it stays mounted: results, filters, map
 * camera and scroll are untouched) while the second <Routes> layers the modal
 * on top. With no background (direct visit, refresh, shared link) the full
 * ProviderPage route below renders as before.
 */
function AppRoutes() {
  const location = useLocation();
  const background = (location.state as BackgroundState | null)?.backgroundLocation;
  return (
    <>
      <Routes location={background || location}>
        <Route path="/" element={<SearchPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/claim/:providerId" element={<ClaimPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/providers/:providerId" element={<ProviderPage />} />
        {/* The two forums, deployed but unlisted: random paths, no links
            anywhere (see lib/forumRoutes.ts). Patients ask and clinicians
            answer; Med Society is clinicians only. */}
        <Route path={FORUM_PATH.patients} element={<ForumPage forum="patients" />} />
        <Route path={`${FORUM_PATH.patients}/:threadId`} element={<ForumThreadPage forum="patients" />} />
        <Route path={FORUM_PATH.society} element={<ForumPage forum="society" />} />
        <Route path={`${FORUM_PATH.society}/:threadId`} element={<ForumThreadPage forum="society" />} />
        {/* The border health study, moved here from borderhealth.dropdev.co.
            Providers who finish it go straight into claiming or listing. */}
        <Route path="/borderhealth" element={<BorderhealthPage />} />
        <Route path="/research" element={<BorderhealthPage research />} />
        {/* Internal analytics. Admin-only, enforced in the database. */}
        <Route path="/admin" element={<Suspense fallback={null}><AdminPage /></Suspense>} />
        {/*
          /sales was the clinic-facing page and is now /pricing. The old path
          is in sent emails and in the lead rows, so it redirects rather than
          404s — and it replaces the history entry, so Back from /pricing goes
          where the user came from instead of bouncing through the redirect.
        */}
        <Route path="/sales" element={<Navigate to="/pricing" replace />} />
        {/* Anything else is a mistyped or stale link; the directory is the
            only sensible place to land. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {background && (
        <Routes>
          <Route path="/providers/:providerId" element={<ProviderModal />} />
        </Routes>
      )}
    </>
  );
}

/** /research is a co-branded study page: no MedSociety navigation on it. */
function SiteNavbar() {
  const { pathname } = useLocation();
  return pathname.startsWith('/research') ? null : <Navbar />;
}

/** Same hide rules as the nav; admin keeps a clean chrome without site chrome. */
function SiteFooter() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/research') || pathname.startsWith('/admin')) return null;
  return <Footer />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AnalyticsBridge />
      <SiteNavbar />
      <AppRoutes />
      <SiteFooter />
      <FeedbackWidget />
    </BrowserRouter>
  );
}

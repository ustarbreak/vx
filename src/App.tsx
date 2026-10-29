import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/Layout';

// Public
import LandingPage from './pages/LandingPage';
import PricingPage from './pages/pricing/PricingPage';
import PartnerProgramPage from './pages/partner/PartnerProgramPage';
import DemoRequestPage from './pages/pricing/DemoRequestPage';
import HealthCheckPage from './pages/pricing/HealthCheckPage';
import AboutPage from './pages/company/AboutPage';
import RecognitionPage from './pages/company/RecognitionPage';
import CustomerStoriesPage from './pages/company/CustomerStoriesPage';
import FindPartnerPage from './pages/company/FindPartnerPage';
import ComparePage from './pages/company/ComparePage';
import LoginPage from './pages/LoginPage';
import ServiceDetailPage from './pages/ServiceDetailPage';
import ComingSoonPage from './pages/ComingSoonPage';

// Client user views
import DashboardPage from './pages/DashboardPage';
import ThreatsPage from './pages/ThreatsPage';
import CompliancePage from './pages/CompliancePage';
import IncidentsPage from './pages/IncidentsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import NetworkPage from './pages/NetworkPage';
import PSAPage from './pages/PSAPage';

// Platform admin views
import PlatformDashboardPage from './pages/platform/PlatformDashboardPage';
import PlatformClientsPage from './pages/platform/PlatformClientsPage';
import PlatformAuditPage from './pages/platform/PlatformAuditPage';
import PlatformIntegrationsPage from './pages/platform/PlatformIntegrationsPage';
import PlatformServicesOverviewPage from './pages/platform/PlatformServicesOverviewPage';
import PlatformPartnersPage from './pages/platform/PlatformPartnersPage';
import TenantDetailPage from './pages/platform/TenantDetailPage';
import PlatformSettingsPage from './pages/platform-admin/PlatformSettingsPage';
import InfracentraThemesPage from './pages/platform-admin/InfracentraThemesPage';
import PackCustomizerPage from './pages/platform-admin/PackCustomizerPage';
import ProjectsPage from './pages/projects/ProjectsPage';
import {
  PartnerDashboardPage, PartnerClientsPage, PartnerValuePage,
  PartnerLicensingPage, PartnerBrandingPage, PartnerTrainingPage,
} from './pages/partner/PartnerPortalPages';
import AdvancedTicketingPage from './pages/client-admin/AdvancedTicketingPage';
import NotificationEnginePage from './pages/client-admin/NotificationEnginePage';
import ClientPortalPage from './pages/ClientPortalPage';

// Client admin views
import ClientAdminDashboardPage from './pages/client-admin/ClientAdminDashboardPage';
import ClientEntitlementsPage from './pages/client-admin/ClientEntitlementsPage';
import ClientAdminDashboard from './pages/client-admin/ClientAdminDashboard';
import ClientAdminPlans from './pages/client-admin/ClientAdminPlans';
import ServiceDeviceManager from './pages/client-admin/ServiceDeviceManager';
import AlertsPage from './pages/client-admin/AlertsPage';
import StatisticsPage from './pages/client-admin/StatisticsPage';
import NetworkStatistics from './pages/client-admin/NetworkStatistics';
import DeviceStatistics from './pages/client-admin/DeviceStatistics';
import PerformanceStatistics from './pages/client-admin/PerformanceStatistics';
import DeviceDetailsPage from './pages/client-admin/DeviceDetailsPage';
import EmailSecurityPage from './pages/client-admin/EmailSecurityPage';
import EndpointProtectionPage from './pages/client-admin/EndpointProtectionPage';
import CloudSecurityPage from './pages/client-admin/CloudSecurityPage';
import SDWANPage from './pages/client-admin/SDWANPage';
import MonitoredDevicesPage, { ScanHistoryPage, MonitoredAssetsPage } from './pages/client-admin/MonitoredDevicesPage';
import TechniciansManagementPage from './pages/client-admin/TechniciansManagementPage';
import VulnerabilityScanningPage from './pages/client-admin/VulnerabilityScanningPage';
import PatchManagementPage from './pages/client-admin/PatchManagementPage';
import BackupDRPage from './pages/client-admin/BackupDRPage';
import SOARPage from './pages/client-admin/SOARPage';
import DNSFilteringPage from './pages/client-admin/DNSFilteringPage';
import FirewallManagementPage from './pages/client-admin/FirewallManagementPage';
import VPNGatewayPage from './pages/client-admin/VPNGatewayPage';
import ArchitectureDiagram from './pages/client-admin/ArchitectureDiagram';
import CustomerValueDashboard from './pages/client-admin/CustomerValueDashboard';
import SecurityHistoryTimeline from './pages/client-admin/SecurityHistoryTimeline';
import CustomPlaybooksLibrary from './pages/client-admin/CustomPlaybooksLibrary';
import AutomationScriptsPage from './pages/client-admin/AutomationScriptsPage';
import AutomationRunbooksPage from './pages/client-admin/AutomationRunbooksPage';
import ComplianceReports from './pages/client-admin/ComplianceReports';
import AgentsPage from './pages/client-admin/AgentsPage';
import ReportsPage from './pages/ReportsPage';

import SettingsPage from './pages/SettingsPage';
import { isDemoMode } from './services/demoMode';

// Fast-demo switch: set localStorage `ic_fast_demo` = '1' (or build with
// VITE_FAST_DEMO=true) to skip the login page entirely and land straight in
// the simulated demo environment. Guarded: this ONLY enables the client-side
// demo session — it can never authenticate against the real backend.
function isFastDemo(): boolean {
  if (localStorage.getItem('ic_fast_demo') === '1') return true;
  return (import.meta as any).env?.VITE_FAST_DEMO === 'true';
}

// Auto-entering component used by /demo (and /login when fast mode is on):
// turns Demo Mode ON, signs in as the full-access client admin, redirects.
function DemoAutoEnter() {
  const { loginAsDemo, isAuthenticated, isLoading } = useAuth();
  React.useEffect(() => {
    if (!isDemoMode()) localStorage.setItem('ic_demo_mode', '1');
    if (!isLoading) loginAsDemo('client-admin-enterprise');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (isAuthenticated) return <FullAccessRedirect />;
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
      Entering demo environment…
    </div>
  );
}

// Redirect helper that picks the right landing page for the current role.
function FullAccessRedirect() {
  const { user } = useAuth();
  const to = user?.role === 'platform_admin' ? '/admin/dashboard'
    : user?.role === 'client_user' ? '/dashboard'
    : '/client-admin/dashboard';
  return <Navigate to={to} replace />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes - Always accessible */}
      <Route path="/" element={<LandingPage />} />
      {/* Public V2 pricing / partner program / demo request — real routes, no
          in-page anchors (they used to fall through to the catch-all → home). */}
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/mssp" element={<PartnerProgramPage />} />
      <Route path="/demo-request" element={<DemoRequestPage />} />
      {/* Free security health check — real page (was falling through the
          catch-all → home when clicked from the pricing hero). */}
      <Route path="/health-check" element={<HealthCheckPage />} />

      {/* Company / "Why Infracentra" pages */}
      <Route path="/about" element={<AboutPage />} />
      <Route path="/recognition" element={<RecognitionPage />} />
      <Route path="/customer-stories" element={<CustomerStoriesPage />} />
      <Route path="/find-a-partner" element={<FindPartnerPage />} />
      <Route path="/compare/:rival" element={<ComparePage />} />
      {/* Fast access: /demo goes straight in with the simulated demo session
          (guarded — never touches the real backend). */}
      <Route path="/demo" element={<DemoAutoEnter />} />
      <Route path="/login" element={isFastDemo() ? <DemoAutoEnter /> : <LoginPage />} />
      <Route path="/service/:serviceId" element={<ServiceDetailPage />} />
      <Route path="/coming-soon/:serviceId" element={<ComingSoonPage />} />
      {/* Academy: nav/footer link target — renders the coming-soon experience
          until the learning platform ships (no fabricated course catalog). */}
      <Route path="/academy" element={<ComingSoonPage />} />

      {/* Protected Routes - Require authentication */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        {/* Client user views */}
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="threats" element={<ThreatsPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="network" element={<NetworkPage />} />
        <Route path="psa" element={<PSAPage />} />

        {/* Platform admin views */}
        <Route path="admin/dashboard" element={<PlatformDashboardPage />} />
        <Route path="admin/clients" element={<PlatformClientsPage />} />
        <Route path="admin/audit" element={<PlatformAuditPage />} />
        <Route path="admin/partners" element={<PlatformPartnersPage />} />
        <Route path="admin/tenants/:orgId" element={<TenantDetailPage />} />
        <Route path="admin/settings" element={<PlatformSettingsPage />} />
        <Route path="admin/themes" element={<InfracentraThemesPage />} />
        <Route path="admin/packs" element={<PackCustomizerPage />} />
        <Route path="admin/integrations" element={<PlatformIntegrationsPage />} />
        <Route path="admin/services-ops" element={<PlatformServicesOverviewPage />} />

        {/* Project Manager — same page, role-scoped (platform vs client) */}
        <Route path="projects" element={<ProjectsPage />} />

        {/* Partner Portal (MSP, white-label) — role partner_admin only */}
        <Route path="partner/dashboard" element={<PartnerDashboardPage />} />
        <Route path="partner/clients" element={<PartnerClientsPage />} />
        <Route path="partner/value" element={<PartnerValuePage />} />
        <Route path="partner/licensing" element={<PartnerLicensingPage />} />
        <Route path="partner/branding" element={<PartnerBrandingPage />} />
        <Route path="partner/training" element={<PartnerTrainingPage />} />

        {/* Cross-role service consoles (Advanced Ticketing + Notification Engine) */}
        <Route path="client-admin/advanced-tickets" element={<AdvancedTicketingPage />} />
        <Route path="client-admin/notifications" element={<NotificationEnginePage />} />
        <Route path="portal" element={<ClientPortalPage />} />

        {/* Client admin views */}
        <Route path="client-admin/dashboard" element={<ClientAdminDashboardPage />} />
        <Route path="client-admin/monitored-devices" element={<MonitoredDevicesPage />} />
        {/* Alias: some views (e.g. IncidentsPage device chips) link to
            /client-admin/devices — keep it on the real monitored-devices page
            instead of falling through the catch-all back to home. */}
        <Route path="client-admin/devices" element={<Navigate to="/client-admin/monitored-devices" replace />} />
        <Route path="client-admin/scan-history" element={<ScanHistoryPage />} />
        <Route path="client-admin/asset-inventory" element={<MonitoredAssetsPage />} />
        <Route path="client-admin/agents" element={<AgentsPage />} />
        <Route path="client-admin/technicians" element={<TechniciansManagementPage />} />
        <Route path="client-admin/entitlements" element={<ClientEntitlementsPage />} />
        <Route path="client-admin/infrastructure" element={<ClientAdminDashboard />} />
        <Route path="client-admin/plans" element={<ClientAdminPlans />} />
        <Route path="client-admin/service/:serviceId/devices" element={<ServiceDeviceManager />} />
        <Route path="client-admin/alerts" element={<AlertsPage />} />
        <Route path="client-admin/alerts/:alertId" element={<AlertsPage />} />
        <Route path="client-admin/statistics" element={<StatisticsPage />} />
        <Route path="client-admin/statistics/network" element={<NetworkStatistics />} />
        <Route path="client-admin/statistics/devices" element={<DeviceStatistics />} />
        <Route path="client-admin/statistics/performance" element={<PerformanceStatistics />} />
        <Route path="client-admin/infrastructure/device/:deviceId" element={<DeviceDetailsPage />} />
        <Route path="client-admin/tickets" element={<Navigate to="/client-admin/advanced-tickets" replace />} />
        
        {/* Service-specific pages */}
        <Route path="client-admin/email-security" element={<EmailSecurityPage />} />
        <Route path="client-admin/email-security/:alertId" element={<EmailSecurityPage />} />
        <Route path="client-admin/endpoint-protection" element={<EndpointProtectionPage />} />
        <Route path="client-admin/endpoint-protection/:alertId" element={<EndpointProtectionPage />} />
        <Route path="client-admin/cloud-security" element={<CloudSecurityPage />} />
        <Route path="client-admin/cloud-security/:alertId" element={<CloudSecurityPage />} />
        <Route path="client-admin/sd-wan" element={<SDWANPage />} />
        <Route path="client-admin/sd-wan/:alertId" element={<SDWANPage />} />
        <Route path="client-admin/vulnerability-scanning" element={<VulnerabilityScanningPage />} />
        <Route path="client-admin/vulnerability-scanning/:vulnId" element={<VulnerabilityScanningPage />} />
        <Route path="client-admin/patch-management" element={<PatchManagementPage />} />
        <Route path="client-admin/backup-dr" element={<BackupDRPage />} />
        <Route path="client-admin/soar" element={<SOARPage />} />
        <Route path="client-admin/dns-filtering" element={<DNSFilteringPage />} />
        <Route path="client-admin/firewall-mgmt" element={<FirewallManagementPage />} />
        <Route path="client-admin/vpn-gateway" element={<VPNGatewayPage />} />
        <Route path="client-admin/architecture" element={<ArchitectureDiagram />} />
        
        {/* Customer Retention Features */}
        <Route path="client-admin/value-dashboard" element={<CustomerValueDashboard />} />
        <Route path="client-admin/security-history" element={<SecurityHistoryTimeline />} />
        <Route path="client-admin/playbooks" element={<CustomPlaybooksLibrary />} />
        <Route path="client-admin/automation/scripts" element={<AutomationScriptsPage />} />
        <Route path="client-admin/automation/runbooks" element={<AutomationRunbooksPage />} />
        {/* Legacy routes → 301-style redirects (backward compatibility) */}
        <Route path="client-admin/device-statistics" element={<Navigate to="/client-admin/statistics/devices" replace />} />
        <Route path="client-admin/network-statistics" element={<Navigate to="/client-admin/statistics/network" replace />} />
        <Route path="client-admin/performance" element={<Navigate to="/client-admin/statistics/performance" replace />} />
        <Route path="client-admin/tickets" element={<Navigate to="/client-admin/advanced-tickets" replace />} />
        <Route path="client-admin/notification-engine" element={<Navigate to="/client-admin/notifications" replace />} />
        <Route path="client-admin/custom-playbooks" element={<Navigate to="/client-admin/playbooks" replace />} />
        <Route path="client-admin/value-and-loyalty" element={<Navigate to="/client-admin/dashboard" replace />} />
        <Route path="client-admin/overview" element={<Navigate to="/client-admin/dashboard" replace />} />
        <Route path="client-admin/compliance-reports" element={<ComplianceReports />} />
        <Route path="reports" element={<ReportsPage />} />

        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* Catch all - redirect to landing page */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </HashRouter>
    </ThemeProvider>
  );
}

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

export default function Breadcrumb() {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter(x => x);

  const buildBreadcrumbs = (): BreadcrumbItem[] => {
    const breadcrumbs: BreadcrumbItem[] = [{ label: 'Home', path: '/' }];

    if (pathnames.length === 0) return breadcrumbs;

    let currentPath = '';
    
    pathnames.forEach((pathname, index) => {
      currentPath += `/${pathname}`;
      
      // Format label
      let label = pathname
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());

      // Special cases
      if (pathname === 'client-admin') label = 'Client Admin';
      if (pathname === 'admin') label = 'Platform Admin';
      if (pathname === 'infrastructure') label = 'Infrastructure';
      if (pathname === 'statistics') label = 'Statistics';
      if (pathname === 'network') label = 'Network';
      if (pathname === 'devices') label = 'Devices';
      if (pathname === 'performance') label = 'Performance';
      if (pathname === 'alerts') label = 'Alerts';
      if (pathname === 'plans') label = 'Plans & Billing';
      if (pathname === 'users') label = 'Users';
      if (pathname === 'entitlements') label = 'My Services';
      if (pathname === 'widgets') label = 'Dashboard Builder';
      if (pathname.startsWith('device')) label = 'Device Details';
      if (pathname.startsWith('alert')) label = 'Alert Details';

      const isLast = index === pathnames.length - 1;
      
      breadcrumbs.push({
        label,
        path: isLast ? undefined : currentPath,
      });
    });

    return breadcrumbs;
  };

  const breadcrumbs = buildBreadcrumbs();

  return (
    <nav className="flex items-center space-x-2 text-sm mb-6">
      {breadcrumbs.map((breadcrumb, index) => (
        <React.Fragment key={index}>
          {index > 0 && <ChevronRight className="w-4 h-4 text-gray-500" />}
          {breadcrumb.path ? (
            <Link
              to={breadcrumb.path}
              className="text-gray-400 hover:text-cyan-400 transition-colors flex items-center gap-1"
            >
              {index === 0 && <Home className="w-4 h-4" />}
              {breadcrumb.label}
            </Link>
          ) : (
            <span className="text-[var(--ic-heading)] font-medium flex items-center gap-1">
              {index === 0 && <Home className="w-4 h-4" />}
              {breadcrumb.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

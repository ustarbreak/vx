import React from 'react';
import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="py-16 px-4 sm:px-6 lg:px-8 border-t border ic-card">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg ic-btn-primary flex items-center justify-center">
                <Zap className="w-4 h-4 ic-heading" />
              </div>
              <span className="font-bold ic-heading text-lg">Infracentra</span>
            </div>
            <p className="text-sm ic-muted mb-4">
              Unified Infrastructure & Security Orchestration Platform
            </p>
            <p className="text-xs ic-muted">
              Protecting organizations with AI-driven security operations.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold ic-text mb-3">Platform</h4>
            <ul className="space-y-2 text-xs ic-muted">
              <li><Link to="/service/threat-intel" className="hover:ic-link">Security</Link></li>
              <li><Link to="/service/network-monitoring" className="hover:ic-link">Networking</Link></li>
              <li><Link to="/service/patch-management" className="hover:ic-link">PSA</Link></li>
              <li><a href="#" className="hover:ic-link">API Docs</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold ic-text mb-3">Company</h4>
            <ul className="space-y-2 text-xs ic-muted">
              <li><a href="#" className="hover:ic-link">About</a></li>
              <li><a href="#" className="hover:ic-link">Careers</a></li>
              <li><a href="#" className="hover:ic-link">Blog</a></li>
              <li><a href="#" className="hover:ic-link">Contact</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold ic-text mb-3">Legal</h4>
            <ul className="space-y-2 text-xs ic-muted">
              <li><a href="#" className="hover:ic-link">Privacy</a></li>
              <li><a href="#" className="hover:ic-link">Terms</a></li>
              <li><a href="#" className="hover:ic-link">Security</a></li>
              <li><a href="#" className="hover:ic-link">SOC 2</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs ic-muted">© 2027 Infracentra. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span className="text-xs ic-muted">SOC 2 Type II</span>
            <span className="text-xs ic-muted">ISO 27001</span>
            <span className="text-xs ic-muted">GDPR</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

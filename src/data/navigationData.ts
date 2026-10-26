import { 
  Shield, Database, Network, Lock, Users, Cpu, Target, Workflow, 
  Eye, Briefcase, Server, Globe, BarChart3, Link2, TrendingUp,
  Building2, Award, BookOpen
} from 'lucide-react';

export interface NavSubItem {
  label: string;
  desc: string;
  icon: any;
  href?: string;
}

export interface NavSection {
  category: string;
  items: NavSubItem[];
}

export interface NavItem {
  label: string;
  href?: string;
  dropdown?: NavSection[];
}

export const navigationData: NavItem[] = [
  {
    label: 'Products',
    dropdown: [
      {
        category: 'Unified Security Platform',
        items: [
          { label: 'SIEM & Correlation Engine', desc: 'Real-time correlation with AI/ML normalization', icon: Database, href: '/service/threat-intel' },
          { label: 'Threat Intelligence', desc: 'Live IoC feeds, MISP & OTX connectors', icon: Target, href: '/service/threat-intel' },
          { label: 'Incident Response & Case Mgmt', desc: 'End-to-end IR workspace with audit trail', icon: Workflow, href: '/service/incident-response' },
          { label: 'SOAR Automation', desc: 'Playbooks, auto-containment, hours saved', icon: Shield, href: '/service/soar' },
          { label: 'Network Detection & Response', desc: 'SNMP/NetFlow monitoring, topology map', icon: Network, href: '/service/network-monitoring' },
          { label: 'Endpoint Protection (EDR)', desc: 'Agent health, isolation, remediation', icon: Cpu, href: '/service/endpoint-protection' },
          { label: 'Vulnerability & Patch Mgmt', desc: 'Scans, SLA-tracked remediation', icon: Lock, href: '/service/vuln-scanning' },
          { label: 'Compliance Mapper', desc: 'NIST, ISO 27001, SOC 2, RGPD evidence', icon: Eye, href: '/service/compliance' },
          { label: 'Advanced Ticketing & Projects', desc: 'SLA timers, attachments, project linking', icon: Briefcase, href: '/client-admin/advanced-tickets' },
        ]
      },
      {
        category: 'AI Triage & Prediction',
        items: [
          { label: 'AI Alert Triage', desc: 'Auto-scoring, dedup and noise reduction', icon: Cpu, href: '/service/incident-response' },
          { label: 'AI Risk Prediction', desc: 'Predictive scoring from logs & posture', icon: TrendingUp, href: '/reports' },
          { label: 'AI Prevention Plans', desc: 'Generated recommendations & action plans', icon: Target, href: '/service/analytics' },
          { label: 'Automated Threat Hunting', desc: 'Hypothesis-driven hunting summaries', icon: Eye, href: '/service/threat-intel' },
          { label: 'Smart Normalization', desc: 'ML enrichment of raw events at ingest', icon: Database, href: '/service/analytics' },
        ]
      }
    ]
  },
  {
    label: 'Services',
    dropdown: [
      {
        category: 'Partner Focused',
        items: [
          { label: 'MSSP/MDR Program', desc: 'Become an Infracentra partner', icon: Link2, href: '/mssp' },
          { label: 'Open Cybersecurity Alliance', desc: 'Join our partner ecosystem', icon: Globe, href: '/mssp' },
          { label: 'Cyber Insurance Program', desc: 'RiskShield partnership', icon: Shield, href: '/mssp' },
        ]
      },
      {
        category: 'Use Cases',
        items: [
          { label: 'Increase Revenue & Margin', desc: 'Grow your security business', icon: TrendingUp, href: '/mssp' },
          { label: 'Sell SOC-as-a-Service', desc: 'Offer managed SOC services', icon: Building2, href: '/mssp' },
          { label: 'Sell MDR-as-a-Service', desc: 'Managed detection & response', icon: Shield, href: '/mssp' },
          { label: 'Universal EDR', desc: 'Bring your own EDR platform', icon: Shield, href: '/service/endpoint-protection' },
        ]
      },
      {
        category: 'Networking & PSA',
        items: [
          { label: 'Network Monitoring', desc: '24/7 NMS with SNMP/NetFlow', icon: Network, href: '/service/network-monitoring' },
          { label: 'DNS Filtering', desc: 'Cloud-delivered DNS security', icon: Globe, href: '/service/dns-filtering' },
          { label: 'Firewall Management', desc: 'Multi-vendor firewall control', icon: Lock, href: '/service/firewall-mgmt' },
          { label: 'Patch Management', desc: 'Automated patch deployment', icon: Server, href: '/service/patch-management' },
          { label: 'Backup & DR', desc: 'Immutable backups and recovery', icon: Database, href: '/service/backup-dr' },
          { label: 'Cloud Security', desc: 'Multi-cloud CSPM', icon: Shield, href: '/service/cloud-security' },
        ]
      }
    ]
  },
  {
    label: 'Why Infracentra',
    dropdown: [
      {
        category: 'Market',
        items: [
          { label: 'About Us', desc: 'Moroccan cybersecurity experts — unified SecOps', icon: Building2, href: '/#about' },
          { label: 'Industry Recognition', desc: 'Fortinet, Microsoft & CrowdStrike alliances', icon: Award, href: '/#partners' },
          { label: 'Customer Stories', desc: 'Damanecash, Valoris System, Galenica…', icon: Users, href: '/#clients' },
          { label: 'Find a Partner', desc: 'Join the MSP white-label program', icon: Link2, href: '/mssp' },
        ]
      },
      {
        category: 'Industries',
        items: [
          { label: 'Financial & Fintech', desc: 'Payment-grade monitoring (Damanecash, Vivalis Salaf)', icon: Building2, href: '/#clients' },
          { label: 'Healthcare & Pharma', desc: 'Sensitive-data compliance (Galenica)', icon: Shield, href: '/#clients' },
          { label: 'Industry & Utilities', desc: 'OT-safe supervision (HydroPlus, Amigraph)', icon: Server, href: '/#clients' },
          { label: 'Technology & Editors', desc: 'Multi-tenant hosting posture (Valoris System)', icon: Cpu, href: '/#clients' },
          { label: 'Public & Education', desc: 'NIS2-style governance packs', icon: BookOpen, href: '/pricing' },
        ]
      },
      {
        category: 'Compare',
        items: [
          { label: 'Comparison Overview', desc: 'One platform vs. 6 point solutions', icon: BarChart3, href: '/pricing' },
          { label: 'vs Splunk Enterprise', desc: 'Same SIEM value at ~1/5 of ingest cost', icon: Database, href: '/pricing' },
          { label: 'vs Microsoft Sentinel', desc: 'Built-in SOAR + ticketing, no add-on graph', icon: Cpu, href: '/pricing' },
          { label: 'vs CrowdStrike Falcon', desc: 'Bring-your-own-EDR, we orchestrate it', icon: Shield, href: '/pricing' },
          { label: 'vs IBM QRadar', desc: 'Deployed in days, not months', icon: Server, href: '/pricing' },
        ]
      }
    ]
  },
  {
    label: 'MSSP/MDR',
    href: '/mssp'
  },
  {
    label: 'Pricing',
    href: '/pricing'
  },
  {
    label: 'Academy',
    href: '/academy'
  }
];

import { Shield, Lock, Eye, Cpu, Network, Database } from 'lucide-react';

export interface ComingSoonService {
  id: string;
  name: string;
  category: 'security' | 'networking' | 'psa' | 'ai';
  icon: string;
  tagline: string;
  description: string;
  expectedFeatures: string[];
  targetAudience: string;
  estimatedLaunch: string;
}

export const comingSoonServices: ComingSoonService[] = [
  {
    id: 'itdr',
    name: 'Identity Threat Detection & Response (ITDR)',
    category: 'security',
    icon: '🔐',
    tagline: 'Protect identities, prevent breaches',
    description: 'Advanced identity threat detection and response capabilities to protect against credential theft, lateral movement, and privilege escalation attacks.',
    expectedFeatures: [
      'Real-time identity monitoring',
      'Anomalous behavior detection',
      'Privileged access management',
      'Credential theft prevention',
      'Integration with Active Directory & Azure AD',
      'Automated response workflows',
    ],
    targetAudience: 'Enterprise security teams, Identity & Access Management teams',
    estimatedLaunch: 'Q2 2027',
  },
  {
    id: 'ai-investigator',
    name: 'AI Investigator',
    category: 'ai',
    icon: '🤖',
    tagline: 'Your AI-powered security analyst',
    description: 'Autonomous AI agent that investigates security incidents, correlates data across sources, and provides actionable recommendations without human intervention.',
    expectedFeatures: [
      'Autonomous incident investigation',
      'Natural language querying',
      'Automated root cause analysis',
      'Context enrichment from multiple sources',
      'Recommendation engine',
      'Integration with SOAR playbooks',
    ],
    targetAudience: 'SOC analysts, Security operations teams',
    estimatedLaunch: 'Q3 2027',
  },
  {
    id: 'isoc-platform',
    name: 'ISOC Platform',
    category: 'security',
    icon: '🏛️',
    tagline: 'Integrated Security Operations Center',
    description: 'Complete ISOC platform that unifies all security operations into a single pane of glass, providing end-to-end visibility and control across your entire security stack.',
    expectedFeatures: [
      'Unified security dashboard',
      'Multi-tenant architecture',
      'Role-based access control',
      'Customizable workflows',
      'Executive reporting',
      'Compliance automation',
    ],
    targetAudience: 'CISOs, Security directors, MSSP/MDR providers',
    estimatedLaunch: 'Q2 2027',
  },
  {
    id: 'threat-hunting-ai',
    name: 'AI-Powered Threat Hunting',
    category: 'ai',
    icon: '🎯',
    tagline: 'Proactive threat discovery',
    description: 'Machine learning-driven threat hunting that automatically identifies hidden threats, anomalies, and potential attack patterns across your environment.',
    expectedFeatures: [
      'Automated hypothesis generation',
      'ML-based anomaly detection',
      'Threat pattern recognition',
      'Custom hunting queries',
      'Scheduled hunting campaigns',
      'Integration with threat intelligence',
    ],
    targetAudience: 'Threat hunters, SOC analysts',
    estimatedLaunch: 'Q3 2027',
  },
  {
    id: 'cloud-native-security',
    name: 'Cloud-Native Application Security',
    category: 'security',
    icon: '☁️',
    tagline: 'Secure cloud-native applications',
    description: 'Comprehensive security for cloud-native applications including containers, Kubernetes, serverless functions, and microservices architectures.',
    expectedFeatures: [
      'Container security scanning',
      'Kubernetes runtime protection',
      'Serverless security monitoring',
      'CI/CD pipeline security',
      'Infrastructure as Code scanning',
      'Cloud workload protection',
    ],
    targetAudience: 'DevSecOps teams, Cloud architects',
    estimatedLaunch: 'Q4 2027',
  },
  {
    id: 'ot-security',
    name: 'OT/ICS Security',
    category: 'networking',
    icon: '🏭',
    tagline: 'Protect operational technology',
    description: 'Specialized security for operational technology and industrial control systems, ensuring safety and availability of critical infrastructure.',
    expectedFeatures: [
      'OT asset discovery',
      'Protocol analysis (Modbus, DNP3, etc.)',
      'Anomaly detection for OT networks',
      'Safety system monitoring',
      'Compliance with IEC 62443',
      'Integration with SCADA systems',
    ],
    targetAudience: 'Industrial security teams, OT administrators',
    estimatedLaunch: 'Q4 2027',
  },
];

export const getComingSoonById = (id: string): ComingSoonService | undefined => {
  return comingSoonServices.find(s => s.id === id);
};

export const getComingSoonByCategory = (category: string): ComingSoonService[] => {
  return comingSoonServices.filter(s => s.category === category);
};

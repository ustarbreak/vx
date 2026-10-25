// ---------------------------------------------------------------------------
// PARTNER PROGRAM (MSP) — single source of truth for the white-label partner
// demo world. Partners are NOT clients: they resell Infracentra under their
// own brand (logo, CNAME, custom domain). They manage THEIR OWN end-clients
// from their side; Infracentra only ensures maintenance + team training.
// Demo-only data (never used by the real backend).
// ---------------------------------------------------------------------------

export type PartnerStatus = 'prospect' | 'trial' | 'active' | 'suspended';

export interface PartnerLicense {
  id: string;
  plan: 'Starter' | 'Business' | 'Scale';
  client_seats: number;        // max end-client tenants the partner may run
  client_seats_used: number;
  device_allowance: number;    // monitored devices included
  devices_used: number;
  price_month_eur: number;     // wholesale paid to Infracentra
  resale_price_from_eur: number; // suggested retail per client/month
  margin_pct: number;          // current blended margin
  renews_on: string;           // ISO date
  services_included: string[]; // catalog service ids licensed
  ticketing: boolean;
}

export interface WhiteLabelConfig {
  brand_name: string;
  logo_data_url: string | null;   // uploaded by the partner
  primary_color: string;          // hex accent used across the portal
  custom_domain: string;          // e.g. soc.atlas.ma
  cname_target: string;           // what we publish on our side
  dns_status: 'not_configured' | 'pending_verification' | 'verified';
  email_sender: string;           // notifications sent "from" this address
  hide_infracentra: boolean;      // full white-label (no vendor mentions)
}

export interface PartnerEndClient {
  id: string;
  partner_id: string;
  name: string;
  industry: string;
  city: string;
  devices: number;
  users: number;
  plan: string;                   // retail plan sold by the partner
  monthly_mrr_eur: number;        // revenue the partner bills the end-client
  status: 'active' | 'onboarding' | 'suspended';
  since: string;
}

export interface Partner {
  id: string;                     // org-dw-N compatible when it mirrors a tenant
  code: string;
  company: string;
  country: string;
  contact_name: string;
  contact_email: string;
  phone: string;
  status: PartnerStatus;
  signed_on: string;
  tier: 'Silver' | 'Gold' | 'Platinum';
  license: PartnerLicense;
  branding: WhiteLabelConfig;
  end_clients: PartnerEndClient[];
  training: { completed: string[]; pending: string[] };
  support_sla: string;            // what WE owe the partner (maintenance)
}

const MA2026 = (d: string) => d;

export const partners: Partner[] = [
  {
    id: 'partner-atlas',
    code: 'MSP-ATL',
    company: 'Atlas Cyber Services',
    country: 'Maroc',
    contact_name: 'Rachid Alaoui',
    contact_email: 'rachid@atlascyber.ma',
    phone: '+212 522 450 120',
    status: 'active',
    signed_on: MA2026('2026-01-15'),
    tier: 'Gold',
    license: {
      id: 'lic-atlas-scale', plan: 'Scale',
      client_seats: 15, client_seats_used: 9,
      device_allowance: 750, devices_used: 412,
      price_month_eur: 1850, resale_price_from_eur: 390, margin_pct: 58,
      renews_on: '2027-01-15',
      services_included: ['all'], ticketing: true,
    },
    branding: {
      brand_name: 'AtlasSOC', logo_data_url: null, primary_color: '#0ea5e9',
      custom_domain: 'soc.atlascyber.ma', cname_target: 'edge.infracentra.io',
      dns_status: 'verified', email_sender: 'alerts@atlascyber.ma', hide_infracentra: true,
    },
    end_clients: [
      { id: 'ec-atlas-1', partner_id: 'partner-atlas', name: 'Comptoir Zerktouni', industry: 'Retail', city: 'Casablanca', devices: 64, users: 41, plan: 'Pro', monthly_mrr_eur: 520, status: 'active', since: '2026-02-01' },
      { id: 'ec-atlas-2', partner_id: 'partner-atlas', name: 'Clinique Al Hayat', industry: 'Santé', city: 'Rabat', devices: 88, users: 60, plan: 'Enterprise', monthly_mrr_eur: 780, status: 'active', since: '2026-02-18' },
      { id: 'ec-atlas-3', partner_id: 'partner-atlas', name: 'Transports Phénix SARL', industry: 'Logistique', city: 'Tanger', devices: 45, users: 22, plan: 'Pro', monthly_mrr_eur: 460, status: 'active', since: '2026-03-05' },
      { id: 'ec-atlas-4', partner_id: 'partner-atlas', name: 'Ecole Mohammadia', industry: 'Éducation', city: 'Marrakech', devices: 120, users: 300, plan: 'Enterprise', monthly_mrr_eur: 890, status: 'onboarding', since: '2026-09-20' },
    ],
    training: { completed: ['SOC L1 triage', 'Ticketing avancé', 'Reporting client'], pending: ['Playbooks SOAR', 'Hunting'] },
    support_sla: 'Réponse 4h ouvrée · Maintenance & mises à jour incluses',
  },
  {
    id: 'partner-oasis',
    code: 'MSP-OAS',
    company: 'Oasis IT Partners',
    country: 'Maroc',
    contact_name: 'Salma Idrissi',
    contact_email: 'salma@oasisit.ma',
    phone: '+212 528 223 410',
    status: 'active',
    signed_on: MA2026('2026-04-02'),
    tier: 'Silver',
    license: {
      id: 'lic-oasis-business', plan: 'Business',
      client_seats: 8, client_seats_used: 5,
      device_allowance: 300, devices_used: 187,
      price_month_eur: 950, resale_price_from_eur: 320, margin_pct: 47,
      renews_on: '2027-04-02',
      services_included: ['threat-intel', 'incident-response', 'network-monitoring', 'vulnerability-scanning', 'patch-management', 'backup-dr', 'endpoint-protection', 'dns-filtering', 'advanced-ticketing'],
      ticketing: true,
    },
    branding: {
      brand_name: 'OasisShield', logo_data_url: null, primary_color: '#10b981',
      custom_domain: 'shield.oasisit.ma', cname_target: 'edge.infracentra.io',
      dns_status: 'pending_verification', email_sender: 'noc@oasisit.ma', hide_infracentra: true,
    },
    end_clients: [
      { id: 'ec-oasis-1', partner_id: 'partner-oasis', name: 'Immobilière du Détroit', industry: 'Immobilier', city: 'Tanger', devices: 32, users: 18, plan: 'SME', monthly_mrr_eur: 280, status: 'active', since: '2026-05-10' },
      { id: 'ec-oasis-2', partner_id: 'partner-oasis', name: 'AgroExport Souss', industry: 'Agro-industrie', city: 'Agadir', devices: 58, users: 35, plan: 'Pro', monthly_mrr_eur: 490, status: 'active', since: '2026-05-22' },
      { id: 'ec-oasis-3', partner_id: 'partner-oasis', name: 'Filerie du Nord', industry: 'Industrie', city: 'Tétouan', devices: 71, users: 44, plan: 'Pro', monthly_mrr_eur: 510, status: 'active', since: '2026-06-14' },
    ],
    training: { completed: ['SOC L1 triage'], pending: ['Ticketing avancé', 'Reporting client', 'Playbooks SOAR'] },
    support_sla: 'Réponse 8h ouvrée · Maintenance & mises à jour incluses',
  },
  {
    id: 'partner-hekal',
    code: 'MSP-HEK',
    company: 'Hekal Systems',
    country: 'Sénégal',
    contact_name: 'Ousmane Diallo',
    contact_email: 'o.diallo@hekalsystems.sn',
    phone: '+221 33 862 10 44',
    status: 'trial',
    signed_on: MA2026('2026-09-28'),
    tier: 'Silver',
    license: {
      id: 'lic-hekal-starter', plan: 'Starter',
      client_seats: 3, client_seats_used: 1,
      device_allowance: 100, devices_used: 34,
      price_month_eur: 0, resale_price_from_eur: 290, margin_pct: 0,
      renews_on: '2026-10-28',
      services_included: ['threat-intel', 'network-monitoring', 'endpoint-protection', 'advanced-ticketing'],
      ticketing: true,
    },
    branding: {
      brand_name: 'HekalGuard', logo_data_url: null, primary_color: '#f59e0b',
      custom_domain: 'soc.hekalsystems.sn', cname_target: 'edge.infracentra.io',
      dns_status: 'not_configured', email_sender: '', hide_infracentra: false,
    },
    end_clients: [
      { id: 'ec-hekal-1', partner_id: 'partner-hekal', name: 'Banque Sahel Microfinance', industry: 'Finance', city: 'Dakar', devices: 34, users: 25, plan: 'Pro (trial)', monthly_mrr_eur: 0, status: 'onboarding', since: '2026-10-01' },
    ],
    training: { completed: [], pending: ['Onboarding plateforme', 'SOC L1 triage', 'Ticketing avancé'] },
    support_sla: 'Trial 30 j · accompagnement onboarding dédié',
  },
];

export function partnerById(id: string): Partner | undefined {
  return partners.find(p => p.id === id);
}

// Aggregated figures used on the platform-admin partner program dashboard.
export function partnerProgramStats() {
  const active = partners.filter(p => p.status === 'active');
  const totalEndClients = partners.reduce((a, p) => a + p.end_clients.length, 0);
  const totalDevices = partners.reduce((a, p) => a + p.license.devices_used, 0);
  const wholesaleMrr = active.reduce((a, p) => a + p.license.price_month_eur, 0);
  const retailMrr = partners.reduce((a, p) => a + p.end_clients.reduce((x, c) => x + c.monthly_mrr_eur, 0), 0);
  const pendingDns = partners.filter(p => p.branding.dns_status !== 'verified').length;
  return {
    partners_total: partners.length,
    partners_active: active.length,
    trials: partners.filter(p => p.status === 'trial').length,
    end_clients: totalEndClients,
    devices_managed: totalDevices,
    wholesale_mrr_eur: wholesaleMrr,
    retail_mrr_eur: retailMrr,
    channel_margin_pct: retailMrr ? Math.round(((retailMrr - wholesaleMrr) / retailMrr) * 100) : 0,
    white_labels_live: partners.filter(p => p.branding.hide_infracentra && p.branding.dns_status === 'verified').length,
    dns_pending: pendingDns,
  };
}

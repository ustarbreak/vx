import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
// Pricing V2 — single source of truth: src/data/pricingConfig.ts (mirror of
// backend/app/services/pricing_engine.py + core/pricing_config.json).
// NEVER hardcode prices here; every figure comes from quote() / PRICING_CONFIG_V2.
import {
  PRICING_CONFIG_V2, PACK_SERVICES, SERVICE_LABELS_FR, fmtMad,
  type PackId,
} from '../../data/pricingConfig';
import { quote, billableUnits, type QuoteInputs, type QuoteResult } from '../../services/pricingEngine';
import { demoTenants } from '../../data/demoWorld';
import {
  CreditCard, CheckCircle, XCircle, MessageCircle, Send, Bot, Crown,
  Star, Server, Zap, Calculator, ArrowRight, AlertTriangle, Gauge,
} from 'lucide-react';

/** Compact "usage vs. entitlement" progress row. Values come ONLY from real
 *  sources (live invoice / billing fields / plan config) — never fabricated. */
function UsageBar({ label, used, limit, unit, unavailable }: {
  label: string; used?: number | null; limit?: number | null; unit: string; unavailable?: boolean;
}) {
  const hasData = !unavailable && used != null && limit != null && Number.isFinite(used) && Number.isFinite(limit);
  if (!hasData) {
    return (
      <div className="bg-[var(--ic-surface-2)] rounded-lg p-4 flex items-center justify-between">
        <span className="text-gray-300 text-sm">{label}</span>
        <span className="text-gray-500 text-xs italic">Données indisponibles</span>
      </div>
    );
  }
  const pct = limit! > 0 ? Math.min((used! / limit!) * 100, 100) : (used! > 0 ? 100 : 0);
  const over = limit! > 0 && used! > limit!;
  const near = !over && limit! > 0 && used! / limit! >= 0.8;
  return (
    <div className="bg-[var(--ic-surface-2)] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-300 text-sm">{label}</span>
        <span className={`text-sm font-semibold ${over ? 'text-red-400' : near ? 'text-amber-400' : 'text-[var(--ic-heading)]'}`}>
          {(Math.round(used! * 10) / 10).toLocaleString('fr-FR')} / {(Math.round(limit! * 10) / 10).toLocaleString('fr-FR')} {unit}
        </span>
      </div>
      <div className="h-2 bg-[var(--ic-border)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : near ? 'bg-amber-400' : 'bg-cyan-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && (
        <p className="mt-2 text-xs text-red-400 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" /> Quota dépassé — contactez votre conseiller pour augmenter la limite.
        </p>
      )}
    </div>
  );
}

interface Message { id: string; role: 'user' | 'bot'; content: string; timestamp: Date }

const PACK_IDS: PackId[] = ['starter', 'pro', 'souverain'];

const PACK_META: Record<PackId, { name: string; blurb: string }> = {
  starter: {
    name: 'Starter',
    blurb: 'Le socle complet pour petits parcs — supervision des terminaux, vulnérabilités, correctifs, sauvegarde et conformité.',
  },
  pro: {
    name: 'Pro',
    blurb: 'Tout Starter plus la sécurité des messageries, la réponse aux incidents, la supervision réseau et les services offerts (DNS, analytique, threat intel, ticketing).',
  },
  souverain: {
    name: 'Souverain',
    blurb: 'Niveau entreprise : tout Pro plus SOAR, sécurité du cloud, gestion pare-feu, VPN zéro-confiance, SD-WAN et astreinte 24/7 incluse.',
  },
};

/** Demo tenants expose a physical endpoint count; map it to V2 asset classes
 *  (~80% heavy workstations, ~20% light mailboxes) exactly like demoMode.ts. */
function assetsFromEndpoints(n: number): QuoteInputs['assets'] {
  const heavy = Math.round(n * 0.8);
  return [{ class: 'workstation', qty: heavy }, { class: 'mailbox', qty: Math.max(0, n - heavy) }];
}

const LEGACY_PACK: Record<string, PackId> = { STARTER: 'starter', PRO: 'pro', SOUVERAIN: 'souverain' };

export default function ClientAdminPlans() {
  const { user, organization, backendMode } = useAuth();
  const [chatOpen, setChatOpen] = useState(false);
  const [serverInvoice, setServerInvoice] = useState<QuoteResult | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1', role: 'bot',
      content: "Bonjour ! Je suis l'assistant Infracentra. Posez-moi vos questions sur votre pack, vos unités-service ou votre facturation.",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');

  // ---- tenant billing facts (V2) -------------------------------------------
  const currentPack: PackId =
    (organization?.pack as PackId) ?? LEGACY_PACK[String(organization?.planTier ?? '')] ?? 'starter';
  // Legacy ANNUAL cycle maps to a 12-month contract in the V2 engine.
  const contractMonths: 0 | 12 | 24 | 36 =
    (organization?.contractMonths as 0 | 12 | 24 | 36) ??
    (String(organization?.billingCycle ?? 'MONTHLY').toUpperCase() === 'ANNUAL' ? 12 : 0);
  const assetCount = organization?.assetCount ?? organization?.endpointCount ?? 0;
  const memberCount = organization?.memberCount ?? 0;
  // Demo tenants expose their live SIEM consumption on the tenant record.
  const siemGbDayUsed = (organization as any)?.siem_gb_day_used
    ?? ((demoTenants.find(t => `org-dw-${t.id}` === organization?.id) as any)?.siemGbDayUsed ?? 0);

  const assets = useMemo(() => assetsFromEndpoints(assetCount), [assetCount]);
  const units = useMemo(() => billableUnits(PRICING_CONFIG_V2, assets), [assets]);

  // Live invoice: real mode → GET /api/pricing/invoice (the backend recomputes
  // server-side with pricing_engine.quote and returns a QuoteResult). Demo
  // mode → same pure engine, run locally against the bundled config.
  useEffect(() => {
    let alive = true;
    if (backendMode) {
      api.get<any>('/pricing/invoice')
        .then((d) => { if (alive && d && Array.isArray(d.lines)) setServerInvoice(d as QuoteResult); else if (alive) setServerInvoice(null); })
        .catch(() => { if (alive) setServerInvoice(null); });
    } else {
      setServerInvoice(null);
    }
    return () => { alive = false; };
  }, [backendMode, currentPack, contractMonths, assetCount]);

  const localInvoice = useMemo(() => quote({
    mode: 'pack', pack: currentPack, assets,
    siemGbDay: siemGbDayUsed || undefined,
    retentionDays: PRICING_CONFIG_V2.packs[currentPack].retentionDays,
    contractMonths,
  }), [currentPack, assets, contractMonths, siemGbDayUsed]);

  const invoice = serverInvoice ?? localInvoice;

  // ---- usage vs. entitlement ------------------------------------------------
  // Every number below is derived from an authoritative source: the live
  // invoice (GET /pricing/invoice, recomputed server-side by pricing_engine),
  // the tenant billing record, or PRICING_CONFIG_V2 pack definitions.
  // When a value cannot be determined we render "indisponible" — never a fake zero.
  const packDef = PRICING_CONFIG_V2.packs[currentPack];
  // Billable units actually invoiced (server truth when available) vs. the
  // pack's unit-range entitlement (maxUnits === null → no upper bound).
  const invoicedUnits = serverInvoice?.totals.units ?? (serverInvoice ? null : invoice.totals.units);
  const seatLimit = (organization as any)?.seat_limit ?? null;
  const seatsUsed = (organization as any)?.seats_used ?? organization?.memberCount ?? null;
  // SIEM entitlement for the current pack: min + per-unit quota over billed units.
  const siemEntitledGb = packDef.siemQuota.min > 0
    ? packDef.siemQuota.min + packDef.siemQuota.perUnit * Math.max(0, invoicedUnits ?? units)
    : null;
  const backupEntitledGb = packDef.backupQuotaGbPerUnit * Math.max(0, invoicedUnits ?? units);

  // Preview what switching pack / contract length would cost (same engine).
  const previewFor = (pack: PackId, months: 0 | 12 | 24 | 36): QuoteResult => quote({
    mode: 'pack', pack, assets,
    siemGbDay: siemGbDayUsed || undefined,
    retentionDays: PRICING_CONFIG_V2.packs[pack].retentionDays,
    contractMonths: months,
  });

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: inputMessage, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'bot',
        content: getBotResponse(inputMessage), timestamp: new Date(),
      }]);
    }, 800);
  };

  const getBotResponse = (message: string): string => {
    const m = message.toLowerCase();
    const def = PRICING_CONFIG_V2.packs[currentPack];
    if (m.includes('price') || m.includes('tarif') || m.includes('cost') || m.includes('combien') || m.includes('prix')) {
      return `Vous êtes sur le pack ${PACK_META[currentPack].name} : ${def.price} MAD HT par unité-service par mois. Avec ${units.toFixed(1)} unité(s)-service facturée(s), votre base mensuelle est de ${fmtMad(invoice.totals.monthly_excl_vat_mad)} HT (${fmtMad(invoice.totals.monthly_incl_vat_mad)} TTC).`;
    }
    if (m.includes('upgrade') || m.includes('change') || m.includes('switch') || m.includes('changer')) {
      return 'Vous pouvez changer de pack depuis les cartes ci-dessus — le changement est proraté sur la facture suivante. Les packs sont éligibles selon la taille du parc : Starter 10 à 49 unités, Pro dès 50, Souverain dès 100.';
    }
    if (m.includes('unit') || m.includes('unité') || m.includes('unite') || m.includes('asset') || m.includes('actif')) {
      return 'Les serveurs, machines virtuelles, postes, portables et pare-feu comptent 1 unité-service ; commutateurs, routeurs, points d’accès, boîtes aux lettres et équipements IoT comptent 0,5. Le détail figure dans la section « Comment nous comptons les actifs » de la page Tarifs.';
    }
    if (m.includes('billing') || m.includes('payment') || m.includes('invoice') || m.includes('facture') || m.includes('paiement')) {
      return 'Vos factures sont générées chaque mois à partir du décompte exact des actifs supervisés. TVA 20 % appliquée sur le total HT ; carte bancaire ou virement acceptés ; toutes les factures sont téléchargeables ci-dessous.';
    }
    if (m.includes('seat') || m.includes('technician') || m.includes('siège') || m.includes('siege')) {
      return 'Le nombre de sièges techniciens n’est pas facturé séparément en V2 : il dépend du pack et de votre contrat. Contactez votre administrateur plateforme pour ajuster les accès.';
    }
    if (m.includes('agent') || m.includes('deploy') || m.includes('déploy')) {
      return 'Déployez les agents de collecte depuis Inventaire → Agents de collecte : une commande à copier-coller par machine, installation à distance, sans visite sur site.';
    }
    return "J'ai bien noté votre question — je vous mets en relation avec notre équipe support. Puis-je vous aider avec autre chose ?";
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Abonnement &amp; facturation</h1>
          <p className="text-gray-400 mt-1">
            Facturation par unité-service (actif lourd = 1, actif léger = 0,5) — moteur de tarifs V2, version {PRICING_CONFIG_V2.version}.
          </p>
        </div>
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white flex items-center gap-2"
        >
          <MessageCircle className="w-5 h-5" /> Discuter avec le support
        </button>
      </div>

      {/* Current Subscription Summary */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-6 h-6" />
              <span className="text-blue-100 text-sm">
                Pack actuel · {contractMonths > 0 ? `Contrat ${contractMonths} mois` : 'Sans engagement'}
              </span>
            </div>
            <h2 className="text-3xl font-bold">{PACK_META[currentPack].name}</h2>
            <p className="text-blue-100 mt-2 flex items-center gap-2 flex-wrap">
              <Server className="w-4 h-4" />
              {PRICING_CONFIG_V2.packs[currentPack].price} MAD / unité-service / mois HT
              <ArrowRight className="w-4 h-4" />
              <span className="font-semibold">
                {invoice.eligible ? `${fmtMad(invoice.totals.monthly_incl_vat_mad)} TTC /mois` : 'Parc hors éligibilité du pack'}
              </span>
            </p>
            <p className="text-blue-100 text-sm mt-1">
              {assetCount} actifs supervisés → {units.toFixed(1)} unité(s)-service facturée(s)
            </p>
            {!invoice.eligible && invoice.reason && (
              <p className="flex items-center gap-2 text-amber-200 text-sm mt-2">
                <AlertTriangle className="w-4 h-4" /> {invoice.reason}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-blue-100 text-sm">Prochaine date de facturation</p>
            <p className="text-2xl font-bold">
              {new Date(Date.now() + 30 * 864e5).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
            <p className="text-blue-100 text-sm mt-2">{memberCount} membres de l’équipe</p>
          </div>
        </div>
        {invoice.eligible && invoice.lines.length > 1 && (
          <div className="mt-4 border-t border-white/20 pt-3 grid gap-1 text-sm">
            {invoice.lines.filter(l => l.kind !== 'vat').map((ln, i) => (
              <div key={i} className="flex justify-between text-blue-50">
                <span>{ln.label_fr}{ln.qty !== undefined ? ` × ${ln.qty}` : ''}</span>
                <span>{fmtMad(ln.amount_mad)}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold text-white pt-1">
              <span>Total mensuel HT</span>
              <span>{fmtMad(invoice.totals.monthly_excl_vat_mad)}</span>
            </div>
            <div className="flex justify-between text-blue-100">
              <span>TVA ({Math.round(PRICING_CONFIG_V2.vat * 100)} %)</span>
              <span>{fmtMad(invoice.totals.vat_mad)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Contract-length toggle (V2: 0 / 12 / 24 / 36 months) */}
      <div className="flex items-center justify-center gap-4 flex-wrap">
        {([0, 12, 24, 36] as const).map((mo) => {
          const rate = PRICING_CONFIG_V2.contractDiscount[String(mo)] ?? 0;
          return (
            <button
              key={mo}
              onClick={() => { /* display-only preview; actual change goes through sales/support */ }}
              className={`px-6 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                mo === contractMonths ? 'bg-blue-600 text-white' : 'bg-[var(--ic-surface)] text-gray-400 hover:bg-[var(--ic-surface-2)]'
              }`}
            >
              {mo === 0 ? 'Mensuel' : `${mo} mois`}
              {rate > 0 && <span className="text-xs bg-green-500 text-white px-2 py-1 rounded-full">−{Math.round(rate * 100)} %</span>}
              {mo === PRICING_CONFIG_V2.onboardingWaivedAtMonths && (
                <span className="text-xs bg-emerald-600 text-white px-2 py-1 rounded-full">Mise en service offerte</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Packs Grid — prices straight from PRICING_CONFIG_V2 + quote() */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PACK_IDS.map((pack) => {
          const meta = PACK_META[pack];
          const def = PRICING_CONFIG_V2.packs[pack];
          const isCurrent = pack === currentPack;
          const preview = previewFor(pack, contractMonths);
          const range = def.maxUnits === null ? `dès ${def.minUnits} unités` : `${def.minUnits} à ${def.maxUnits} unités`;
          return (
            <div
              key={pack}
              className={`rounded-xl p-6 border-2 transition-all ${
                isCurrent ? 'bg-blue-600/10 border-blue-500' : 'bg-[var(--ic-surface)] border-[var(--ic-border)] hover:border-blue-400'
              }`}
            >
              {pack === 'pro' && !isCurrent && (
                <div className="flex items-center gap-2 mb-4">
                  <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                  <span className="text-yellow-500 text-sm font-semibold">RECOMMANDÉ</span>
                </div>
              )}
              <h3 className="text-2xl font-bold text-[var(--ic-heading)] mb-1">{meta.name}</h3>
              <p className="text-gray-400 text-xs mb-4">{meta.blurb}</p>
              <div className="mb-2">
                <span className="text-4xl font-bold text-[var(--ic-heading)]">{def.price} MAD</span>
                <span className="text-gray-400 ml-2">/ unité-service / mois HT</span>
              </div>
              <div className="text-[11px] text-gray-400 mb-6">Éligibilité : {range} · votre parc : {units.toFixed(1)} unités</div>
              <ul className="space-y-3 mb-4">
                {PACK_SERVICES[pack].slice(0, 8).map((sid) => (
                  <li key={sid} className="flex items-start gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-300 text-sm">{SERVICE_LABELS_FR[sid] ?? sid}</span>
                  </li>
                ))}
                {PACK_SERVICES[pack].length > 8 && (
                  <li className="text-gray-400 text-sm">+ {PACK_SERVICES[pack].length - 8} autres services inclus</li>
                )}
              </ul>
              <ul className="space-y-1 mb-6 text-xs text-gray-400">
                <li>SIEM : {def.siemQuota.min > 0 ? `${def.siemQuota.min} Go/jour inclus (+${def.siemQuota.perUnit} Go/unité)` : 'non inclus (options payantes)'}</li>
                <li>Rétention : {def.retentionDays} jours · Sauvegarde : {def.backupQuotaGbPerUnit} Go/unité</li>
                <li>Support : {def.support} · Mise en service : {fmtMad(def.onboarding)}</li>
              </ul>
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
                <Calculator className="w-4 h-4" />
                Votre parc ({units.toFixed(1)} unités) →{' '}
                {preview.eligible
                  ? <span className="text-[var(--ic-heading)] font-semibold">{fmtMad(preview.totals.monthly_incl_vat_mad)} TTC/mois</span>
                  : <span className="text-amber-400 font-medium">non éligible</span>}
              </div>
              {isCurrent ? (
                <button className="w-full bg-[var(--ic-surface-2)] text-gray-400 py-3 rounded-lg font-medium cursor-not-allowed flex items-center justify-center gap-2">
                  <Zap className="w-4 h-4" /> Pack actuel
                </button>
              ) : preview.eligible ? (
                <button className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-all">
                  Passer à {meta.name}
                </button>
              ) : (
                <button disabled title={preview.reason}
                  className="w-full bg-[var(--ic-surface-2)] text-gray-500 py-3 rounded-lg font-medium cursor-not-allowed flex items-center justify-center gap-2">
                  <XCircle className="w-4 h-4" /> {preview.reason ?? 'Non éligible'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Usage vs. Entitlement — live capacity tracking (sources: GET /pricing/invoice,
          tenant billing record, PRICING_CONFIG_V2 pack definitions). Server-side
          entitlement enforcement is authoritative; this panel only surfaces it. */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <Gauge className="w-5 h-5 text-cyan-400" /> Utilisation vs. droits du pack {PACK_META[currentPack].name}
          </h2>
          <span className="text-xs text-gray-500">
            Source : {(serverInvoice ? 'facture serveur (GET /pricing/invoice)' : 'calcul local — moteur de facturation V2')}
            {siemGbDayUsed > 0 ? ' · consommation SIEM : enregistrement de facturation du tenant' : ''}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UsageBar
            label="Unités facturées vs. éligibilité du pack"
            used={invoicedUnits ?? null}
            limit={packDef.maxUnits ?? null}
            unit="unités"
            unavailable={invoicedUnits == null}
          />
          <UsageBar
            label="SIEM Go/jour consommés vs. quota inclus"
            used={siemGbDayUsed || null}
            limit={siemEntitledGb ?? ((organization as any)?.siem_limit_gb ?? null)}
            unit="Go/jour"
            unavailable={!siemGbDayUsed && siemEntitledGb == null && !(organization as any)?.siem_limit_gb}
          />
          <UsageBar
            label="Sièges techniciens utilisés vs. limite"
            used={seatsUsed}
            limit={seatLimit}
            unit="sièges"
            unavailable={seatLimit == null}
          />
          <UsageBar
            label="Sauvegarde incluse (quota contractuel)"
            used={null}
            limit={backupEntitledGb}
            unit="Go"
            unavailable
          />
        </div>
        <p className="mt-3 text-[11px] text-gray-500">
          Les quotas sont contrôlés côté serveur (moteur de facturation + application des limites d’entitlements) ;
          ce panneau reflète ces mêmes règles. Une valeur « indisponible » signifie que la source de données ne fournit
          pas cette mesure — elle n’est jamais inventée ni remplacée par zéro.
        </p>
      </div>

      {/* Billing History */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-4">Historique de facturation</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)]">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Date</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Description</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Unités</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Montant</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Statut</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Facture</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((back) => {
                const d = new Date(); d.setMonth(d.getMonth() - back - 1);
                const total = invoice.totals.monthly_incl_vat_mad;
                return (
                  <tr key={back} className="border-b border-[var(--ic-border)]">
                    <td className="py-3 px-4 text-gray-300">{d.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="py-3 px-4 text-gray-300">Pack {PACK_META[currentPack].name} — {contractMonths > 0 ? `contrat ${contractMonths} mois` : 'mensuel'}</td>
                    <td className="py-3 px-4 text-gray-300">{invoice.totals.units.toFixed(1)}</td>
                    <td className="py-3 px-4 text-[var(--ic-heading)] font-semibold">{invoice.eligible ? fmtMad(total) : '—'}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">Payée</span>
                    </td>
                    <td className="py-3 px-4"><button className="text-blue-400 hover:text-blue-300 text-sm">Télécharger</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Methods */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-[var(--ic-heading)]">Moyens de paiement</h2>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm font-medium">
            Ajouter un moyen de paiement
          </button>
        </div>
        <div className="space-y-3">
          <div className="bg-[var(--ic-surface-2)] rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CreditCard className="w-8 h-8 text-blue-400" />
              <div>
                <p className="text-[var(--ic-heading)] font-medium">•••• •••• •••• 4242</p>
                <p className="text-gray-400 text-sm">Expire 12/2027</p>
              </div>
            </div>
            <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">Par défaut</span>
          </div>
        </div>
      </div>

      {/* Chat Widget */}
      {chatOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] shadow-2xl flex flex-col z-50">
          <div className="bg-blue-600 rounded-t-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white font-semibold">Support Infracentra</p>
                <p className="text-blue-100 text-xs">En ligne</p>
              </div>
            </div>
            <button onClick={() => setChatOpen(false)} className="text-white hover:bg-white/20 p-1 rounded">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg p-3 ${
                  message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-[var(--ic-surface-2)] text-gray-300'
                }`}>
                  <p className="text-sm">{message.content}</p>
                  <p className="text-xs opacity-70 mt-1">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--ic-border)] p-4">
            <div className="flex gap-2">
              <input
                type="text" value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Prix, facturation, packs…"
                className="flex-1 bg-[var(--ic-surface-2)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={handleSendMessage} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

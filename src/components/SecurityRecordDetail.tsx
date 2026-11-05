import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, ShieldAlert } from 'lucide-react';
import OpsConsole from './OpsConsole';
import type { ActionGroup } from '../services/securityOps';

export interface SecurityRecordField {
  label: string;
  value: string | number | boolean | null | undefined;
}

interface Props {
  backPath: string;
  service: string;
  serviceTitle: string;
  recordId: string;
  recordType: string;
  subtitle: string;
  severity?: string;
  status?: string;
  sourceLabel: string;
  fields: SecurityRecordField[];
  groups: ActionGroup[];
  contextParams: Record<string, string>;
  recommendations: string[];
  notFound?: boolean;
}

export default function SecurityRecordDetail({
  backPath, service, serviceTitle, recordId, recordType, subtitle, severity, status,
  sourceLabel, fields, groups, contextParams, recommendations, notFound = false,
}: Props) {
  const navigate = useNavigate();
  const visibleFields = fields.filter((field) => field.value !== undefined && field.value !== null && field.value !== '');
  return (
    <div className="p-6 space-y-6">
      <button onClick={() => navigate(backPath)} className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300">
        <ArrowLeft className="w-4 h-4" /> Back to {serviceTitle}
      </button>
      {notFound ? (
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-8">
          <h1 className="text-xl font-semibold text-[var(--ic-heading)]">Record not found</h1>
          <p className="mt-2 text-sm text-gray-400">This record is not available in the current tenant feed. It may have been removed, or the integration may not have returned it.</p>
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
            <header className="p-6 border-b border-[var(--ic-border)] flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500">{serviceTitle} · {recordType} · {recordId}</p>
                <h1 className="mt-2 text-2xl font-bold text-[var(--ic-heading)]">{subtitle}</h1>
                <p className="mt-1 text-xs text-gray-500">Evidence source: {sourceLabel}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {severity && <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs text-orange-300">{severity}</span>}
                {status && <span className="rounded-full border border-[var(--ic-border)] px-3 py-1 text-xs text-gray-300">{status}</span>}
              </div>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-6">
              {visibleFields.map((field) => (
                <div key={field.label} className="rounded-lg border border-[var(--ic-border)] p-4 min-w-0">
                  <p className="text-xs text-gray-500">{field.label}</p>
                  <p className="mt-1 break-words text-sm font-medium text-[var(--ic-heading)]">{String(field.value)}</p>
                </div>
              ))}
            </div>
            <div className="px-6 pb-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ic-heading)]"><ShieldAlert className="w-4 h-4 text-cyan-400" /> Analyst investigation checklist</h2>
              <ol className="mt-3 list-decimal list-inside space-y-2 text-sm text-gray-300">
                {recommendations.map((item) => <li key={item}>{item}</li>)}
              </ol>
            </div>
          </section>
          <OpsConsole service={service} title={`${serviceTitle} actions for ${recordId}`} groups={groups} contextParams={contextParams} logHeader={`${recordType} ${recordId} · ${subtitle}`} />
        </>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldCheck, Lock, Database, GitBranch, HardDriveDownload, Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import { getServiceContent, type AttackScenario, type ServiceContent } from '../data/serviceContent';

interface ServiceVisualsProps {
  serviceId: string;
}

// ── tiny in-view animation hook ──────────────────────────────────────────────
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } }, { threshold: 0.25 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, inView };
}

const actorColor: Record<string, string> = {
  attacker: 'border-red-500/40 bg-red-500/10 text-red-300',
  platform: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  you: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
};
const actorLabel: Record<string, string> = { attacker: 'Attacker', platform: 'Infracentra', you: 'You' };

// ── Animated attack scenario (only rendered for attack-protection services) ──
export function AttackScenarioBlock({ scenario }: { scenario: AttackScenario }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [playing, setPlaying] = useState(true);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!inView || !playing) return;
    if (step >= scenario.steps.length) return;
    const t = setInterval(() => setStep(s => s + 1), 1600);
    return () => clearInterval(t);
  }, [inView, playing, step, scenario.steps.length]);

  const replay = () => { setStep(0); setPlaying(true); };
  const done = step >= scenario.steps.length;

  return (
    <div ref={ref} className="bg-[#0a1120] border border-red-500/25 rounded-2xl p-6 sm:p-8 overflow-hidden relative">
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at top left, rgba(239,68,68,0.08), transparent 55%)' }} />
      <div className="flex items-start justify-between gap-4 mb-6 relative">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-2xl">{scenario.threatIcon}</div>
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <h3 className="text-lg font-bold text-white">Live attack scenario</h3>
            </div>
            <p className="text-sm text-red-200/80 font-medium">{scenario.title}</p>
            <p className="text-xs text-slate-400 mt-0.5">{scenario.subtitle}</p>
          </div>
        </div>
        <button onClick={done ? replay : () => setPlaying(p => !p)}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-300 text-xs font-semibold hover:bg-red-500/10 transition-colors">
          {done ? (<><Play className="w-3.5 h-3.5" /> Replay</>) : (playing ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Play</>)}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative">
        {/* Timeline */}
        <div className="space-y-2">
          {scenario.steps.map((st, i) => (
            <div key={i}
              className={`flex items-start gap-3 p-3 rounded-xl border-l-[3px] border transition-all duration-700 ${i <= step ? 'opacity-100 translate-x-0' : 'opacity-20 translate-x-2'} ${actorColor[st.actor]}`}
              style={{ borderLeftWidth: 3 }}>
              <span className="text-[10px] font-mono font-bold pt-0.5 w-14 flex-shrink-0 opacity-80">{st.time}</span>
              <div className="min-w-0">
                <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border border-current/40">{actorLabel[st.actor]}</span>
                <p className="text-sm text-slate-200 mt-1 leading-snug">{st.text}</p>
              </div>
            </div>
          ))}
        </div>
        {/* Terminal */}
        <div className="rounded-xl border border-slate-700/60 bg-black/60 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700/60">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" /><span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" /><span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
            <span className="ml-2 text-[11px] font-mono text-slate-500">infracentra · event trace</span>
          </div>
          <pre className="p-4 text-[11px] sm:text-xs leading-relaxed font-mono text-emerald-300/90 overflow-x-auto whitespace-pre min-h-[220px]">{
            // reveal the trace progressively with the timeline
            scenario.code.split('\n').slice(0, Math.max(2, Math.round(((Math.min(step, scenario.steps.length - 1) + 1) / scenario.steps.length) * scenario.code.split('\n').length))).join('\n')
          }</pre>
        </div>
      </div>
    </div>
  );
}

// ── Animated data-flow diagram (storage/protection story) ────────────────────
export function DataFlowBlock({ content }: { content: ServiceContent }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const ds = content.dataStory;
  const kindStyle: Record<string, string> = {
    source: 'from-slate-600 to-slate-700 border-slate-500/40',
    collector: 'from-cyan-600 to-blue-700 border-cyan-400/40',
    core: 'from-indigo-600 to-purple-700 border-indigo-400/40',
    storage: 'from-emerald-600 to-teal-700 border-emerald-400/40',
    sink: 'from-amber-600 to-orange-700 border-amber-400/40',
  };
  const animLabel: Record<string, string> = {
    pipeline: 'telemetry flows → stored → served',
    backup: 'copies sealed → locked → restorable',
    isolation: 'tenant shards → never cross',
    encryption: 'encrypt at edge → opaque in transit',
  };

  return (
    <div ref={ref} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
          {ds.animation === 'backup' ? <HardDriveDownload className="w-5 h-5 text-emerald-400" /> : ds.animation === 'isolation' ? <ShieldCheck className="w-5 h-5 text-emerald-400" /> : ds.animation === 'encryption' ? <Lock className="w-5 h-5 text-emerald-400" /> : <Database className="w-5 h-5 text-emerald-400" />}
        </div>
        <div>
          <h3 className="text-xl font-bold text-[var(--ic-heading)]">{ds.headline}</h3>
          <p className="text-xs text-[var(--ic-muted)] font-mono">{animLabel[ds.animation]}</p>
        </div>
      </div>

      {/* horizontal flow */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 md:gap-0 mb-8 overflow-x-auto pb-2">
        {ds.flowNodes.map((n, i) => {
          const edge = ds.flowEdges[i];
          return (
            <React.Fragment key={n.id}>
              <div className={`flex-shrink-0 min-w-[130px] rounded-xl border bg-gradient-to-br ${kindStyle[n.kind]} p-3 text-center transition-all duration-700 ${inView ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`} style={{ transitionDelay: `${i * 350}ms` }}>
                <p className="text-sm font-bold text-white">{n.label}</p>
                <p className="text-[10px] text-white/70 mt-0.5">{n.sub}</p>
              </div>
              {edge && (
                <div className="flex md:flex-col items-center justify-center px-2 flex-shrink-0 py-1">
                  <div className="w-full md:w-16 h-px relative overflow-hidden bg-slate-600/50">
                    <span className={`absolute top-0 left-0 h-px w-6 bg-cyan-400 ${inView ? 'ic-slideflow' : ''}`} />
                  </div>
                  <span className="text-[9px] font-mono text-cyan-300/80 whitespace-nowrap mt-1 text-center">{edge.label}</span>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      <ul className="space-y-2.5">
        {ds.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--ic-text)]">
            <GitBranch className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />{b}
          </li>
        ))}
      </ul>
      <style>{`@keyframes icSlideflow { 0% { left: -25%; } 100% { left: 100%; } } .ic-slideflow { animation: icSlideflow 1.6s linear infinite; }`}</style>
    </div>
  );
}

// ── Auto-rotating image slider (≥3 slides per service) ───────────────────────
export function ServiceSlider({ images }: { images: ServiceContent['gallery'] }) {
  const [idx, setIdx] = useState(0);
  const paused = useRef(false);
  useEffect(() => {
    const t = setInterval(() => { if (!paused.current) setIdx(i => (i + 1) % images.length); }, 5000);
    return () => clearInterval(t);
  }, [images.length]);

  return (
    <div className="relative rounded-2xl overflow-hidden border border-[var(--ic-border)] group"
      onMouseEnter={() => (paused.current = true)} onMouseLeave={() => (paused.current = false)}>
      <div className="flex transition-transform duration-700 ease-out" style={{ transform: `translateX(-${idx * 100}%)` }}>
        {images.map((img, i) => (
          <div key={i} className="w-full flex-shrink-0 relative">
            <img src={img.url} alt={img.title} loading="lazy" className="w-full h-64 sm:h-80 object-cover" onError={(e) => { (e.target as HTMLImageElement).src = `https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=700&fit=crop`; }} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            <div className="absolute bottom-0 p-5">
              <h4 className="text-base font-bold text-white">{img.title}</h4>
              <p className="text-xs text-slate-300">{img.caption}</p>
            </div>
          </div>
        ))}
      </div>
      <button aria-label="Previous" onClick={() => setIdx(i => (i - 1 + images.length) % images.length)}
        className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 border border-white/20 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"><ChevronLeft className="w-5 h-5" /></button>
      <button aria-label="Next" onClick={() => setIdx(i => (i + 1) % images.length)}
        className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 border border-white/20 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"><ChevronRight className="w-5 h-5" /></button>
      <div className="absolute bottom-3 right-4 flex gap-1.5">
        {images.map((_, i) => (
          <button key={i} aria-label={`Slide ${i + 1}`} onClick={() => setIdx(i)} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-6 bg-cyan-400' : 'w-2.5 bg-white/40 hover:bg-white/70'}`} />
        ))}
      </div>
    </div>
  );
}

export default function ServiceVisuals({ serviceId }: ServiceVisualsProps) {
  const content = getServiceContent(serviceId);
  if (!content) return null;

  return (
    <div className="space-y-12">
      {/* Image slider — every service gets its own gallery */}
      <div>
        <h3 className="text-2xl font-bold text-[var(--ic-heading)] mb-6">See it working</h3>
        <ServiceSlider images={content.gallery} />
      </div>

      {/* Attack scenario — ONLY on services that protect from attacks, custom per service */}
      {content.protectsFromAttacks && content.attackScenario && <AttackScenarioBlock scenario={content.attackScenario} />}

      {/* Data protection / storage animated technical block — every service */}
      <DataFlowBlock content={content} />
    </div>
  );
}

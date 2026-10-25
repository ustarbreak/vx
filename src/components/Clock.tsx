import React, { useState, useEffect } from 'react';
import { Clock as ClockIcon } from 'lucide-react';

export default function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)]">
      <ClockIcon className="w-4 h-4 text-cyan-400" />
      <div className="flex flex-col">
        <span className="text-xs font-mono text-[var(--ic-heading)]">{formatTime(time)}</span>
        <span className="text-[10px] text-[var(--ic-muted)]">{formatDate(time)}</span>
      </div>
    </div>
  );
}

'use client';
// Copies one piece of an approved proposal to the clipboard, for Dane to
// paste into Upwork himself (task 3.4). The server decides whether it is
// offered at all (only on a proposal approved right now, lib/sent.ts
// `copyText`); this only does the copying.
//
// The app is opened over plain http on the Mini (http://mac-mini.local:4280),
// where browsers often switch off the modern clipboard, so it falls back to
// the older select-and-copy way, and says plainly if neither worked.
import { useState } from 'react';

async function copy(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older way.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Tell the activity log he copied it (app/api/copied). A failure here never gets in his way. */
function record(proposal: number, part: string): void {
  const body = new FormData();
  body.set('proposal', String(proposal));
  body.set('part', part);
  fetch('/api/copied', { method: 'POST', body }).catch(() => {});
}

export function CopyButton({ text, label, proposal, part }: { text: string; label: string; proposal: number; part: string }) {
  const [said, setSaid] = useState<'copied' | 'failed' | null>(null);
  const onClick = async () => {
    const ok = await copy(text);
    setSaid(ok ? 'copied' : 'failed');
    if (ok) record(proposal, part);
  };
  return (
    <span>
      <button type="button" data-copy={label} onClick={onClick}>
        Copy {label}
      </button>{' '}
      <span aria-live="polite" style={{ color: said === 'failed' ? '#a40000' : '#2a6a34', fontSize: '0.9em' }}>
        {said === 'copied' ? 'Copied.' : said === 'failed' ? 'Could not copy: select the text below and copy it by hand.' : ''}
      </span>
    </span>
  );
}

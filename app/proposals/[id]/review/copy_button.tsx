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

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [said, setSaid] = useState<'copied' | 'failed' | null>(null);
  return (
    <span>
      <button type="button" data-copy={label} onClick={async () => setSaid((await copy(text)) ? 'copied' : 'failed')}>
        Copy {label}
      </button>{' '}
      <span aria-live="polite" style={{ color: said === 'failed' ? '#a40000' : '#2a6a34', fontSize: '0.9em' }}>
        {said === 'copied' ? 'Copied.' : said === 'failed' ? 'Could not copy: select the text below and copy it by hand.' : ''}
      </span>
    </span>
  );
}

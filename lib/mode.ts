/**
 * Demo or Manual: which database the app shows (UB-27).
 *
 * Demo mode uses its own file, demo.sqlite, next to the real app.sqlite in
 * the data folder (lib/db.ts). Two files are what keep made-up data and
 * Dane's real jobs from ever mixing: nothing written in Demo mode can land in
 * the real file, and the other way round.
 *
 * The mode is kept in a small file in the same data folder, mode.json, so
 * every page and form route reads the same answer. No file, or anything in it
 * but {"mode":"demo"}, means Manual: the app behaves exactly as before.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { dataDir } from './db.ts';

type Env = Record<string, string | undefined>;

export type Mode = 'demo' | 'manual';
export const MODE_FILE_NAME = 'mode.json';
export const DEMO_BANNER_TEXT = 'DEMO MODE: made-up data, nothing here is real';
/** The banner's button that empties the demo database and loads the made-up data again (lib/demo.ts). */
export const RELOAD_LABEL = 'Reload demo data';

export function modePath(env: Env = process.env): string {
  return join(dataDir(env), MODE_FILE_NAME);
}

/** The mode in force. Manual unless the mode file says demo. */
export function currentMode(env: Env = process.env): Mode {
  let text: string;
  try {
    text = readFileSync(/*turbopackIgnore: true*/ modePath(env), 'utf8');
  } catch {
    return 'manual';
  }
  try {
    return (JSON.parse(text) as { mode?: unknown })?.mode === 'demo' ? 'demo' : 'manual';
  } catch {
    return 'manual';
  }
}

/** Switch the mode. Written to a side file and renamed, so a reader never sees half a file. */
export function setMode(mode: Mode, env: Env = process.env): void {
  const path = modePath(env);
  mkdirSync(dataDir(env), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode }) + '\n');
  renameSync(tmp, path);
}

/** What a form value asks for, or null for anything else. */
export function readMode(value: unknown): Mode | null {
  return value === 'demo' || value === 'manual' ? value : null;
}

/**
 * The banner every page shows while Demo is on, and the switch (offered only
 * to a signed-in browser; the route refuses anyone else anyway). Built
 * without JSX so the tests can render it directly.
 */
export function ModeBar({ mode, canSwitch = true }: { mode: Mode; canSwitch?: boolean }): ReactElement | null {
  const other: Mode = mode === 'demo' ? 'manual' : 'demo';
  const label = other === 'demo' ? 'Switch to Demo mode' : 'Switch back to Manual mode';
  const form = createElement(
    'form',
    { method: 'post', action: '/api/mode', style: { display: 'inline' } },
    createElement('input', { type: 'hidden', name: 'mode', value: other }),
    createElement('button', { type: 'submit' }, label),
  );
  if (mode !== 'demo') {
    if (!canSwitch) return null;
    return createElement('div', { 'data-mode': 'manual', style: { float: 'right', marginRight: '1rem' } }, form);
  }
  return createElement(
    'div',
    {
      role: 'status',
      'data-mode': 'demo',
      style: {
        background: '#ffd400', color: '#000', border: '3px solid #000', fontWeight: 700,
        padding: '0.75rem 1rem', margin: '-2rem -2rem 1.5rem', fontSize: '1.1rem',
      },
    },
    createElement('span', { style: { marginRight: '1rem' } }, DEMO_BANNER_TEXT),
    canSwitch ? form : null,
    canSwitch
      ? createElement(
          'form',
          { method: 'post', action: '/api/demo', style: { display: 'inline', marginLeft: '0.5rem' } },
          createElement('button', { type: 'submit' }, RELOAD_LABEL),
        )
      : null,
  );
}

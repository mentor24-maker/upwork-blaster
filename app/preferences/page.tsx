import { appDatabase } from '../../lib/app_db.ts';
import {
  DEFAULT_SETTINGS,
  LIST_KEYS,
  listPreferenceVersions,
  MAX_ITEM_LENGTH,
  preferencesFormMessage,
  WEIGHT_KEYS,
  WEIGHT_LABELS,
  type ListKey,
} from '../../lib/preferences.ts';
import { WeightsTotal } from './weights_total.tsx';

const field = { display: 'block', marginBottom: '1rem' } as const;
const input = { display: 'block', width: '100%', maxWidth: '40rem', marginTop: '0.25rem' } as const;
const savedAt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' });

const LISTS: Record<ListKey, { label: string; hint: string }> = {
  themes: { label: 'Search themes', hint: 'The kinds of work you want, one per line.' },
  requiredTech: { label: 'Technology you work in', hint: 'One per line, e.g. Next.js. A job that needs these is a better fit.' },
  unsupportedTech: { label: 'Technology you do not take', hint: 'One per line. A job that requires one of these is excluded.' },
  exclusions: {
    label: 'Hard exclusions',
    hint: 'One rule per line, e.g. "The post forbids AI tools". A job that meets one is set aside, not scored.',
  },
};

export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[]; error?: string | string[]; total?: string | string[] }>;
}) {
  const { saved, error, total } = await searchParams;
  const versions = listPreferenceVersions(appDatabase());
  const current = versions[0];
  const settings = current?.settings ?? DEFAULT_SETTINGS;
  const message = preferencesFormMessage(error, total);
  const justSaved = typeof saved === 'string' && current && String(current.version) === saved ? current : undefined;

  return (
    <main>
      <p>
        <a href="/">← Home</a>
      </p>
      <h1>Preferences</h1>
      <p>
        {current ? (
          <>
            In force: <strong>version {current.version}</strong>, saved {savedAt(current.createdAt)} Mountain time.
          </>
        ) : (
          <>Nothing saved yet. The form starts from the plan’s suggested themes and weights.</>
        )}{' '}
        Each save is a new version, so a score can always say which preferences it used.
      </p>
      {justSaved ? <p role="status">Saved as version {justSaved.version}.</p> : null}
      {message ? (
        <p role="alert" style={{ color: '#a40000' }}>
          {message}
        </p>
      ) : null}

      <form method="post" action="/api/preferences">
        {LIST_KEYS.map((key) => (
          <label key={key} style={field}>
            {LISTS[key].label}
            <span style={{ display: 'block', color: '#666', fontSize: '0.9em' }}>{LISTS[key].hint}</span>
            <textarea style={input} name={key} rows={6} defaultValue={settings[key].join('\n')} />
          </label>
        ))}

        <fieldset style={{ maxWidth: '40rem', marginBottom: '1rem' }}>
          <legend>Ranking weights (they must add up to 100)</legend>
          {WEIGHT_KEYS.map((key) => (
            <label key={key} style={field}>
              {WEIGHT_LABELS[key]}
              <input
                style={{ ...input, width: '6rem' }}
                type="number"
                name={`weight_${key}`}
                min={0}
                max={100}
                step={1}
                required
                defaultValue={settings.weights[key]}
              />
            </label>
          ))}
          <WeightsTotal names={WEIGHT_KEYS.map((k) => `weight_${k}`)} />
        </fieldset>
        <p style={{ color: '#666', fontSize: '0.9em' }}>Each line can be up to {MAX_ITEM_LENGTH} characters.</p>
        <button type="submit">Save as a new version</button>
      </form>

      {versions.length > 0 ? (
        <>
          <h2>Versions</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {versions.map((v) => (
              <li key={v.version} id={`version-${v.version}`} style={{ borderTop: '1px solid #ddd', padding: '0.5rem 0' }}>
                <strong>Version {v.version}</strong>
                {v === current ? ' (in force)' : ''} · saved {savedAt(v.createdAt)} Mountain time
                <div style={{ color: '#666', fontSize: '0.9em' }}>
                  Weights {WEIGHT_KEYS.map((k) => v.settings.weights[k]).join(' / ')} · {v.settings.themes.length} theme(s) ·{' '}
                  {v.settings.exclusions.length} exclusion(s)
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}

// The Portfolio page's forms post here: add, save (edit) and remove. A plain
// form post, the same as the job and preferences forms: the gate
// (lib/gate.ts) has already refused it unless the browser is signed in, and
// the tests can call it directly. The form's `action` field says which.
import { appDatabase } from '../../../lib/app_db.ts';
import { redirect } from '../../../lib/gate.ts';
import { addEntry, readPortfolioForm, removeEntry, updateEntry } from '../../../lib/portfolio.ts';

const back = (query: string) => redirect(`/portfolio?${query}`, 303);

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back('error=no-project');
  }
  const action = form.get('action');
  const rawId = form.get('id');
  const id = typeof rawId === 'string' && /^\d{1,12}$/.test(rawId) ? Number(rawId) : null;

  if (action === 'remove') {
    if (id === null || !removeEntry(appDatabase(), id)) return back('error=not-found');
    return back('removed=1');
  }

  const read = readPortfolioForm(form);
  if (action === 'update') {
    if (id === null) return back('error=not-found');
    if (!read.ok) return back(`error=${read.error}&id=${id}`);
    if (!updateEntry(appDatabase(), id, read.entry)) return back('error=not-found');
    return back(`saved=${id}`);
  }

  if (!read.ok) return back(`error=${read.error}`);
  return back(`saved=${addEntry(appDatabase(), read.entry)}`);
}

// The review screen's Copy buttons post here after they copy, so the
// activity log (lib/activity.ts) can say Dane copied an approved proposal.
// Copying itself happens in his browser; this only records that he did. It
// writes nothing else, and only for a proposal that is approved right now
// (the only time Copy is offered, lib/sent.ts `copyText`).
import { logProposalActivity } from '../../../lib/activity.ts';
import { appDatabase } from '../../../lib/app_db.ts';
import { copyText } from '../../../lib/sent.ts';
import { isSignedIn } from '../../../lib/session.ts';

const done = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  if (!isSignedIn(request)) return done(401);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return done(400);
  }
  const p = form.get('proposal');
  const part = form.get('part');
  if (typeof p !== 'string' || !/^\d{1,12}$/.test(p)) return done(400);
  if (typeof part !== 'string' || !/^(text|answer-\d{1,2})$/.test(part)) return done(400);
  const db = appDatabase();
  const copied = copyText(db, Number(p));
  if (!copied) return done(404);
  const n = part === 'text' ? 0 : Number(part.slice('answer-'.length));
  if (n > copied.answers.length) return done(400);
  const what = n === 0 ? 'the text' : `answer ${n}`;
  logProposalActivity(db, Number(p), 'Dane', 'proposal-copied', (name) => `You copied ${what} of the approved proposal for ${name}.`);
  return done(204);
}

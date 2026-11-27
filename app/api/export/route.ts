// "Export my data" on the home page (task 4.6): one JSON file holding every
// job, decision, evaluation, preferences version, portfolio entry, proposal,
// approval, sent record and pipeline step. It reads the database only.
//
// The gate (lib/gate.ts) refuses a signed-out request before it gets here,
// and this route checks the sign-in again itself: a signed-out visitor gets
// an empty 401, never a file.
import { appDatabase } from '../../../lib/app_db.ts';
import { exportFileName, exportText } from '../../../lib/export.ts';
import { isSignedIn } from '../../../lib/session.ts';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  if (!isSignedIn(request)) return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const now = new Date();
  return new Response(exportText(appDatabase(), now), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${exportFileName(now)}"`,
      'Cache-Control': 'no-store',
    },
  });
}

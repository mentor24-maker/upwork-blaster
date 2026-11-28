## 2026-11-27 — Create user documentation for the system (#28)

Upwork Blaster now has a user guide, `docs/USER_GUIDE.md`, written for Dane
rather than for a programmer, and the README points to it.

The first part covers setup: the app's address on the home network, how to
install, check and restart it on the Mini, the three secrets it needs from
Doppler (by name only, never the values) and what each one is for, the
nightly copy of the database, and where the logs are.

The second part walks every screen in the order he uses them, from signing
in and setting preferences, through adding a job, the ranked inbox, editing
and approving a draft, copying it into Upwork himself, to tracking the job on
the pipeline board. Each section says what the screen is for, what to do, and
what he should see. It ends with the app's hard rules (it never sends
anything to Upwork for him) and a short list of fixes for when something goes
wrong.

Every button name and command in it was checked against the app as it is
today. Nothing in the app itself changed.

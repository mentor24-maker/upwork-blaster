## 2026-11-27 — Demo mode shows the made-up jobs and portfolio, so Dane can try the app without real data (#30)

Switching Demo mode on used to show an empty app. Now it fills the separate
demo database with the same made-up jobs and portfolio the end-to-end test
uses, already scored: the bakery dashboard comes out on top, and the casino
and WordPress jobs are set apart. Dane can click through the Inbox, a
proposal and the Pipeline without touching a single real job.

Nothing calls the AI while loading (the made-up jobs carry their own
answers), and the loader refuses outright to write to the real database.
Loading again never makes duplicates. A "Reload demo data" button on the
yellow Demo banner wipes the demo database and starts it fresh, for a clean
run-through.

After review, three fixes. The Activity page used to say *Dane* saved the
made-up jobs, portfolio and preferences; every one of those lines now says
the app did it. A load that broke partway used to leave a half-filled demo
database that later loads never repaired; now a load either lands whole or
not at all. And a failed Reload used to leave Demo mode empty; now emptying
and reloading happen together, so a failed Reload leaves everything as it was.

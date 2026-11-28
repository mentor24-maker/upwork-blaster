## 2026-11-27 — Add a Demo mode that loads the made-up fixture jobs (#27)

The app now has a Demo / Manual switch. Demo mode keeps its own separate
database file next to the real one, so anything made up and saved while trying
the app out can never land among Dane's real jobs, and real jobs never show up
in Demo. While Demo is on, every page shows a bright yellow "DEMO MODE: made-up
data, nothing here is real" banner with a button back to Manual, so it is
impossible to forget which one you're in. With nothing switched, the app works
exactly as before. Starting the app updates both database files, and the
nightly backup still copies only the real one. The demo database starts empty
for now; the next ticket (UB-30) fills it with the made-up jobs and portfolio.

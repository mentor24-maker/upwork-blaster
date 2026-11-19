## 2026-11-19 — Add the app's database file with a daily copy (#8)

The app now has a place to keep Dane's data: one database file on the Mini,
in `~/upwork-blaster-data`, deliberately outside the repository so it can
never be published with the code. It is built from small numbered recipes
("migrations") kept in the repository. Each one runs once, so starting the app
again never changes or loses anything. The first recipe makes the three tables the
next screens need: the jobs Dane pastes in, his search preferences (kept as
versions, so old scores can say which settings they used), and the portfolio
work proposals are allowed to mention.

Every morning at 3:15 the Mini makes a copy of the file beside it, checks the
copy opens cleanly, and keeps the last 14. If a copy fails its check, the old
copies stay put. `npm run db:backup` makes one by hand and prints its name
and size.

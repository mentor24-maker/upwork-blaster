## 2026-11-19 — Add a form to paste and save an Upwork job post (#9)

Dane can now put a job he found on Upwork into the app. A New Job page takes
the job's link, title and text, plus the other things he can see on the post
(budget, fixed price or hourly, when it was posted, what it says about the
client, and how many Connects it costs). Anything he leaves blank is kept as
"unknown" rather than guessed. A Saved jobs page lists them, newest first.

The app recognises a job by the id Upwork puts in its link, so pasting the
same job twice, even from a slightly different link, is refused with a plain
message instead of making a second copy. Both pages sit behind the app's
password. Nothing is fetched from Upwork: Dane pastes, the app keeps it.

This is the first real screen of the app, and the place the later scoring and
ranking steps will read their jobs from.

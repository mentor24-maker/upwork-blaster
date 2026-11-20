## 2026-11-19 — Fill in a pasted job's fields with AI, marking gaps unknown (#12)

When Dane saves a job he pasted from Upwork, the app now asks Claude to read
the post and fill in the fields he left blank: the budget, whether it is fixed
price or hourly, when it was posted, what it says about the client, and how
many Connects it costs. A field the post does not state stays "unknown"; the
AI is told never to guess, and a number it reports that is not in the post is
thrown away. Anything Dane typed himself is never replaced.

A job post is written by a stranger, and one could try to give the AI orders.
So the post is handed to Claude only as a quotation, clearly marked as data,
and Claude's answer is checked before anything is stored. All it can ever do
is fill those five blank fields.

Every AI call's cost is now written down, and the home page shows a running
total. If a call ever uses a model whose price is not on record, the total
says so plainly instead of counting it as free.

The AI connection was copied from StarCaster rather than written again, as
the plan decided, trimmed to Claude only. It needs the Anthropic key in
Doppler, which is not there yet; until it is, saving still works and each job
says plainly that the AI is not set up.

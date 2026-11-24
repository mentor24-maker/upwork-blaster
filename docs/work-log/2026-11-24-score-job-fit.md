## 2026-11-24 — Score each job's fit with readable reasons (#13)

Every job you save now gets a fit score from 0 to 100, with the reasons
written out. The score comes from plain rules, not AI, so the same job always
scores the same, and every point traces back to something in the post or in
your preferences.

The score is built from the five things the hand-off weighs: how well the job
fits what you want and have shown, the budget, how clear the post is, what is
known about the client, and the chance of continuing work. Each part says what
it found, what it did not know, and how sure it is. When a fact is missing,
like the budget or the client's history, the app does not guess. That part
sits in the middle, is listed as unknown, and the score says it is less sure.

Hard exclusions stay separate from the score. A job that needs a technology
you don't take, or that forbids AI tools, gets no score at all. It says which
of your rules it met and is set aside, never ranked. A new client or an
unverified payment method is only flagged for you to look at, not excluded.

Each score is saved along with the preferences version it used, so an old
score still explains itself after you change your settings. Showing the
scores is the next piece of work, the inbox.

After review: the "forbids AI" rule was too eager. A post about a banking
platform, or one saying "we are not a big team, but we build AI products",
was set aside as if it banned AI. Now only a "no" or "don't use" that is
about the AI itself counts ("no AI", "do not use ChatGPT", "AI tools are not
allowed"). A rule that mentions AI without banning it, like "AI chatbot
projects", is now flagged for you to read yourself instead of being quietly
passed. Clients with "2,000 hires" are read as 2,000, not 0; a budget of
"$40-60/hr" is read as the whole range; and if scoring ever fails, the job
you saved still lands on the list instead of an error page.

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

After the second review: more ordinary posts were being set aside by
mistake, and now are not. "No AI experience required" is about what you need
to know, not a ban. "We do not use AI yet and want you to add ChatGPT" is the
client describing themselves (exactly the kind of job you want), not a rule
for you. And a technology that is also a plain word, like Go or Swift, no
longer matches "ready to go live" or "Swift delivery appreciated"; it has to
be written as the name of the technology. A rule worded "Clients who don't
allow AI" is now understood as a ban rule. A theme like "Custom web
applications" now needs its words together in one sentence, so "customer",
"website" and "applicant" scattered through a post no longer count. Clarity
counts "feature" and "features" as one thing. And if scoring a job ever
fails, the jobs page now says so in red on that job, instead of the failure
only reaching a log you would never see.

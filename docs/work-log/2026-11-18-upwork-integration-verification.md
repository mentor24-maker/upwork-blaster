## 2026-11-18 — Write down what Upwork officially allows Upwork Blaster to do (#5)

Before anything in Upwork Blaster talks to Upwork, Dane needed a written
answer to one question: what does Upwork itself allow? This change adds that
answer, `docs/upwork-integration-verification.md`. Every point in it is taken
from Upwork's own published pages and carries a link and the date it was read.

The news is good. Upwork now runs an official, free connection built for AI
apps (its "MCP server"). Through it an app can search jobs and submit a
proposal, but only after the person confirms twice. Upwork's own terms list
both as allowed. So the document recommends building the live job search
(Epic 5) and a smaller version of sending proposals (Epic 6) than the plan
first expected, because Upwork's two-step confirmation already does much of
the safety work.

It also lists the rules that change the design. Search only when Dane asks,
never on a timer. Keep Upwork data only while he is working on it. Never
build an AI memory of past jobs. Be careful about the AI ranking jobs by its
own criteria. Questions the terms don't settle are listed as unclear rather
than guessed, and the ones that are his to decide are marked.

Upwork's website turns away automated readers, so the pages were read from
the Internet Archive's copies and from Upwork's own GitHub instead of being
forced open.

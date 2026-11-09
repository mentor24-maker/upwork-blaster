## 2026-11-08 — Produce development plan for Upwork Blaster based on hand-off doc. (#2)

Dane had ChatGPT write a long hand-off doc describing Upwork Blaster. This
change reads that doc and turns it into a plan he can approve before any
building starts (`docs/DEVELOPMENT_PLAN.md`).

The plan keeps every safety rule in the hand-off: no scraping, Dane picks
the jobs, and nothing goes to Upwork without his approval. What it changes
is the order and the size of the work. First comes a tool he can use by
hand: paste a job in, get a ranked card and an honest draft, then copy it
into Upwork himself. Anything that talks to Upwork comes later. The heavy
machinery the hand-off designed up front waits until it is actually needed.
The plan lists the decisions only Dane can make, each with a recommendation,
and lays the work out as six epics of one-pull-request tasks.

The hand-off itself stays out of the repository because the repository is
public. A small test makes sure the plan keeps its five sections and never
picks up a dollar figure.

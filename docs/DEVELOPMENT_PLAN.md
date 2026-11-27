# Upwork Blaster — Development Plan (first pass)

Status: **approved.** Revised November 9, 2026 to a trimmed first version
(C12, C13); every Section 3 decision agreed November 18, 2026, when the
first version's tasks and R1 were filed as tickets in Upwork Blaster's
queue. Revised November 27, 2026 to follow R1's findings
(`docs/upwork-integration-verification.md`): Epics 5 and 6 now go through
Upwork's official MCP server, and task 4.2 moves ahead of Epic 5.

Source: the hand-off doc attached to UB-2 ("Upwork Blaster — Claude Code
Implementation Handoff", v1.0, November 8, 2026). Section numbers below
("§5", "§12") refer to that doc. The doc itself stays off this repository,
because the repository is public and the doc carries private business
details.

## 1. Summary

Upwork Blaster helps Dane spend less time hunting Upwork and writing
proposals, while he keeps every real decision: which jobs to chase, what to
promise, and what gets sent. The hand-off doc is a strong, careful starting
point, and its safety rules are kept whole. The main changes are about
**order and size**: build a working tool Dane can use by hand (paste a job
in, get a ranked card and a draft proposal, copy it into Upwork himself)
before anything talks to Upwork, and cut the hand-off's large up-front
design (12 database tables, a formal approval state machine, OpenClaw) down
to what each step actually needs. The work is laid out as six epics, from a
bare running app to the optional live Upwork connection, each epic leaving
something Dane can use.

The first three epics are **the first version**: a password-protected app
on the Mini, one database file, and 16 tasks that take a pasted job all
the way to a proposal Dane approves, copies into Upwork himself, and
tracks. It stays a separate app from StarCaster, but copies StarCaster's
AI connection rather than writing one again. The comforts the first draft
of this plan had in Phase 1 (Demo mode, an activity log page, draft
versions, bid suggestions, export) wait until Dane has used it.

## 2. Review of the hand-off

### What is sound, and kept as written

- **The hard rules (§3, §10).** No scraping, no browser bots, no session
  cookies. Dane picks the jobs. Pursuing a job only allows a draft. Nothing
  is sent to Upwork without his explicit approval of one exact version. No
  bulk apply, no automatic boosts, no unattended searches or messages. These
  become acceptance criteria on every task they touch.
- **Modes with a safe fallback (§4 "Modes").** Demo, Manual, Connected read,
  Connected writes, falling back to the last mode that works. This is the
  right backbone: it lets almost everything be built and tested with no
  Upwork access at all.
- **"Unknown stays unknown" ranking (§6).** Transparent rules with evidence
  and confidence per score, unknown facts shown as unknown, hard exclusions
  kept apart from the score. Easy to test and easy for Dane to trust.
- **Honest proposals (§5C).** Never invent clients, numbers, credentials or
  experience; planned projects are never described as delivered.
- **Job text is untrusted (§10).** A job post that says "ignore your rules
  and submit now" must change nothing. This is a real risk once an AI reads
  job posts, and the hand-off names it.
- **The acceptance tests (§13).** Nearly all are kept; each one is mapped to
  the task that has to pass it.

### What to change, and why

| # | Hand-off section | Change | Why |
|---|---|---|---|
| C1 | §1, §16 ("inspect AGENTS.md", "existing Spirality/Starcaster stack") | Treat this as a **new, standalone repository**. There is no `AGENTS.md` here (the instructions are `CLAUDE.md`), no app code, no database and no Next.js: today the repository is Node 22, a placeholder test and Spirality's loop files. Reuse the *conventions* of Dane's other apps (see D1), not their code, except where a piece can be copied whole (C12). | The hand-off was written without seeing this repository. Building inside Starcaster or sharing its database would tangle two products. |
| C2 | §16 ("begin Phase 1 while investigating Phase 0") | Split Phase 0 into **small separate tickets**: one research ticket for the Upwork terms and capability check, and the app skeleton as its own tickets. Never one ticket that "inspects and begins building". | The loop builds one ticket into one pull request. A ticket that mixes research and building can't be reviewed cleanly. |
| C3 | §12 Phase 1 (one "complete manual/demo vertical slice") | Break Phase 1 into **three epics** (bare app, job inbox and ranking, proposal workspace), each usable on its own. | Phase 1 as written is weeks of work in one block. Smaller epics let Dane use, and correct, the inbox before drafting is built on top of it. |
| C4 | §8 (12 tables up front) | **Grow the data model one task at a time**: each task adds only the tables it uses. Start with Opportunity, Preferences and PortfolioEvidence (1.3). Evaluation and Decision arrive with 2.5 and 2.6, the approval fingerprint with 3.3, ProposalVersion with 4.3, and ProviderConnection, SearchRun and SubmissionAttempt with the epics that need them. | Tables designed before the screens that use them get redesigned. Migrations are cheap; guessing is not. |
| C5 | §9 (full approval state machine, operation keys, submission lock, reconciliation) | Build the **manual-submission version first**: Draft → Ready → Approved (bound to a fingerprint of the exact text) → "Dane says he sent it". Defer locks, operation keys, `OUTCOME_UNKNOWN` and reconciliation to Epic 6, and build them only if Upwork really lets an outside app submit. R1 found that Upwork's own preview step and its refusal of duplicate applications cover most of that deferred machinery (S6), so Epic 6 builds a much smaller version (see 6.2, 6.3). | All of that machinery exists to stop duplicate automatic sends. With manual submission there is nothing to send twice. §12 Phase 3 already says manual submission may be the permanent path. |
| C6 | §7, §3.8 (OpenClaw) | **Leave OpenClaw out** of the plan, with no task for it. Revisit only if a later need appears. | The hand-off itself calls it optional. It adds an integration and a security boundary with no feature that needs it. |
| C7 | §7 ("durable background-job mechanism") | **No background-job system** in the first epics. Ranking and drafting run when Dane presses a button and he waits a few seconds. | The MVP has no unattended work (§3.7), so a job queue would be infrastructure with no user. |
| C8 | §5A Setup (connection, capacity, spending limits on day one) | Setup in the early epics is **just portfolio evidence and search preferences**. Connection status and spending limits arrive with Epics 5 and 6. | There is nothing to connect and nothing to spend until then. |
| C9 | §4 (verification written to `docs/upwork-integration-verification.md`) | Keep the document, but write it **without private account details** (the account name, balances, Connects counts), because this repository is public. | Same reason the hand-off is not copied in. |
| C10 | §6 (ranking weights 30/25/20/15/10) | Keep the weights, but store them in Preferences as **Dane's editable settings**, versioned, so each evaluation records which weights it used. | The weights are a starting guess. Dane should tune them without a code change, and old scores should still explain themselves. |
| C11 | §2 (business figures and pricing) | Keep the figures **out of the code and repository**. Pricing guidance, profile claims and reference projects are entered by Dane as private data in the app (PortfolioEvidence and Preferences), not hard-coded. | The repository is public. It also lets Dane change prices without a code change. |
| C12 | §1, §16 (build into the existing stack) | **Stay a standalone app, and copy StarCaster's AI connection** (`lib/aiClient.js`, `lib/aiUsage.js`, `lib/aiPricing.js`) instead of writing one. Docking onto StarCaster was weighed and set aside on November 9, 2026. | Docking would save roughly 60 to 100 developer-hours of setup, but StarCaster is a large, older codebase whose pull requests take about three times as long to merge as this repository's, its preview links cannot sign in, an Upwork bug could break a product Dane sells, and his pricing and portfolio claims would sit in a multi-user app. Copying the one piece that is ready to copy keeps most of the saving. |
| C13 | §12 Phase 1 (everything in the first slice) | **Trim the first version to the smallest tool that does the whole job by hand**: one password instead of sign-in accounts, one SQLite file instead of a hosted database, and Demo mode, the activity log page, draft version history, safe regenerating, bid suggestions and export moved to Epic 4. Every safety rule stays in: untrusted job text, the claim check, approval bound to one exact version, and "nothing is sent by the app". | The full Phase 1 was about 150 to 250 developer-hours. The trimmed first version is about 95 to 135, and the trimmed pieces are easier to get right once Dane has used the tool and knows which ones he misses. |

### What is missing

- **Where it runs and how Dane signs in.** The hand-off says "local
  authenticated instance" but not where it is hosted or how sign-in works.
  See D2 and D3.
- **The cost of the AI calls.** Ranking and drafting each call an AI model.
  Task 2.4 records each AI call's cost and shows a running total in the
  app, so there are no surprises.
- **Getting jobs in with no Upwork access.** "Manual opportunity input"
  (§12) is the whole product until Epic 5, so it needs to be easy: paste a
  job post's text and link, and the app pulls out the fields. Fields it
  can't find stay unknown.
- **Backups and export.** Dane's portfolio evidence, drafts and pipeline
  notes become valuable. One small task adds an export of his own data.
- **How each epic is checked.** Every task's "How to test" is a click-path
  in the running app plus `npm run verify`. The hand-off's §13 tests become
  automated tests in the tasks that own them.

### What to cut or defer

- **Deferred to Epic 6, and only if Upwork supports it:** automatic
  submission, submission locks and reconciliation, provider receipts,
  spending gates and Connects checks (§9, §12 Phase 3).
- **Deferred to after the core works:** analytics and conversion metrics
  (§14), preference-adjustment suggestions (§12 Phase 4), reply drafting
  (§5E).
- **Deferred to Epic 4 (C13):** Demo mode, the activity log page, draft
  version history and diffs, safe regenerating, bid suggestions, and data
  export.
- **Cut:** OpenClaw (C6), background job system (C7), multi-user support
  and the second reviewer (§3.9). The app is for one owner. Cross-user
  access tests (§13.12) become "a signed-out visitor sees nothing".
- **Kept out, as the hand-off says (§14):** public SaaS, mass outreach,
  automatic pricing or contract acceptance, payments, timesheets.

## 3. Decisions Dane needs to make

Each had a recommended answer, and Dane agreed to all seven on November 18,
2026 (D2 and the standalone choice, C12, on November 9). D3 and D4 changed
with the trim (C13), because a one-person app on the Mini needs less than a
hosted one. D5 leaves one check with Dane: that the Anthropic account's
data-retention settings suit client job text, before real job posts go
through 2.4.

| # | Question | Recommendation | Why |
|---|---|---|---|
| D1 | **Stack** (the languages and frameworks) | **TypeScript + Next.js**, tested with `node --test` or Vitest, the same shape as Normie and WaveCenter. | The loop and Dane already know this shape. The hand-off suggests it too (§7). |
| D2 | **Hosting** (where the app runs) | **On the Mac Mini**, reachable only on the home network (agreed). Move to Vercel later only if Dane wants it from outside the house. | It is a private, one-person tool. Running it locally means no public address to protect while it is young. |
| D3 | **Sign-in** | **One password, kept in Doppler**, checked on every page and server action. Supabase Auth only if the app ever leaves the Mini. | One owner on a home network does not need accounts, email links or a sign-in service. |
| D4 | **Database** | **One SQLite file on the Mini**, through Node's built-in `node:sqlite` (the same thing the Spirality tracker uses), with migrations in the repository and a daily copy kept beside it. Move to Postgres only if the app is ever hosted. | No new service, no new account, no monthly bill. The hand-off's Postgres (§7) matters for a hosted, many-user app, which this is not. |
| D5 | **AI provider** | **Anthropic Claude**, through a small adapter **copied from StarCaster** (`lib/aiClient.js`, `lib/aiUsage.js`, `lib/aiPricing.js`), so every call's cost is recorded and an unknown price is never shown as zero. The key lives in Doppler. Check that the account's data-retention settings suit client job text (§10). | The code already exists and works. Copying it is cheaper than writing it again, and keeps the hand-off's "replaceable model adapter" (§7). |
| D6 | **Upwork access** | **Manual mode until Epic 5.** Do the research task R1 (official MCP server, terms, rate limits) early, since it is reading only, but build no live connection until Dane has read its findings and said go. | No access is needed to make the tool useful. The legal page was never fully read (§4), so the live connection has to wait for that. |
| D7 | **Where the private business data lives** (portfolio claims, pricing guidance) | **Entered in the app** by Dane, stored in his database, never in the repository. | Public repository (C11). |

### Still open, from R1

R1 (`docs/upwork-integration-verification.md`, "What is unclear") found four
questions Upwork's terms do not settle. They are **open**: Dane has not
decided them, and this plan does not answer them. Each is explained in full
in that document.

| # | Question, in plain words | Status |
|---|---|---|
| U1 | **Can the app's AI rank jobs?** Upwork's terms forbid an AI ranking jobs "using criteria the Agent itself determines" but allow results based on criteria Dane specified (S1 §5.9). Does scoring jobs against Dane's own written preferences count as his criteria? | open |
| U2 | **Does an AI-drafted proposal need an AI label?** The terms require saying so when content would reasonably be taken as written by a person (S1 §9.7). Does a draft Dane edited and approved still count, and how would the label look? | open |
| U3 | **Is pasting a job by hand "copying" it?** The general terms forbid copying information found on Upwork without consent (S2 §3.5). Does that cover Dane pasting a job post into his own private tool, as Epics 2 and 3 do? | open |
| U4 | **Which multi-user duties fit a one-person app?** Some duties (a privacy notice, a sub-processor list, a yearly security check; S1 §9.4, §9.9, §10.5) are written for apps with other users. Which apply when Dane is the builder and the only user? | open |

## 4. Epics

In build order. Epics 1 to 3 are **the first version**: the smallest tool
that does the whole job by hand. Everything after it waits until Dane has
used the first version and knows what he misses.

**The first version**

1. **Epic 1 — A private app on the Mini.** Goal: a password-protected,
   empty app that is always running on the Mini, with its database file.
   Once it ships, Dane can open the app from any device at home and sign in.
2. **Epic 2 — Job inbox and ranking.** Goal: paste a job in and get a
   ranked card with its reasons and its unknowns. Once it ships, Dane can
   triage the Upwork jobs he finds himself faster: Pursue, Pass, Revisit.
3. **Epic 3 — Draft, approve, send by hand, track.** Goal: for a pursued
   job, get an honest first draft from his approved portfolio evidence,
   edit it, approve one exact version, copy it into Upwork himself, and
   track the job through replied, interviewing, won or lost. Once it ships,
   the hand-off's §13.15 flow works end to end with no Upwork access.

**After the first version**

4. **Epic 4 — Comforts.** The pieces trimmed from the first version: Demo
   mode, draft version history, safe regenerating, a suggested bid, and
   data export. Build the ones Dane asks for, in the order he asks. The
   activity log (4.2) is **not** optional any more: Upwork's terms require
   a log of who authorized each AI action (S1 §10.6), so it is built before
   Epic 5.
5. **Epic 5 — Official Upwork read connection.** Goal: search and read jobs
   through **Upwork's official MCP server** (R1 found its terms permit it,
   S1 §4.1), on demand and capped. Once it ships, Dane presses **Find
   projects** instead of pasting.
6. **Epic 6 — Approved submission and learning.** Goal: submit an approved
   proposal through Upwork's own MCP steps, create → preview →
   `confirm_preview`, with Dane approving the exact text and then approving
   Upwork's preview (S6), and learn from outcomes. Upwork's preview and its
   refusal of duplicate applications do most of the "never send twice" work,
   so the app's own part is small (6.2, 6.3). The manual path from Epic 3
   keeps working on its own, because Upwork can change or withdraw its tools
   at any time (S1 §3.5(e), §16.2).

## 5. First-pass tasks

Each task is one pull request. "Waits on" names what has to merge or be
decided first. Low-risk tasks come first within each epic where the order
allows. The first version is 16 tasks plus one research task; later epics
are coarser.

**Sizes, for planning.** At roughly 5 developer-hours for a low-risk task
and 10 for a medium one, plus about 10% for the joins between them, the
first version is about **95–135 developer-hours**. Through the loop that is
about **2–4 days**, set mostly by how quickly Dane answers "go" and "merge".
These are estimates, not measurements.

### Research, any time

| # | Task (what Dane can do once it ships) | Goal | Risk | Waits on |
|---|---|---|---|---|
| R1 | Dane gets a written answer on what Upwork officially allows this app to do | Research only, no code: re-read the official MCP setup, automation policy, rate limits and terms (§4, §15); write `docs/upwork-integration-verification.md` with no private account details; list what needs Dane's browser login or decision. Its answer decides whether Epics 5 and 6 happen. | low | nothing |

### Epic 1 — A private app on the Mini

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 1.1 | Dane can open an empty Upwork Blaster page on the Mini, and it stays running | Next.js + TypeScript skeleton, a home page, `verify` runs typecheck and tests; a launchd service keeps it running on the Mini at a fixed home-network address and restarts it after a crash or reboot | low | nothing |
| 1.2 | Only Dane can get into the app | One password from Doppler, a signed session cookie, a check on every page and server action; a test that a signed-out visitor sees nothing and a wrong password gets nothing | low | 1.1 |
| 1.3 | The app keeps Dane's data in its own database file, with a daily copy | SQLite through `node:sqlite`, a migration runner, the first migration (Opportunity, Preferences, PortfolioEvidence); a daily copy of the file kept beside it; the database file is never in the repository | medium | 1.1 |

### Epic 2 — Job inbox and ranking

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 2.1 | Dane can paste a job post he found on Upwork and save it | Manual job form: link, title, text, budget and the like; duplicates by link are refused | low | 1.2, 1.3 |
| 2.2 | Dane can record his search preferences and hard exclusions | Preferences page: themes, required and unsupported tech, exclusions, ranking weights (versioned, C10) | low | 1.2, 1.3 |
| 2.3 | Dane can enter the portfolio evidence proposals are allowed to use | PortfolioEvidence page: project, status (delivered, in progress, planned), features, links, "approved for use" | low | 1.2, 1.3 |
| 2.4 | A pasted job's fields are filled in for Dane, with gaps marked unknown | The AI adapter copied from StarCaster (D5), key in Doppler, each call's cost recorded and a running total shown in the app; structured extraction; job text treated as untrusted | medium | 2.1 |
| 2.5 | Each job gets a fit score Dane can read the reasons for | Rule-based scoring on the five §6 dimensions with evidence, confidence, unknowns at a neutral value; exclusions kept separate (§13.2 test) | medium | 2.2, 2.3, 2.4 |
| 2.6 | Dane sees his jobs as ranked cards and can Pursue, Pass or Revisit each one | Inbox with the §5B card fields, top five first, "unknown" shown honestly; Decision table and buttons; passing never rewrites his preferences | low | 2.5 |
| 2.7 | A job post that tries to give the AI orders changes nothing | Prompt-injection fixtures (§13.4): a hostile post cannot change scores, decisions or what the app does | medium | 2.4, 2.5 |

### Epic 3 — Draft, approve, send by hand, track

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 3.1 | Pursuing a job opens a workspace with a first draft grounded in the job and his approved evidence, and nothing is sent anywhere | Side-by-side job and draft; drafting through the adapter using only "approved for use" evidence; screening questions listed and flagged if unanswered; Pursue creates a draft only (§13.3 test) | medium | 2.6, 2.3 |
| 3.2 | A draft that claims something unproven is blocked from being approved | Claim check: a planned project, unapproved evidence or an invented number raises a blocking flag (§13.5 test) | medium | 3.1 |
| 3.3 | Dane can edit the draft and approve one exact version, and any later edit cancels that approval | The final review screen (exact text, every answer, unresolved flags, §5D); approval bound to a fingerprint of the text and answers; an edit invalidates it (§13.6 test); only Dane's signed-in click can approve, never the AI | medium | 3.2, 1.2 |
| 3.4 | Dane copies the approved proposal into Upwork himself and marks it sent | Copy button; "I sent it" recorded as owner-confirmed, never "submitted by the app" (§13.11) | low | 3.3 |
| 3.5 | Dane tracks each job through replied, interviewing, won or lost, with notes | Pipeline board with owner-entered statuses, notes and next actions | low | 3.4 |
| 3.6 | The whole flow is checked end to end automatically | An end-to-end test of §13.15 on made-up fixture jobs (no real client text) | low | 3.5 |

### Epic 4 — Comforts (after the first version; build only what Dane asks for, except 4.2, which Epic 5 needs)

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 4.1 | Dane can try the app on made-up jobs, clearly marked Demo | A Demo/Manual mode with a visible banner and the fixture jobs from 3.6 (§13.13) | low | 3.6 |
| 4.2 | Dane can read a log of everything he and the AI did | ActivityEvent table and a plain log page; secrets never written to it (test). **Not optional: built before Epic 5**, because Upwork's terms require a log tying each AI action to who authorized it, producible on request (S1 §10.6). Shipped in pull request #23 | low | 1.3 |
| 4.3 | Every edit to a draft is kept as a version he can compare | ProposalVersion table, version list and a diff view | low | 3.3 |
| 4.4 | Regenerating a draft never silently throws away Dane's edits | Regenerate shows what changes against his edited version and lets him keep his parts | medium | 4.3 |
| 4.5 | Dane sees a suggested bid and milestones, as a range with its assumptions | From his own pricing guidance in Preferences; never hard-coded; labeled an estimate | medium | 3.1, 2.2 |
| 4.6 | Dane can export all his own data | One JSON export of jobs, evidence, drafts and pipeline; no secrets in it (§13.12) | low | 3.5 |

### Epic 5 — Official Upwork read connection (coarser)

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 5.1 | Dane can connect his Upwork account through Upwork's MCP server, and disconnect it | **First step: prove a home-built app on the Mini can connect** to the MCP server at all (U7 in the R1 document; Upwork lists only chat apps and code editors, S4). If it cannot, stop and come back to Dane before building more. Then: Dane logs in to Upwork in his browser and approves the link himself (S4; an agent may not accept terms for him, S1 §5.8); OAuth 2.1 sign-in (S4); tokens encrypted server-side, never in logs or the browser (S1 §6.4, §8.4; §13.9, §13.12); Upwork-sourced data encrypted at rest (S1 §10.2) | high | Dane's browser login and his decision to accept Upwork's API & MCP Terms (S1 §1.1), 1.2, 4.2 |
| 5.2 | Dane presses **Find projects** and gets a capped, on-demand search | Upwork adapter behind the same interface as manual input; query and page caps; duplicates merged (§13.1); cancel button. On demand only, **never on a timer**: Upwork allows search for a user-directed task, not for watching the market (S1 §4.1). Until U1 is settled, Upwork-sourced jobs are ranked only on Dane's own stated criteria, shown on the card, and the app never shortlists or hides jobs on its own (S1 §5.9) | high | 5.1, 2.6 |
| 5.3 | When Upwork says "slow down" or a call fails, the app stops and says so | Rate-limit handling and honest partial-failure display (§13.10); fall back to Manual mode, never scraping | medium | 5.2 |
| 5.4 | Upwork data is kept only as long as allowed | An Upwork-sourced job copy is kept only while Dane is working on it, then deleted (S1 §8.6); nothing goes into any AI knowledge base or vector index (S1 §5.3, §8.6, §9.6); whatever the AI provider keeps must be 30 days or less (S1 §8.6), checked with D5's retention check of the Anthropic account; everything deleted when Dane disconnects (S1 §8.7; §13.14). Upwork-sourced data stays encrypted at rest (S1 §10.2, set up in 5.1) | medium | 5.1 |

### Epic 6 — Approved submission and learning (coarser)

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 6.1 | Dane can submit an approved proposal through Upwork's own confirmation step | Upwork's MCP flow: `manage_proposals` create → Upwork's preview → `confirm_preview` (S6). Two approvals: Dane approves the exact text in the app (3.3), then separately approves Upwork's preview before anything is sent (S4, S6). Upwork's own confirmation is never replaced by the app's | high | 5.2, 3.3 |
| 6.2 | A double-click can never send a proposal twice | One lock on the confirm button, so it cannot fire twice for the same preview; no automatic resend (§13.7). Upwork already refuses a duplicate application (S6) | medium | 6.1 |
| 6.3 | The app shows Upwork's answer, or says plainly that it doesn't know | When a confirm times out, record `OUTCOME_UNKNOWN` and read Upwork's proposal list back instead of retrying (S6; §13.8) | medium | 6.2 |
| 6.4 | Dane sees how his proposals are doing: replies, interviews, wins, cost | Simple outcome numbers from the pipeline, with measured results kept apart from estimates (§14) | low | 3.5 |
| 6.5 | The app suggests preference changes from his passes, and he approves each one | Suggestions only; nothing changes without his click (§5B, §12 Phase 4) | medium | 2.6, 6.4 |

Tasks 6.2 and 6.3 drop from high to medium risk: R1 found that Upwork's
`preview_id`, its refusal of duplicate applications and its proposal list
(S6) already do most of what the plan's own submission lock, operation keys
and reconciliation were for. What is left is small and easy to test, though
it still guards a real send, so it is not low.

Tasks 6.4 and 6.5 don't need Upwork submission and can be built straight
after the first version if Dane wants them sooner.

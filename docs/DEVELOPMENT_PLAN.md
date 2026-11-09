# Upwork Blaster — Development Plan (first pass)

Status: **draft for Dane's approval.** Nothing here is filed as tickets yet.
Once the plan is approved, the tasks below are filed as a separate step.

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
| C1 | §1, §16 ("inspect AGENTS.md", "existing Spirality/Starcaster stack") | Treat this as a **new, standalone repository**. There is no `AGENTS.md` here (the instructions are `CLAUDE.md`), no app code, no database and no Next.js: today the repository is Node 22, a placeholder test and Spirality's loop files. Reuse the *conventions* of Dane's other apps (see D1), not their code. | The hand-off was written without seeing this repository. Building inside Starcaster or sharing its database would tangle two products. |
| C2 | §16 ("begin Phase 1 while investigating Phase 0") | Split Phase 0 into **small separate tickets**: one research ticket for the Upwork terms and capability check, and the app skeleton as its own tickets. Never one ticket that "inspects and begins building". | The loop builds one ticket into one pull request. A ticket that mixes research and building can't be reviewed cleanly. |
| C3 | §12 Phase 1 (one "complete manual/demo vertical slice") | Break Phase 1 into **three epics** (bare app, job inbox and ranking, proposal workspace), each usable on its own. | Phase 1 as written is weeks of work in one block. Smaller epics let Dane use, and correct, the inbox before drafting is built on top of it. |
| C4 | §8 (12 tables up front) | **Grow the data model one task at a time**: each task adds only the tables it uses. Start with Opportunity, Evaluation, Decision, PortfolioEvidence, Preferences and ProposalVersion. ProviderConnection, SearchRun, Approval and SubmissionAttempt arrive with the epics that need them. | Tables designed before the screens that use them get redesigned. Migrations are cheap; guessing is not. |
| C5 | §9 (full approval state machine, operation keys, submission lock, reconciliation) | Build the **manual-submission version first**: Draft → Ready → Approved (bound to a fingerprint of the exact text) → "Dane says he sent it". Defer locks, operation keys, `OUTCOME_UNKNOWN` and reconciliation to Epic 6, and build them only if Upwork really lets an outside app submit. | All of that machinery exists to stop duplicate automatic sends. With manual submission there is nothing to send twice. §12 Phase 3 already says manual submission may be the permanent path. |
| C6 | §7, §3.8 (OpenClaw) | **Leave OpenClaw out** of the plan, with no task for it. Revisit only if a later need appears. | The hand-off itself calls it optional. It adds an integration and a security boundary with no feature that needs it. |
| C7 | §7 ("durable background-job mechanism") | **No background-job system** in the first epics. Ranking and drafting run when Dane presses a button and he waits a few seconds. | The MVP has no unattended work (§3.7), so a job queue would be infrastructure with no user. |
| C8 | §5A Setup (connection, capacity, spending limits on day one) | Setup in the early epics is **just portfolio evidence and search preferences**. Connection status and spending limits arrive with Epics 5 and 6. | There is nothing to connect and nothing to spend until then. |
| C9 | §4 (verification written to `docs/upwork-integration-verification.md`) | Keep the document, but write it **without private account details** (the account name, balances, Connects counts), because this repository is public. | Same reason the hand-off is not copied in. |
| C10 | §6 (ranking weights 30/25/20/15/10) | Keep the weights, but store them in Preferences as **Dane's editable settings**, versioned, so each evaluation records which weights it used. | The weights are a starting guess. Dane should tune them without a code change, and old scores should still explain themselves. |
| C11 | §2 (business figures and pricing) | Keep the figures **out of the code and repository**. Pricing guidance, profile claims and reference projects are entered by Dane as private data in the app (PortfolioEvidence and Preferences), not hard-coded. | The repository is public. It also lets Dane change prices without a code change. |

### What is missing

- **Where it runs and how Dane signs in.** The hand-off says "local
  authenticated instance" but not where it is hosted or how sign-in works.
  See D2 and D3.
- **The cost of the AI calls.** Ranking and drafting each call an AI model.
  The plan adds a simple per-session count of AI calls and their rough cost,
  shown in the app, so there are no surprises.
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
- **Cut:** OpenClaw (C6), background job system (C7), multi-user support
  and the second reviewer (§3.9). The app is for one owner. Cross-user
  access tests (§13.12) become "a signed-out visitor sees nothing".
- **Kept out, as the hand-off says (§14):** public SaaS, mass outreach,
  automatic pricing or contract acceptance, payments, timesheets.

## 3. Decisions Dane needs to make

Each has a recommended answer. Reply with "agreed" or the answer you want.

| # | Question | Recommendation | Why |
|---|---|---|---|
| D1 | **Stack** (the languages and frameworks) | **TypeScript + Next.js**, tested with `node --test` or Vitest, the same shape as Normie and WaveCenter. | The loop and Dane already know this shape. The hand-off suggests it too (§7). |
| D2 | **Hosting** (where the app runs) | **On the Mac Mini first**, reachable only on the home network. Move to Vercel later only if Dane wants it from outside the house. | It is a private, one-person tool. Running it locally means no public address to protect while it is young. |
| D3 | **Sign-in** | **Supabase Auth with one allowed email (Dane's).** On the Mini-only setup, a single password in Doppler would also do. | Supabase is already used in Dane's other apps and covers sign-in and database together. |
| D4 | **Database** | **Supabase Postgres** (a new, separate Supabase project), with migrations in the repository. | Matches the other apps; Postgres is what the hand-off asks for (§7). A separate project keeps Upwork data apart from other products. |
| D5 | **AI provider** | **Anthropic Claude through the official SDK**, behind a small adapter so it can be swapped. The key lives in Doppler. Check that the account's data-retention settings suit client job text (§10). | Already used in Starcaster. The adapter is the hand-off's own "replaceable model adapter" (§7). |
| D6 | **Upwork access** | **Manual mode until Epic 5.** Do the Epic 5 research ticket (official MCP server, terms, rate limits) early, since it is reading only, but build no live connection until Dane has read its findings and said go. | No access is needed to make the tool useful. The legal page was never fully read (§4), so the live connection has to wait for that. |
| D7 | **Where the private business data lives** (portfolio claims, pricing guidance) | **Entered in the app** by Dane, stored in his database, never in the repository. | Public repository (C11). |

## 4. Epics

In build order. Each one leaves something Dane can use.

1. **Epic 1 — A private app that runs.** Goal: a signed-in, empty app on the
   Mini with its database and test setup. Once it ships, Dane can open the
   app, sign in, and see the (empty) inbox, clearly marked Demo.
2. **Epic 2 — Job inbox and ranking (manual and demo).** Goal: paste a job
   in (or load synthetic demo jobs) and get a ranked card with evidence and
   unknowns. Once it ships, Dane can triage real Upwork jobs he found himself
   faster: Pursue, Pass, Revisit.
3. **Epic 3 — Proposal workspace.** Goal: for a pursued job, draft an
   honest proposal from his approved portfolio evidence, edit it side by
   side, keep versions. Once it ships, Dane can produce a ready-to-paste
   proposal in minutes.
4. **Epic 4 — Review, manual submit and pipeline.** Goal: approve one exact
   version, copy it into Upwork himself, and track the job through replied,
   interviewing, won or lost. Once it ships, the whole hand-off §13.15 flow
   works end to end with no Upwork access.
5. **Epic 5 — Official Upwork read connection.** Goal: verify what Upwork
   officially allows, then (only if allowed) search and read jobs through
   the official route, on demand and capped. Once it ships, Dane presses
   **Find projects** instead of pasting.
6. **Epic 6 — Approved submission and learning (only if verified).** Goal:
   submit an approved proposal through Upwork's supported confirmation flow,
   with exactly-once protection, and learn from outcomes. Once it ships, Dane
   submits from the app. If Upwork doesn't support it, the manual path from
   Epic 4 stays the product and only the learning tasks are built.

## 5. First-pass tasks

Each task is one pull request. "Waits on" names the task that has to merge
first. Low-risk tasks come first within each epic. Epics 1–4 are the
hand-off's Phase 1 and get the most detail.

### Epic 1 — A private app that runs

| # | Task (what Dane can do once it ships) | Goal | Risk | Waits on |
|---|---|---|---|---|
| 1.1 | Dane can open an empty Upwork Blaster page on the Mini | Next.js + TypeScript skeleton, `npm run dev`, a home page, `verify` runs typecheck and tests | low | D1, D2 decided |
| 1.2 | Every screen says clearly whether it is showing Demo or real data | A mode setting (Demo / Manual) and a visible banner; Demo is the default | low | 1.1 |
| 1.3 | The app keeps Dane's data in its own database | Supabase project wired in through Doppler, first migration, a `.env.example` with no secrets | medium | 1.1, D4 decided |
| 1.4 | Only Dane can get into the app | Sign-in with one allowed email; every page and server action checks it; a test that a signed-out visitor sees nothing | medium | 1.3, D3 decided |
| 1.5 | Every action Dane or the AI takes is written to an activity log he can read | ActivityEvent table and a plain log page; secrets are never written to it (test) | low | 1.3 |

### Epic 2 — Job inbox and ranking (manual and demo)

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 2.1 | Dane can load a set of made-up demo jobs to try the app | Synthetic fixtures (no real client text), marked Demo everywhere they appear | low | 1.2 |
| 2.2 | Dane can paste a job post he found on Upwork and save it | Manual job form: link, title, text, budget, and the like; duplicates by link are refused; Opportunity table | low | 1.3, 2.1 |
| 2.3 | Dane can record his search preferences and hard exclusions | Preferences page: themes, required/unsupported tech, exclusions, ranking weights (versioned) | low | 1.3 |
| 2.4 | Dane can enter the portfolio evidence proposals are allowed to use | PortfolioEvidence page: project, status (delivered / in progress / planned), features, links, "approved for use" | low | 1.3 |
| 2.5 | A pasted job's fields are filled in for Dane, with gaps marked unknown | AI model adapter (swappable, key in Doppler) plus structured extraction; job text treated as untrusted; per-call cost recorded | medium | 2.2, D5 decided |
| 2.6 | Each job gets a fit score Dane can read the reasons for | Rule-based scoring on the five §6 dimensions with evidence, confidence, unknowns at a neutral value; exclusions separate (§13.2 test) | medium | 2.3, 2.4, 2.5 |
| 2.7 | Dane sees his jobs as ranked cards, top five first | Inbox with the §5B card fields, rejection reasons for the rest, "unknown" shown honestly | low | 2.6 |
| 2.8 | Dane can Pursue, Pass or Revisit a job, and passed jobs stay out of his way | Decision table and buttons; passing never rewrites his preferences | low | 2.7 |
| 2.9 | A job post that tries to give the AI orders changes nothing | Prompt-injection fixtures (§13.4): a hostile post cannot change scores, decisions or tools | medium | 2.5, 2.6 |

### Epic 3 — Proposal workspace

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 3.1 | Pursuing a job opens a workspace beside the job, with nothing sent anywhere | Side-by-side job and empty editor; Pursue creates a draft only (§13.3 test) | low | 2.8 |
| 3.2 | Dane gets a first draft proposal grounded in the job and his approved evidence | Drafting through the model adapter; only "approved for use" evidence; screening questions listed and flagged if unanswered | medium | 3.1, 2.4 |
| 3.3 | A draft that claims something unproven is blocked from being marked ready | Claim check: a planned project, unapproved evidence or invented numbers raise a blocking flag (§13.5 test) | medium | 3.2 |
| 3.4 | Dane can edit the draft and every change is kept as a version he can compare | ProposalVersion table, version list and a diff view | low | 3.1 |
| 3.5 | Regenerating a draft never silently throws away Dane's edits or prices | Regenerate shows what changes against his edited version and lets him keep his parts | medium | 3.2, 3.4 |
| 3.6 | Dane sees a suggested bid and milestones, as a range with its assumptions | Bid suggestion from his own pricing guidance in Preferences; never hard-coded; labeled an estimate | medium | 3.2, 2.3 |

### Epic 4 — Review, manual submit and pipeline

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 4.1 | Dane sees one final review screen with everything that would be sent | Exact text, every answer, bid, milestones, unresolved flags (§5D) | low | 3.4 |
| 4.2 | Dane approves one exact version, and any later edit cancels that approval | Approval bound to a fingerprint of the text, answers and terms; edits invalidate it (§13.6 test); only a signed-in click can approve, never the AI | medium | 4.1, 1.4 |
| 4.3 | Dane copies the approved proposal into Upwork himself and marks it sent | Copy button, "I sent it" marked owner-confirmed, never "submitted by the app" (§13.11) | low | 4.2 |
| 4.4 | Dane tracks each job through replied, interviewing, won or lost, with notes | Pipeline board with owner-entered statuses, notes and next actions | low | 4.3 |
| 4.5 | The whole flow can be walked end to end in Demo mode, checked automatically | End-to-end test of §13.15 on fixtures; Demo records visibly distinct (§13.13) | low | 4.4, 2.1 |
| 4.6 | Dane can export all his own data | One export (JSON) of jobs, evidence, drafts and pipeline; no secrets in it (§13.12) | low | 4.4 |

### Epic 5 — Official Upwork read connection (coarser)

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 5.1 | Dane gets a written answer on what Upwork officially allows this app to do | Research only, no code: re-read the official MCP setup, automation policy, rate limits and terms (§4, §15); write `docs/upwork-integration-verification.md` with no private account details; list what needs Dane's browser login or decision | low | nothing (can run any time) |
| 5.2 | Dane can connect his Upwork account through the official sign-in, and disconnect it | Only if 5.1 says it's allowed. Official OAuth; tokens encrypted server-side, never in logs or the browser (§13.9, §13.12) | high | 5.1 approved by Dane, 1.4 |
| 5.3 | Dane presses **Find projects** and gets a capped, on-demand search | Upwork adapter behind the same interface as manual input; query and page caps; duplicates merged (§13.1); cancel button | high | 5.2, 2.7 |
| 5.4 | When Upwork says "slow down" or a call fails, the app stops and says so | Rate-limit handling and honest partial-failure display (§13.10); fall back to Manual mode, never scraping | medium | 5.3 |
| 5.5 | Upwork data is kept only as long as allowed | Retention and expiry rules from 5.1; cleanup on disconnect (§13.14) | medium | 5.2 |

### Epic 6 — Approved submission and learning (coarser, only if verified)

| # | Task | Goal | Risk | Waits on |
|---|---|---|---|---|
| 6.1 | Dane can submit an approved proposal through Upwork's own confirmation step | Only if 5.1 finds a supported route. Provider draft and confirmation; Upwork's own confirmation is never replaced by the app's | high | 5.3, 4.2 |
| 6.2 | A double-click or a crash can never send a proposal twice | Submission lock, operation key, `OUTCOME_UNKNOWN` on timeout, no automatic resend (§13.7, §13.8) | high | 6.1 |
| 6.3 | The app shows Upwork's receipt, or says plainly that it doesn't know | Reconciliation through supported reads; a receipt is required for "submitted" | high | 6.2 |
| 6.4 | Dane sees how his proposals are doing: replies, interviews, wins, cost | Simple outcome numbers from the pipeline, with measured results kept apart from estimates (§14) | low | 4.4 |
| 6.5 | The app suggests preference changes from his passes, and he approves each one | Suggestions only; nothing changes without his click (§5B, §12 Phase 4) | medium | 2.8, 6.4 |

Tasks 6.4 and 6.5 don't need Upwork submission and can be built straight
after Epic 4 if Dane wants them sooner.

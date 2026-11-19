# What Upwork officially allows Upwork Blaster to do

Research task R1 of the [development plan](DEVELOPMENT_PLAN.md) (ticket UB-5).
Read on **November 18, 2026**. Reading only: no sign-up, no login, no calls to
Upwork's API or MCP server. No private account details are in this document.

**The short answer.** Upwork now has an official, free route that lets an
outside app search jobs, read them, and submit a proposal **after Dane
confirms it twice**: its MCP server. (MCP, the Model Context Protocol, is a
standard way for an AI app to use another service's tools.) Upwork's own
terms name "search ... job postings" and "draft, submit, and manage
proposals" as **permitted uses**. So Epic 5 can be built, and the submission
half of Epic 6 can be built in a smaller form than the plan feared. A few
rules change the design, and four questions are Dane's to decide (end of
this document).

## How these pages were read

Upwork's website refuses automated readers (it answered HTTP 403 "Forbidden"
to every page). Getting around that with a disguised browser would be the
kind of bot behaviour the project's hard rules forbid, so it was not tried.
Instead:

- Upwork's legal page, MCP page and developer documentation were read from
  copies kept by the Internet Archive's Wayback Machine (the snapshot date is
  given beside each source). An archived copy is Upwork's own published text
  as of that date; it can be older than today's page.
- Upwork's own GitHub repositories (`github.com/upwork`) were read directly.

| # | Source (Upwork's own) | Version / date on the page | How it was read, Nov 18, 2026 |
|---|---|---|---|
| S1 | **Upwork API & MCP Terms of Use**, [upwork.com/legal#apimcpterms](https://www.upwork.com/legal#apimcpterms) | Version 2.5, effective Nov 6, 2026 | [Archive snapshot of Nov 18, 2026](https://web.archive.org/web/20261118064006/https://www.upwork.com/legal) |
| S2 | **Upwork Terms of Use** (part of the Terms of Service), on [upwork.com/legal](https://www.upwork.com/legal) | Version 4.12, effective Sep 10, 2025 | Same snapshot as S1 |
| S3 | **API Terms of Use** (the older API terms, still listed), on [upwork.com/legal](https://www.upwork.com/legal) | Version 2.2, effective Aug 6, 2026 | Same snapshot as S1 |
| S4 | **Upwork MCP Server** page, [upwork.com/ai/mcp](https://www.upwork.com/ai/mcp) | "Last updated: Aug 4, 2026" | [Archive snapshot of Oct 17, 2026](https://web.archive.org/web/20261017055938/https://www.upwork.com/ai/mcp) |
| S5 | **Upwork GraphQL API documentation**, [upwork.com/developer/documentation/graphql/api/docs](https://www.upwork.com/developer/documentation/graphql/api/docs/index.html) | No date on the page | [Archive snapshot of Nov 6, 2026](https://web.archive.org/web/20261106054241/https://www.upwork.com/developer/documentation/graphql/api/docs/index.html) |
| S6 | **Upwork Agent Plugin**, [github.com/upwork/upwork-agent-plugin](https://github.com/upwork/upwork-agent-plugin): `README.md`, `plugin.json`, `skills/upwork-workflows/SKILL.md`, `skills/write-proposal/SKILL.md` | Commit `7908a7e`, Oct 28, 2026; skills versions 0.3.0 and 0.3.1 | Read directly from GitHub |

**Could not be read** (listed so nobody assumes they were):

- Upwork's support article on disabled API keys
  ([115015933508](https://support.upwork.com/hc/en-us/articles/115015933508-API-key-disabled)):
  the live page refused, and its only archived copy (July 2025) has no
  article text in it.
- The support article the plugin links for help
  ([55446516654611](https://support.upwork.com/hc/en-us/articles/55446516654611)):
  the live page refused, and there is no archived copy.
- The API key application page
  ([upwork.com/developer/keys/apply](https://www.upwork.com/developer/keys/apply)):
  it needs a login, which this task does not do.
- Upwork's published **current MCP rate limits**: the plugin says "Current
  limits are published at https://www.upwork.com/ai/mcp" (S6,
  `upwork-workflows`), but the archived MCP page (S4) gives no numbers.

## Two official routes in

Upwork offers two supported ways in. Anything else (scraping, browser bots,
copying session cookies) is forbidden outright (S1 §5.2, S2 §3.5), which
matches the plan's hard rules.

| | **MCP server** (`https://mcp.upwork.com/mcp`) | **GraphQL API** (`api.upwork.com/graphql`) |
|---|---|---|
| What it is | Upwork's "only official connector for AI agents" (S4, FAQ) | The developer API, with keys (S5) |
| How you get in | Log in to Upwork in a browser window and approve the link; "OAuth 2.1 with dynamic client registration", "no API keys to manage" (S4). "You will gain access to the MCP Server only after you complete the account authorization" (S1 §6.2) | Apply for a key; "Every new request for an API Key will be reviewed" (S5, Getting Started) |
| Who may use it | "free to use with any Upwork account" (S4, FAQ) | Only accounts that meet a high bar (below) |
| Cost | Free; normal Upwork fees and Connects still apply (S4, FAQ). Upwork "reserves the right ... to introduce fees" later (S1 §14.1) | Same terms, S1 §14.1 |
| Approval time | None: "you're ready in under a minute" (S4) | **Unclear**: S5 says each request is reviewed but gives no time |
| Search jobs | Yes: "Search jobs by skill, category, budget, or type. Pull matches and recommendations based on your profile" (S4); tool `find_jobs`, actions `search`, `smart_search`, `get` (S6, `write-proposal`) | Yes: `marketplaceJobPostingsSearch`, needs the "Read marketplace Job Postings" permission (S5) |
| Submit a proposal | Yes, in two confirmed steps (below) (S4; S6) | Yes: `createJobProposal`, "Create a new proposal using the new flow", needs the "Submit Proposal" permission (S5) |
| Rate limits | "follows Upwork's standard rate limits" with no number given (S4, FAQ); searches and writes "are metered more tightly than ordinary reads" (S6, `upwork-workflows`) | "300 requests per minute per IP address", HTTP 429 when exceeded (S5, Requests limits); applicants must confirm they "will stay within the daily request limit of 40,000 API requests" (S5) |
| Sign-in token life | Not stated; stored and refreshed by the app (S4) | Access token 24 hours; refresh token "2 weeks since its last usage" (S5) |

**The API key bar** (S5, Getting Started). To be considered, an account must
have: a valid authentic name, a valid address, a valid profile picture, an
active verified payment method, completed identity verification, "At least
$25,000 in lifetime earnings, spend, or a combination of both", "A Job Success
Score of at least 90% (for freelancers and agencies)", and good standing. The
application must also describe the use, say whether the app is internal or
public, and promise not to use Upwork's name, logo or brand colours. Whether
Dane's account meets this bar is his to check; it is not recorded here.

**Recommendation on the route: the MCP server.** It needs no key review, no
eligibility bar, and it is the route Upwork built for exactly this ("Connect
your AI agent to Upwork", S4). The GraphQL API stays a fallback.

## What is allowed

Each line is Upwork's own wording or a close paraphrase, with its source.

- **Searching and reading jobs for the user.** Permitted uses include enabling
  users to "(a) search, browse, and respond to Upwork job postings" (S1 §4.1).
- **Drafting and submitting proposals.** "(b) draft, submit, and manage
  proposals, messages, and contracts" (S1 §4.1). The MCP page: "Generate a
  proposal draft grounded in your profile, past work, and the job
  requirements. Review before submitting. Connects only apply when you
  confirm." (S4)
- **An AI acting for the user.** "(e) operate an Agent on behalf of an Upwork
  User within scopes the Upwork User has granted" (S1 §4.1). Upwork Blaster
  counts as a "Developer Application", defined to include any "MCP client,
  Agent, integration, or other product that you build or operate that
  interacts with the Tools" (S1 §2).
- **Putting Upwork data into the user's own tools.** "(d) integrate Upwork
  data into the Upwork User's own productivity, accounting, or workflow
  systems (subject to Section 8.6)" (S1 §4.1).
- **Showing and rearranging it in the app**, provided Upwork's attribution and
  AI-origin labels are kept (S1 §3.4).
- **Keeping Dane's own writing.** "Your own notes and proposal text are not
  event payloads or MCP outputs and are not subject to this Section, even if
  you wrote them after reading MCP outputs." (S1 §8.6)
- **Passing a job to the AI that does the task.** MCP outputs may be shared
  with "the AI system you use for the task", and with no one else (S1 §8.6).

### How a proposal is submitted through the MCP server

From Upwork's own instructions (S6, `write-proposal` → "Submit", and
`upwork-workflows` → "Protect writes"):

1. Read the job (`find_jobs` action `get`), then check for an existing
   invitation or proposal, because "Upwork rejects a duplicate application
   upstream".
2. Get the user's explicit confirmation, then call `manage_proposals` action
   `create`. This does **not** send anything: it returns a **preview** and a
   `preview_id`, showing the Connects needed and the balance, whether the
   account can apply, screening questions and boost options.
3. Get "a separate explicit approval to submit", then call `confirm_preview`
   with that `preview_id`. Only now is the proposal sent and the Connects
   spent.
4. Check by listing the freelancer's proposals with status `Pending`.

"Every write action is a draft you confirm separately, never a one-shot
commit." (S4) "Show the exact action and get explicit confirmation before each
one, even if the user says to approve everything." (S6, `upwork-workflows`)
A sent proposal "cannot be edited or withdrawn through this tool" (S6,
`write-proposal`).

This is close to what Epic 6 planned to build itself (C5, tasks 6.1 to 6.3).
Upwork's preview id, its duplicate refusal and its proposal list already do
much of the "never send twice" and "show the receipt" work.

## What is not allowed

- **Scraping or browser automation of any kind**: "scraping, crawling,
  spidering, headless browsing, web-browser plug-ins, optical character
  recognition ... header spoofing, IP rotation", and mixing such content with
  official data (S1 §5.2); "use a robot, spider, scraper, or similar
  mechanisms on our site without written permission" (S2 §3.5).
- **Watching the whole job market.** Search is allowed only for "a specific,
  documented, user-directed task and does not authorize activity designed to
  enumerate or continuously monitor Upwork's available content corpus"
  (S1 §4.1). "Bulk Access" (fetching all or most jobs, including by repeated
  paged requests) is not licensed (S1 §2, §3.5). **So "Find projects" stays
  on demand and capped (plan task 5.2), never a timer that polls Upwork.**
- **An AI that picks jobs by its own criteria.** An Agent may not "make,
  materially influence, or substantially assist in any consequential
  decision, including any decision regarding hiring, employment
  opportunities ...". It may retrieve and display results "based solely on
  search or filter criteria the Principal has specified, without the Agent
  independently ranking, scoring, or filtering results using additional
  criteria the Agent itself determines", and may carry out "a specific action
  the Principal has directed" on a posting he named. It may not be
  "independently selecting, ranking, scoring, or recommending among ...
  postings ... using criteria the Agent itself determines" (S1 §5.9). (The
  "Principal" is the person the AI acts for: Dane.) See unclear item U1.
- **Sending without the person's say-so.** No "solely automated decisions that
  produce legal or similarly significant effects" (S1 §5.8(e)); no consequential
  action "absent the Principal's specific, contemporaneous direction
  identifying its object" (S1 §5.9). An Agent may also not accept binding
  agreements, make identity or tax attestations, or move money (S1 §5.8).
- **Training or "retrieval-augmenting" an AI on Upwork data**, or adding MCP
  outputs "to any AI knowledge base" (S1 §5.3, §8.6, §9.6). **So no
  searchable store (no "vector index") of past job posts.**
- **Keeping data too long.**
  - General Upwork content may be cached "for no more than 24 hours", with no
    re-fetching just to reset the clock (S1 §8.3; S5 says the same).
  - MCP outputs may stay "in any AI application or other AI system" only as
    long as the task needs, "and in no event longer than 30 days" (S1 §8.6).
  - Copies saved outside an AI system ("a note, CRM, or accounting tool") may
    be kept "only as long as you need them for the task", then deleted
    (S1 §8.6).
  - Everything must be deleted when Dane disconnects or asks, or when it is no
    longer needed (S1 §8.7).
- **Charging for it.** No charging, reselling or "otherwise monetiz[ing]" an
  app that depends on Upwork's Tools without Upwork's written consent
  (S1 §14.2). This doesn't affect a private tool. It would matter if Upwork
  Blaster were ever sold.
- **Hiding that AI wrote something.** Where the app "generates or transmits
  content that an Upwork User would reasonably believe to originate from a
  human, you shall disclose at the outset of the interaction ... that the
  content is generated or assisted by, artificial intelligence" (S1 §9.7).
  See unclear item U2.
- **Building a rival to Upwork, or taking contact off Upwork** (S1 §3.2,
  §5.12; S2 §3.5). Not something this app does.

## Obligations that come with connecting

These apply once Upwork Blaster uses the Tools (S1). Most are already in the
plan; the new ones are marked **new**.

- Keys and sign-in tokens kept secret, encrypted, rotated at least yearly
  (§6.4, §8.4). Already plan task 5.1.
- Use the narrowest permissions needed (§4.2, §6.3). Note that today
  "connecting grants the full set of scopes" for the MCP server (S4, FAQ), so
  the narrowing has to happen in which tools the app calls.
- **new:** Upwork content encrypted "in transit and at rest" (§10.2(b)), so
  the SQLite file (plan D4) needs encryption for the Upwork-sourced parts.
- **new:** a log tying each AI action to who authorized it, which Agent did
  it and under what scope, producible within 5 business days on request
  (§10.6). Close to the trimmed Epic 4.2 activity log, which becomes needed
  for Epic 5 rather than optional.
- **new:** a security questionnaire "on Upwork's request and at least
  annually" (§10.5), and reporting any breach to Upwork immediately (§10.4).
- **new:** "your own user agreement and privacy notice" (§9.4). See U4.
- Upwork can change or withdraw any tool, field or limit at any time
  (§3.5(e), §16.2), and can suspend access for "abusive usage" (§7.4). The
  manual path from Epic 3 therefore has to keep working on its own.

## What is unclear

The documents do not settle these. They are listed, not guessed.

- **U1. Can the app's AI rank jobs at all?** Epic 2's ranked card scores jobs.
  S1 §5.9 forbids ranking "using criteria the Agent itself determines" but
  allows retrieval based on criteria "the Principal has specified". The terms
  do not say whether an AI scoring jobs against **Dane's own written
  preferences** counts as his criteria or as the Agent's, or whether choosing
  which job to bid on is an "employment opportunity" decision. It also does
  not say whether §5.9 covers jobs Dane pastes in by hand, since S1 governs
  use of Upwork's Tools.
- **U2. Does an AI-drafted proposal need an AI label?** S1 §9.7 requires
  disclosure when content would "reasonably" be taken as human-written. The
  terms do not say whether a draft Dane has edited and approved still counts
  as AI-generated, or how the disclosure should look in a proposal.
- **U3. Is pasting a job into a private tool "copying" it?** The general Terms
  of Use forbid "copy, distribute, or otherwise use any information you found
  on Upwork ... without our consent (no scraping allowed)" (S2 §3.5). The
  bracket reads as aimed at scraping, but the words alone also cover a person
  copying a job post into his own notes, which is how plan Epics 2 and 3 get
  jobs in. Upwork's API & MCP Terms explicitly allow bringing Upwork data into
  a user's "own productivity ... or workflow systems" (S1 §4.1(d)), which is an
  argument that the official route is the cleaner one even for reading.
- **U4. Which duties fit a one-person app?** Several S1 duties (§9.4 privacy
  notice, §9.9 sub-processor list, §10.5 annual security attestation) are
  written for apps with other users. The terms do not exempt an app whose
  developer and only user are the same person.
- **U5. Which API terms win?** The legal page lists both the older "API Terms
  of Use" (v2.2, Aug 6, 2026, S3) and the newer "Upwork API & MCP Terms of
  Use" (v2.5, Nov 6, 2026, S1). Neither page found here says the newer one
  replaces the older. This document follows the newer one.
- **U6. The MCP server's real limits.** No numbers were found (see "Could not
  be read"). Only "standard rate limits", and that searches and writes are
  "metered more tightly" (S4, S6).
- **U7. Can a self-built app connect, or only chat apps?** The MCP page lists
  Claude, ChatGPT, Cursor and Codex, and says "If your agent supports remote
  MCP with OAuth, it will work with the Upwork connector" (S4). S1 defines an
  "MCP Client" as any "external software component that connects to an MCP
  Server" (§2). Nothing says a home-built web app on the Mini is turned away,
  but nothing says one was tested either. The first step of task 5.1 should be
  to confirm the connection works before anything else is built.
- **U8. How long a key review takes** (GraphQL route only): not stated (S5).
- **U9. Integration Terms.** The legal page also has "Integration Terms of
  Use" (v1.2, Aug 28, 2026) for Upwork's own integrations powered by
  providers "including Anthropic, PBC, OpenAI, LLC, and Slack". These appear to
  cover Upwork's connectors inside those products, not an app like this one.
  They were not read in full.

## What needs Dane

The four kinds of hand-off CLAUDE.md names, as they apply here.

- **A browser login (when Epic 5 starts):** connecting the MCP server means
  Dane logs in to Upwork in a browser window and approves the link (S4). An
  agent may not do this for him: an Agent may not "accept legally binding
  agreements" or accept terms "on behalf of a Principal" (S1 §5.8(a), (b)).
- **A decision (when Epic 5 starts):** connecting **is** accepting the API &
  MCP Terms ("You accept these API & MCP Terms when you ... use, or call a
  Tool", S1 §1.1). Dane decides whether he accepts them, including the
  obligations listed above.
- **Decisions on U1 to U4**: how the ranking works, whether proposals carry
  an AI note, whether he is comfortable pasting jobs by hand in the meantime,
  and how much of the multi-user paperwork to keep. He may want to ask Upwork
  Support about U1 to U3 in writing; that is his choice and his account.
- **Only if the GraphQL API is ever wanted:** checking his account against the
  key bar and applying (a browser login and his decision). Not recommended
  now.
- **Revoking access** is in his account: "Account Settings → Connected Apps"
  removes the connector and "immediately invalidates the access and refresh
  tokens" (S4, FAQ).

## Recommendation

**Epic 5 (official Upwork read connection): build it, through the MCP
server,** after Dane has made the browser login and terms decision above.
Changes the plan needs:

1. Task 5.1 starts by proving a home-built app can connect (U7); if it
   cannot, stop and come back to Dane before building more.
2. "Find projects" stays on demand and capped, never scheduled (S1 §4.1).
3. Task 5.4's retention rule becomes concrete: an Upwork-sourced job copy is
   kept only while Dane is working on it, then deleted; nothing goes into any
   AI knowledge base or vector index; and whatever the AI provider keeps must
   be 30 days or less (S1 §8.3, §8.6, §8.7). That links to plan D5's check of
   the Anthropic account's retention settings.
4. Upwork-sourced data encrypted at rest, and the activity log (plan 4.2)
   built before or with Epic 5 (S1 §10.2, §10.6).
5. Until U1 is settled, the ranking for Upwork-sourced jobs uses only Dane's
   own stated criteria and shows them, and the app never shortlists or hides
   jobs on its own (S1 §5.9). Upwork's own `smart_search` ranking can be used
   as Upwork returns it.

*Why:* the terms list searching and reading jobs as permitted (S1 §4.1(a)).
The MCP route is free, needs no key review, and is built for an AI app acting
for one person (S4). The real limits are how much is fetched, how long it is
kept, and how the AI ranks, and the plan can be built inside all three.

**Epic 6 (approved submission and learning): build part of it,** after
Epic 5 is running and Dane has decided U2.

- **6.1, submit through Upwork's confirmation step: build**, on the MCP
  `create` → preview → `confirm_preview` flow, with Dane's approval of the
  exact text and then his second approval of Upwork's preview (S6). This is
  the supported route the plan asked R1 to find.
- **6.2 and 6.3, never twice and show the receipt: build much smaller.**
  Upwork's `preview_id`, its refusal of duplicate applications and its
  proposal list (S6) already cover most of it. What remains is one lock on
  the confirm button, recording `OUTCOME_UNKNOWN` when a confirm times out,
  and reading the proposal list back instead of retrying.
- **6.4 and 6.5, outcomes and preference suggestions: build as planned.**
  They need no Upwork submission; the plan already says so.

*Why:* S1 §4.1(b) permits submitting proposals and S4 shows the route exists.
It is a smaller job than planned because Upwork's own two-step confirmation
does most of the safety work the plan expected to write. S1 §5.8 and §5.9
already forbid the only risky version, sending without Dane choosing that job
and approving that text, and the plan never intended to build that.

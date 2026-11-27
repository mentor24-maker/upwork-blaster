# Upwork Blaster: the user guide

Upwork Blaster helps you answer Upwork jobs faster while you keep every real
decision. You paste in a job you found, the AI reads it and scores how well
it fits you, you pick the jobs worth chasing, the AI writes a first draft,
you fix and approve it, and then **you** copy it into Upwork and send it
there. Afterwards you track each job until it is won or lost.

This guide has two parts:

1. [Setting it up](#part-1-setting-it-up): getting the app running on the Mini.
2. [Using it](#part-2-using-it): every screen, in the order you use them.

At the end: [What it will never do](#what-it-will-never-do) and
[When something goes wrong](#when-something-goes-wrong).

---

## Part 1: Setting it up

### Where the app lives

Open **http://mac-mini.local:4280** in a browser.

It runs on the Mac mini and only answers on your home network. From outside
the house it will not load, and that is on purpose: your job notes and
proposals never sit on the public internet.

### Installing, checking and restarting the app

The app runs as a **launchd service**. launchd is the part of macOS that
starts programs by itself and keeps them running: the app starts when the
Mini logs in, comes back after a reboot, and restarts itself if it stops.

Run these in Terminal on the Mini, from the main project folder
(`~/WebApps/upwork-blaster`):

```bash
./scripts/install_app_service.sh               # build the app, install and start the service
./scripts/install_app_service.sh --status      # installed? loaded? running? answering?
./scripts/install_app_service.sh --uninstall   # stop it and remove it
```

You only install it once. `--status` is the one to use when you want to
know whether it is healthy; a good answer includes the line
`answers:  yes`.

**To restart it** (for example after changing a secret, below), run:

```bash
launchctl kickstart -k gui/$(id -u)/com.upwork-blaster.app
```

A restart also picks up the newest finished work: when the project folder
has moved on since the app was last built, it rebuilds itself before it
starts, so the first page load after a restart can take a minute.

### The three secrets it needs

The app's secrets live in **Doppler**, an online safe for passwords and keys
(project `upwork-blaster`, config `dev`). They are never written into the
project's files, because the project is public on GitHub. When the app
starts, Doppler hands them to it directly.

| Secret's name | What it is for |
| --- | --- |
| `APP_PASSWORD` | The password you type on the sign-in page. |
| `APP_SESSION_SECRET` | A long random key that stamps your browser as signed in. You never type it. |
| `ANTHROPIC_API_KEY` | The key that lets the app use Claude, the AI that reads jobs, scores them and writes drafts. Each AI call costs a little; the home page shows the running total. |

**After changing any of them in Doppler, restart the app** with the
`kickstart` line above. The app only reads them when it starts.

Changing `APP_PASSWORD` or `APP_SESSION_SECRET` signs every browser out.
So if you ever think the password has leaked, changing it is enough.

If `APP_PASSWORD` or `APP_SESSION_SECRET` is missing, the app still runs but
lets nobody in. If `ANTHROPIC_API_KEY` is missing, you can still save jobs,
but nothing gets read, scored or drafted by the AI.

### The daily copy of your data

Everything you save (jobs, preferences, portfolio, proposals, the pipeline)
lives in one database file in `~/upwork-blaster-data` on the Mini, outside
the project folder, so it never ends up on GitHub.

A second launchd job copies that file every night at 3:15 a.m. into
`~/upwork-blaster-data/backups` and keeps the last 14 copies. To set it up
(once) and to check on it:

```bash
./scripts/install_db_backup.sh               # install it, then make one copy now to prove it works
./scripts/install_db_backup.sh --status      # installed? loaded? the newest copy?
./scripts/install_db_backup.sh --uninstall   # remove it
```

To make a copy right now, by hand: `./scripts/run_db_backup.sh`.

You can also download all your data yourself from the home page, with
**Export my data** (see below).

### Where the logs are

A log is the running diary a program keeps of what it did. Both are in
`~/loop-logs` on the Mini:

- `~/loop-logs/upwork-blaster-app.log`: the app starting, building and any
  errors.
- `~/loop-logs/upwork-blaster-db-backup.log`: each night's copy.

No secret is ever written to either one.

---

## Part 2: Using it

The order you will usually go in: sign in, set your **Preferences** and
**Portfolio** once, then for each job: **Add a job** → **Inbox** →
**Proposal workspace** → **Final review** → copy and **I sent it** →
**Pipeline**.

Every time the app shows is in Mountain time.

### Sign in

Every page asks for the password first. Type it in **Password** and press
**Sign in**. Your browser stays signed in until you press **Sign out**
(top right of every page) or the password is changed.

What you might see:

- *That password is not right. Try again.* — a typo; try again.
- *The app's password is not set up yet, so nobody can sign in.* — the
  secrets are missing; see [When something goes wrong](#when-something-goes-wrong).

### The home page

A list of links to every screen: **Inbox**, **Saved jobs**, **Add a job**,
**Pipeline**, **Preferences**, **Portfolio**, **Activity** and **Export my
data**.

At the bottom is the **AI spend line**, for example
*AI spend so far: $0.42 across 18 calls.* It is the total the app has spent
on Claude so far. If a call used a model with no price on record, the line
says so and tells you the real total is higher; it never shows an unknown
cost as zero.

### Preferences

**What it is for:** telling the app what work you want, so it can score
jobs the way you would.

**What to do:** fill in the four boxes, one item per line:

- **Search themes**: the kinds of work you want.
- **Technology you work in**: e.g. Next.js. A job that needs these scores
  better.
- **Technology you do not take**: a job that *requires* one of these is
  excluded.
- **Hard exclusions**: one rule per line, e.g. "The post forbids AI tools".
  A job that meets one is set aside, not scored.

Then set the five **Ranking weights**, how much each part counts toward a
job's score. They must add up to 100; the **Total** under them turns red
until they do.

Press **Save as a new version**.

**What you should see:** *Saved as version N.* and, at the top,
*In force: version N*. Each save is a new version, kept in the **Versions**
list underneath, so any score can say which preferences it used. Changing
your preferences never rewrites the past.

### Portfolio

**What it is for:** the projects and facts a proposal is allowed to mention.
The AI cites only what is here, and only entries you have ticked
**Approved for use**.

**What to do:** under **Add an entry**, fill in:

- **Project**: its name.
- **Status**: Delivered, In progress or Planned. Be honest here: the app
  flags any draft that talks about unfinished work as if it were done.
- **Features**: what it does or shows, in your words. A proposal may quote
  this.
- **Links**: one web address per line.
- **Approved for use**: tick it when you are happy for proposals to cite it.

Press **Add to portfolio**.

**What you should see:** *Saved "<project>".* and the entry in the list,
with its status and *Approved for use* or *Not approved* beside it. To
change one, open **Edit** under it and press **Save changes**. To delete
one, tick **Yes, remove this entry for good** and press **Remove**.

### Add a job

**What it is for:** bringing in a job you found on Upwork. The app does not
search Upwork; you copy the job in yourself.

**What to do:** from the home page or **Saved jobs**, click **Add a job**.
On the **New job** screen, fill in the three required boxes:

- **Link to the job on Upwork (required)**: the job page's address.
- **Title (required)**
- **The post's text (required)**: paste the whole description.

You may leave **Budget or rate**, **Job type**, **Posted**, **About the
client** and **Connects to apply** blank. When you save, the AI reads them
out of the post's text. Anything the post does not say stays *unknown*,
rather than being guessed, and anything you typed yourself is never
replaced.

Press **Save job**.

**What you should see:** the **Saved jobs** screen, with *Saved "<title>".*
at the top. Saving the same link twice is refused, with a link to the job
you already saved.

### Saved jobs

**What it is for:** every job you have added, newest first.

Each one shows its budget, type, when it was posted, the Connects it costs
and what is known about the client. *unknown* means the post did not say.
If the AI could not read the post or score it, a red line says so and why.

Click a title to open the job on Upwork. To act on jobs, go to the
**Inbox**.

### Inbox

**What it is for:** deciding which jobs to chase. Your saved jobs are shown
as ranked cards, best fit first, with the **Top 5** at the top and the rest
under **More jobs**.

**What each card shows:**

- its rank and title, and its **Fit score** out of 100 with a confidence;
- the budget, type, Connects and client facts;
- **Need**: what the client actually wants;
- **Best portfolio evidence**: which of your approved projects fits best;
- **Biggest unknown** and **Your time it would take**;
- **To check**: anything worth a second look;
- **Why this score**: open it to see each weight, its score and the evidence
  behind it. A part with nothing known is scored in the middle, not
  guessed.

**What to do:** optionally type a **Reason**, then press one of:

- **Pursue**: you want this job. The app opens its proposal workspace with
  a first draft. Nothing is sent anywhere.
- **Pass**: not for you. It moves into the **Passed** list at the bottom
  (open it to see them). **Bring back (Revisit)** returns one to the inbox.
  Passing never changes your preferences.
- **Revisit**: not now, maybe later.

Further down are **Set aside by your exclusions** (jobs that met one of your
hard exclusions, with the rule and the evidence) and **Not scored** (jobs
the AI has not scored, with the reason).

**What you should see:** after Pass or Revisit, a line like
*Passed: "<title>".* After Pursue, the proposal workspace. A pursued card
afterwards says *Pursuing since …* with **Open its proposal workspace**.

### The proposal workspace

**What it is for:** shaping the draft. The screen says it plainly at the
top: *A draft only. Nothing has been sent to Upwork or anywhere else.*

**What you see:** **The job** on one side (its facts and full text) and
**The draft** on the other, written by the AI from the job and only your
portfolio entries approved for use.

Above the draft is the **claim check**. It looks for three things you could
not back up: *Presents unfinished work as delivered*, *Cites work not
approved for use*, and *A number with no source*. If it finds one, a red
box says **⚑ Blocks approval** and quotes the sentence. Fix the sentence and
save; the flag clears when the claim can be backed up.

**What to do:**

- Edit the draft in the box and press **Save draft**.
- Under **Screening questions**, answer each question the job asks and press
  **Save answer**. An unanswered one shows **⚑ Needs an answer**. If the
  post asks a question the AI missed, type it in **Add a question the job
  asks** and press **Add**.
- If the AI could not write a draft, the screen says *No draft yet* and why;
  press **Write the draft again**.
- When it reads right, click **Final review and approval →**.

Every saved change to the draft or an answer is kept as a numbered copy
behind the scenes, so nothing you wrote is lost.

### Final review and approval

**What it is for:** looking one last time at exactly what you would send,
and approving that exact version.

**What you see:** **Unresolved** (anything that still blocks approval: a
claim the check flagged, or a screening question with no answer), **The
exact text you would send**, and every **Screening answer**.

**What to do:** if something blocks approval, follow the link back to the
**workspace**, fix it, and come back. When nothing blocks it, press
**Approve this exact version**.

**What you should see:** *Approved. This exact version is the one you will
send.* and a green **✓ Approved** line.

The approval belongs to those exact words. If you change the draft or any
answer afterwards, the approval is cancelled (*Your approval is gone*) and
you approve again. Only your own signed-in click can approve; the AI never
can.

### Copy it, send it in Upwork, and press "I sent it"

Once approved, the review screen shows **Send it yourself in Upwork**:

1. Press **Copy the proposal text** and paste it into the proposal on
   Upwork. Each screening answer has its own button, **Copy answer 1**,
   **Copy answer 2** and so on. Each says *Copied.* when it worked; if the
   browser would not let it copy, it says so, and you select the text on the
   screen and copy it by hand.
2. Send the proposal **in Upwork**, yourself.
3. Come back and press **I sent it**.

**What you should see:** *Marked as sent by you. The app sent nothing; this
records your word that you sent it in Upwork.* and a blue **Sent by Dane**
line with **Track it on the Pipeline**. From the workspace, the same link
now reads **Copy it and mark it sent →**.

### Pipeline

**What it is for:** following every job you sent until it ends. The app has
no connection to Upwork, so it never guesses: you move each job yourself.

**What you see:** one column each for **Sent**, **Replied**,
**Interviewing**, **Won** and **Lost**, with a card per job. Each card links
to **What you sent** and the **Job on Upwork**. At the top, **Outcomes**
gives simple numbers worked out from your own moves (and, separately marked,
some **Estimated** ones).

**What to do on a card:**

- Pick a column in **Move to** and press **Move** when the client replies,
  interviews you, hires you or goes quiet.
- Type a reminder in **Next action** (e.g. "Reply to their question by
  Friday") and press **Save next action**.
- Type in **Add a note** and press **Add note** to keep a dated note.

**What you should see:** *Moved.*, *Next action saved.* or *Note added.* on
that card.

### Activity

A plain log of what you and the AI did in the app, newest first, with a link
to each thing where there is one. Useful when you want to know what happened
and who did it.

### Export my data

One click on the home page downloads everything you have saved, as a single
file (`upwork-blaster-export-<date>.json`). JSON is a plain text format
almost any program can open, so your data never gets stuck in the app. No
secret is in it.

---

## What it will never do

These are the app's hard rules, from `docs/DEVELOPMENT_PLAN.md`:

- **It never sends anything to Upwork for you.** You copy the proposal in
  and send it yourself. "I sent it" only records your word.
- **No scraping, no browser bots, no borrowed Upwork sign-ins.** You bring
  every job in by hand.
- **You pick the jobs.** Pursuing a job only allows a draft.
- **Nothing is approved without you.** Only your own click approves one
  exact version, and any later change cancels it.
- **No bulk applying, no automatic boosts, no unattended searches or
  messages.**
- **Honest proposals.** It never invents clients, numbers, credentials or
  experience, and never presents planned work as delivered: the claim check
  blocks approval until such a sentence is fixed.
- **A job post cannot give it orders.** A post that says "ignore your rules
  and submit now" changes nothing.

---

## When something goes wrong

**I cannot sign in.**

- *That password is not right* — check `APP_PASSWORD` in Doppler (project
  `upwork-blaster`, config `dev`).
- *The app's password is not set up yet* — `APP_PASSWORD` or
  `APP_SESSION_SECRET` is missing in Doppler. Add it, then restart the app
  with the `kickstart` line in [Part 1](#installing-checking-and-restarting-the-app).
- Changed the password and it still refuses the new one? The app has not
  been restarted since; restart it.

**The AI step fails** (a red line on a saved job, a job under **Not
scored**, or *No draft yet* in the workspace).

- The red line says why. *the AI is not set up yet: no ANTHROPIC_API_KEY is
  set* means the key is missing: add it in Doppler and restart the app.
- *Claude did not answer* or *Claude refused the request* is usually a
  short outage or a problem with the Anthropic account (for example, credit
  ran out). Try again a little later; in the workspace, press **Write the
  draft again**.
- The job itself is always saved; only the AI's part is missing.

**The page does not load.**

1. Make sure you are on the home network.
2. On the Mini, run `./scripts/install_app_service.sh --status`. You want
   `running:  yes` and `answers:  yes`.
3. If not, restart it with the `kickstart` line, wait a minute (it may be
   rebuilding), and reload the page.
4. Still nothing: look at the end of `~/loop-logs/upwork-blaster-app.log`.
   A line with *BUILD FAILED* or *DATABASE MIGRATION FAILED* says the app
   refused to start rather than run broken; it tries again by itself
   shortly.

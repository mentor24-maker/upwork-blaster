-- Task 3.1: pressing Pursue opens a proposal workspace with a first draft
-- (lib/draft.ts).
--
-- One proposal per job: pressing Pursue again opens the same one, so a
-- second press never writes over a draft. A proposal here is only ever a
-- draft. There is no "approved", "sent" or "submitted" column: approval
-- arrives with task 3.3 in a table of its own, and the app never sends
-- anything to Upwork (Dane copies it in himself, task 3.4).
CREATE TABLE proposal (
  id               INTEGER PRIMARY KEY,
  opportunity_id   INTEGER NOT NULL UNIQUE REFERENCES opportunity (id),
  -- The AI's first draft. NULL until one was written.
  draft            TEXT,
  -- Why the AI could not write it, in plain words; NULL when nothing went wrong.
  draft_problem    TEXT,
  drafted_at       TEXT,
  -- The portfolio entries the AI was shown for this draft (their ids): only
  -- ever ones approved for use. Kept so the claim check (task 3.2) can tell
  -- what the draft was allowed to draw on.
  evidence_ids     TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_ids)),
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The job's screening questions, each flagged on the workspace until it has
-- an answer. Found in the pasted post, or added by Dane by hand. The answer
-- is his own words; NULL until he gives one.
CREATE TABLE proposal_question (
  id           INTEGER PRIMARY KEY,
  proposal_id  INTEGER NOT NULL REFERENCES proposal (id),
  question     TEXT    NOT NULL,
  answer       TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX proposal_question_by_proposal ON proposal_question (proposal_id, id);

-- Task 3.5: the Pipeline board (lib/pipeline.ts). After Dane says "I sent it"
-- (sent_record, task 3.4), he tracks each job himself: replied, interviewing,
-- won or lost, with notes and a next action. Every value here is one he set;
-- the app never guesses a status and has no connection to Upwork.
--
-- One row per move, never edited, so the history of a job's moves is kept;
-- the newest row is the one in force. A sent job with no row yet sits in
-- "sent". He may move a job back to "sent" to undo a slip.
CREATE TABLE pipeline_move (
  id           INTEGER PRIMARY KEY,
  proposal_id  INTEGER NOT NULL REFERENCES proposal (id),
  status       TEXT    NOT NULL CHECK (status IN ('sent', 'replied', 'interviewing', 'won', 'lost')),
  moved_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX pipeline_move_by_proposal ON pipeline_move (proposal_id, id);

-- His notes on a job, in his own words, newest kept alongside the oldest.
CREATE TABLE pipeline_note (
  id           INTEGER PRIMARY KEY,
  proposal_id  INTEGER NOT NULL REFERENCES proposal (id),
  note         TEXT    NOT NULL CHECK (length(trim(note)) > 0),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX pipeline_note_by_proposal ON pipeline_note (proposal_id, id);

-- The one next action on a job (for example "Reply by Friday"): he replaces
-- it as things move. No row, or NULL, means none set.
CREATE TABLE pipeline_next_action (
  proposal_id  INTEGER PRIMARY KEY REFERENCES proposal (id),
  next_action  TEXT,
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

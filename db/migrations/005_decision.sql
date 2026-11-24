-- Task 2.6: what Dane decided about each job on the Inbox (lib/inbox.ts).
--
-- One row per press of Pursue, Pass or Revisit, never edited, so the history
-- of a job's decisions is kept; the newest row is the one in force. A passed
-- job leaves the inbox but stays findable. A decision never touches the
-- preferences table: passing a job does not change his settings (hand-off
-- §5B: only an owner-approved suggestion may, later work).
CREATE TABLE decision (
  id              INTEGER PRIMARY KEY,
  opportunity_id  INTEGER NOT NULL REFERENCES opportunity (id),
  decision        TEXT    NOT NULL CHECK (decision IN ('pursue', 'pass', 'revisit')),
  -- His own words for why, if he gave any. NULL when he gave none.
  reason          TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX decision_by_opportunity ON decision (opportunity_id, id);

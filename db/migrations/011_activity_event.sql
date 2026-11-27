-- The activity log (lib/activity.ts, the /activity page): one plain-English
-- line for each thing Dane or the AI did, so he can look back and see what
-- happened and who did it. A row is never edited or deleted.
--
-- `actor` says who did it: 'Dane' for his clicks, 'AI' for what the model
-- wrote, 'app' for what the app worked out by its own rules (a job's score).
-- `summary` is built from fixed wording and the job's title, never from a
-- password, a cookie or a key: lib/activity.ts scrubs anything that looks
-- like one before it is written.
CREATE TABLE activity_event (
  id              INTEGER PRIMARY KEY,
  at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor           TEXT    NOT NULL CHECK (actor IN ('Dane', 'AI', 'app')),
  kind            TEXT    NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  summary         TEXT    NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 500),
  opportunity_id  INTEGER REFERENCES opportunity (id),
  proposal_id     INTEGER REFERENCES proposal (id)
);

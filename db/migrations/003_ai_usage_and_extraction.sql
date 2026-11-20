-- Task 2.4: the AI reads a pasted job's fields out of its text.
--
-- One row per AI call: what ran, how many tokens, and what it cost. The cost
-- is worked out when the call is recorded (lib/ai/pricing.ts). A model with
-- no known price is stored with priced = 0 and cost_usd NULL, never as $0,
-- so the running total can say plainly that part of it is not priced.
CREATE TABLE ai_usage (
  id                 INTEGER PRIMARY KEY,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  feature            TEXT    NOT NULL,
  provider           TEXT    NOT NULL,
  model              TEXT    NOT NULL,
  prompt_tokens      INTEGER NOT NULL DEFAULT 0,
  completion_tokens  INTEGER NOT NULL DEFAULT 0,
  cached_tokens      INTEGER NOT NULL DEFAULT 0,
  priced             INTEGER NOT NULL CHECK (priced IN (0, 1)),
  cost_usd           REAL    CHECK ((priced = 1 AND cost_usd IS NOT NULL) OR (priced = 0 AND cost_usd IS NULL)),
  unpriced_reason    TEXT,
  opportunity_id     INTEGER REFERENCES opportunity (id)
);

-- How the AI's reading of each job went: when it finished, or why it could
-- not (no key yet, the AI did not answer...). Both NULL on jobs saved before
-- this task, which were never read by the AI.
ALTER TABLE opportunity ADD COLUMN extracted_at TEXT;
ALTER TABLE opportunity ADD COLUMN extraction_problem TEXT;

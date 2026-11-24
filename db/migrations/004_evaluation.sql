-- Task 2.5: each saved job's fit score, with its reasons (lib/score.ts).
--
-- One row per scoring. A job scored again gets a new row, so an old score
-- still names the preferences version it used; the newest row is the one in
-- force. A hard exclusion is kept apart from the score: an excluded job has
-- no score at all (score NULL) and names the exclusion it met, so it can
-- never be ranked.
CREATE TABLE evaluation (
  id                   INTEGER PRIMARY KEY,
  opportunity_id       INTEGER NOT NULL REFERENCES opportunity (id),
  -- NULL when no preferences had been saved yet and the starting ones were used.
  preferences_version  INTEGER REFERENCES preferences (version),
  -- Which set of rules scored it ("rules-1"), so a later change of rules shows.
  scorer_version       TEXT    NOT NULL,
  excluded             INTEGER NOT NULL CHECK (excluded IN (0, 1)),
  exclusions           TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(exclusions)),
  score                INTEGER CHECK (score BETWEEN 0 AND 100),
  confidence           TEXT    NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  -- The five dimensions: each one's score, weight, evidence, unknowns and confidence.
  dimensions           TEXT    NOT NULL CHECK (json_valid(dimensions)),
  unknowns             TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(unknowns)),
  -- Things for Dane to look at that are not exclusions (a new client, a rule
  -- the app could not check by itself).
  flags                TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(flags)),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((excluded = 1 AND score IS NULL) OR (excluded = 0 AND score IS NOT NULL))
);

CREATE INDEX evaluation_by_opportunity ON evaluation (opportunity_id, id);

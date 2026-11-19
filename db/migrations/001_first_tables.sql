-- The first three tables (development plan C4). Each later task adds only
-- the tables it uses, in a migration of its own. Never edit this file once it
-- has run on the Mini: write a new migration instead.

-- A job post Dane found on Upwork and pasted in (task 2.1). The link is how
-- a duplicate is recognised. A field the post did not state stays NULL,
-- which the app shows as "unknown".
CREATE TABLE opportunity (
  id           INTEGER PRIMARY KEY,
  url          TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  budget       TEXT,
  client       TEXT,
  posted_at    TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Dane's search preferences and ranking weights (task 2.2, C10). Versioned:
-- a change is a new row, never an edit, so an old evaluation can still name
-- the version it used. The newest version is the one in force.
CREATE TABLE preferences (
  version     INTEGER PRIMARY KEY,
  settings    TEXT    NOT NULL CHECK (json_valid(settings)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The portfolio evidence a proposal is allowed to cite (task 2.3). Only rows
-- Dane has approved for use may ever reach a draft.
CREATE TABLE portfolio_evidence (
  id                 INTEGER PRIMARY KEY,
  project            TEXT    NOT NULL,
  status             TEXT    NOT NULL CHECK (status IN ('delivered', 'in progress', 'planned')),
  features           TEXT    NOT NULL DEFAULT '',
  links              TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(links)),
  approved_for_use   INTEGER NOT NULL DEFAULT 0 CHECK (approved_for_use IN (0, 1)),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Task 3.4 (hand-off §13.11): Dane copies an approved proposal into Upwork
-- himself, then says "I sent it". The app never sends anything, so this row
-- records only his word that he did (lib/sent.ts).
--
-- A send is tied to the approval it was sent under: the version he approved
-- and copied, byte for byte (approval.approved_draft). An approval is never
-- deleted, so the record of what he sent survives a later edit.
--
-- `sent_by` can only ever say Dane: nothing here can record a send by the app.
CREATE TABLE sent_record (
  id           INTEGER PRIMARY KEY,
  proposal_id  INTEGER NOT NULL REFERENCES proposal (id),
  approval_id  INTEGER NOT NULL UNIQUE REFERENCES approval (id),
  sent_by      TEXT    NOT NULL DEFAULT 'Dane' CHECK (sent_by = 'Dane'),
  confirmed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX sent_record_by_proposal ON sent_record (proposal_id, id);

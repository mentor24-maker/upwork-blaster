## 2026-11-27 — Add a one-file JSON export of all of Dane's data (#24)

The home page now has an **Export my data** link. One click downloads a single
file, `upwork-blaster-export-<date>.json`. JSON is a plain text format that
almost any program can open, so his data never gets stuck inside the app.

The file holds everything he has put in: his saved jobs, his Pursue / Pass /
Revisit decisions, the app's scores, every version of his preferences (not only
the newest), his portfolio entries, his proposals and screening answers, the
exact versions he approved, what he marked as sent, and every move, note and
next action on the Pipeline board. A short section at the top says when the
file was made (Mountain time) and which version of the database it came from,
so whoever reads it later knows what shape to expect.

It is safe by design. The code that builds the file reads only the database,
never the app's settings, so the password, the sign-in key and the AI key can't
end up in it. The tests check that with made-up values. Someone who is not
signed in gets nothing: a page visit is sent to the sign-in page, and the
download itself answers with an empty "not allowed".

The AI spending log and the activity log are left out. They describe the app,
not his work. The daily database copy is still the real backup.

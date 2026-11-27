## 2026-11-27 — Add an activity log page recording what Dane and the AI did (#23)

Upwork Blaster now keeps a diary of what happened. Each time Dane saves a
job, the AI reads it or writes a draft, the app scores it, or Dane decides,
edits, approves, copies, marks it sent or moves it on the Pipeline board, the
app writes one plain sentence saying who did what. The new Activity page
(linked from the home page) shows those sentences newest first, with the time
in Mountain time.

Why it matters: Dane can look back and see exactly what he did and what the
AI did, without digging through pages. Because the page shows text, every
line is checked before it is saved, and anything that looks like the app
password, the session key, the AI key or a sign-in cookie is replaced with
"[hidden]". The full end-to-end test now fails if any step stops leaving its
line, or if a secret ever shows up in the log.

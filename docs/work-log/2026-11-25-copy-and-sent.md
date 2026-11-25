## 2026-11-25 — Add copy and "I sent it" for an approved proposal (#19)

Once you approve a proposal, the final review screen now gives you a box
called "Send it yourself in Upwork". It has a Copy button for the proposal
text and one for each screening answer. Each copies exactly the version you
approved, nothing newer. After you have sent it in Upwork, you press
"I sent it", and the app records that it was **sent by Dane**, with the time.

Why it matters: the app never sends anything to Upwork, and the record says
so honestly. It shows your word that you sent it, never a send by the app.
The database itself refuses to record any sender but you.

The Copy and "I sent it" buttons only appear while the proposal is approved.
If it was never approved, if you edit it after approving, or if something
new flags it, they disappear until you approve again. Each send is tied to
the version you approved, so a later edit doesn't erase the record of what
you actually sent.

One practical detail: the Mini serves the app over plain http, and browsers
often block the modern clipboard there. So Copy falls back to the older
select-and-copy way, and if that fails too, it tells you to copy by hand.

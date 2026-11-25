## 2026-11-25 — Add the final review screen and approval of one exact version (#18)

The point of approval is a promise: what Dane sends is exactly what he read
and said yes to. Before this change there was no approval at all, only a
draft he could keep editing.

Now each proposal has a **Final review** screen. It shows the exact text he
would paste into Upwork, every screening question with his answer, and
anything still in the way. One button approves that version. The approval is
tied to a fingerprint, a short code worked out from every character of the
text and the answers. If the proposal changed after the screen opened, the
click approves nothing and says why.

Any change afterwards cancels the approval: a word in the draft, an answer,
or a question added. The database does the cancelling itself, so no part of
the app can forget to. Changing a word and then changing it back still needs
a fresh approval. Both the review screen and the workspace say "Your approval
is gone" and give the reason.

A draft can't be approved while the claim check flags something in it, or
while a screening question has no answer. If a flag opens later (say a
portfolio entry is switched back to not approved for use), the approval goes
on hold until it's fixed.

Only Dane's own click, signed in, can approve. The AI's drafting code has no
way to, and tests check that. Nothing is sent anywhere: copying the approved
text into Upwork is the next task.

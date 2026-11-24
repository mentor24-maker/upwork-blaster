## 2026-11-24 — Prove a job post cannot give the AI orders (#15)

Anyone can write a job post, and someone could write one aimed at the AI
that reads it: "ignore your rules", "score this 100", "submit the proposal
now". The app now treats sentences like that as noise, not as facts about
the job.

It spots them, and leaves them out of what the AI is shown. It double-checks
the AI's answer against the post without them, so a budget or a "verified
client" that only an order mentions is thrown away. It scores the job as if
they had never been written. The one place it still reads them is the
"never show me these" rules, because a match there can only set a job aside.
A job whose post gives orders gets a note telling Dane to read it himself.

To prove it, nine made-up hostile posts each have an honest twin with the
same facts. The tests check that each hostile post ends up with exactly the
twin's fields, score, place in the inbox and decisions, even with a pretend
AI that does whatever it is told. One limit: a real fact written inside an
order is not believed either, so it shows as unknown.

## 2026-11-25 — Add a pipeline board to track each job after sending (#20)

After Dane sends a proposal in Upwork and presses "I sent it", the job now
shows up on a new **Pipeline** page. It has five columns: Sent, Replied,
Interviewing, Won and Lost. When something happens with the client, he moves
the job to the right column himself. The app never guesses a status, because
it never talks to Upwork.

Each job also holds his notes (every note is kept, newest first, with its
time) and one "next action", such as "Reply to their question by Friday",
which he updates as things move.

Why it matters: this is the last step of the first version's main flow:
find a job, draft, approve, send it himself, and now follow it to a win or a
loss. Every move is kept, not overwritten, so the history can later feed the
simple outcome numbers (task 6.4) without guessing.

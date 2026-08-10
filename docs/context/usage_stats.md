# Usage stats

Referenced from `CLAUDE.md`.

**Usage stats are local-only** (`usage_stats.json`, `schema::usage_stats`): a
rolling hour+day counter store behind the daily recap (which agents/models you
used, prompts asked, shell commands, file churn, tabs). It clones
`schema::net_usage`'s bucket+prune shape but its payload is an **open
string-keyed counter map**, so adding a statistic costs one const in `metric`
(mirrored in `src/lib/usageMetrics.ts`) and one render line — no migration.
Deliberately NOT counted into it: **time** (`time_summary.json`), **network
bytes** (`net_usage.json`) and **git** (re-derived from `git log` on demand) —
the recap reads those at their source so they can never drift. Tab opens are
counted in the frontend's `addTab`, *not* at `pty_spawn`, because the backend
spawn fires again for every resumable agent tab respawned on relaunch. File
churn comes from a recursive `notify` watcher on the **active** project
(`services::usage_stats`); it cannot see an SFTP tree, so a remote project is
counted only via its local mirror. The recap (`components/stats/`) opens on the
first launch of each day (`daily_stats_recap`, default on) and from Settings.

**How that watch is attached is platform-shaped, and has to be**
(`attach_watch`). inotify has no recursive mode and charges one watch descriptor
per directory out of a per-user budget, so Linux descends the tree itself and
prunes the ignored subtrees — cheap per call, and the pruning is what stops a
project with two virtualenvs from exhausting the budget for every other
application on the machine. FSEvents and `ReadDirectoryChangesW` are natively
recursive, and there one `watch()` call is *not* one syscall: `notify`'s FSEvents
backend rebuilds the whole stream and its runloop thread on every call, measured
at ~25–48 ms each, so the same per-directory walk cost **3m31s** on a project
with 8530 surviving directories — on the main thread, at every launch. So the
prune is a Linux economy that inverts sign elsewhere, and only the platforms that
need it pay it.

Two consequences are worth knowing. Under the recursive branch, events from
`target/`, `node_modules/` and the user's own excluded folders are *delivered*
and discarded rather than never sent — a path scan per event, on the watcher's
thread. And the user's "Exclude from scans" list can no longer be enforced by
declining to watch those directories, so it is applied to the event stream
instead (`is_user_excluded`), on **every** platform: on Linux those events never
arrive, so the check is dead weight there rather than a second, divergent notion
of what to skip. `usage_watch_project` is `async` + `spawn_blocking` for the
other half of the same lesson — the attach must never run on the UI thread
whatever it costs, since the command also fires on every project switch.

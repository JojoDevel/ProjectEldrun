#!/usr/bin/env bash
# Shell primitives whose spelling differs between GNU coreutils (Linux) and BSD
# userland (macOS). Sourced by the dev scripts, never executed on its own.
#
# It exists because three scripts here need the same four facts — how big a file
# is, when a file was last written, when a process started, and a timestamp a
# human can read — and every one of them is spelled differently on the two
# platforms. Written inline, each script grew its own `stat -c`, and on a Mac
# each one broke *quietly*:
#
#   - `start-eldrun-tauri-hotreload.sh` guarded its size probe with
#     `|| echo 0`, so a failing `stat -c` read as "0 bytes" and the 64 MB log
#     rotation simply never fired. That log has reached 2 GB before.
#   - `backend-stale.sh` read the start time from `/proc`, which does not exist
#     on macOS, and its miss path prints a notice and `exit 0` — so on every
#     Mac it answered "not stale", unconditionally, which is precisely the
#     answer it was written to be able to disprove.
#
# That shared failure mode is the argument for one file rather than a branch in
# each: all of these commands fail OPEN. A wrong answer is silent, reads as
# good news, and is therefore never investigated. Centralized, the branch is
# written once and any script that sources this cannot forget it.
#
# Every function prints nothing and returns non-zero when it cannot answer —
# never a zero, never a guess. Callers must decide what an unknown means; they
# must not be handed a plausible number.

# One probe, at source time. `uname` is in POSIX, so this is the one thing here
# that needs no branch of its own.
case "$(uname -s)" in
  Darwin | *BSD) ELDRUN_BSD_STAT=1 ;;
  *) ELDRUN_BSD_STAT=0 ;;
esac

# Size of a file in bytes.
portable_file_size() {
  if [ "$ELDRUN_BSD_STAT" = 1 ]; then
    stat -f %z "$1" 2>/dev/null
  else
    stat -c %s "$1" 2>/dev/null
  fi
}

# Modification times for one or more files, as `<epoch><TAB><path>` lines.
#
# Batched deliberately: the caller is looking for the NEWEST file in a source
# tree of a few hundred, and a `stat` fork per file turns a status check into a
# visible pause. Both implementations take a file list.
portable_mtimes() {
  [ "$#" -gt 0 ] || return 0
  if [ "$ELDRUN_BSD_STAT" = 1 ]; then
    stat -f '%m	%N' "$@" 2>/dev/null
  else
    stat -c '%Y	%n' "$@" 2>/dev/null
  fi
}

# When a process started, in epoch seconds.
#
# The two platforms are not merely spelled differently here, they answer
# different questions, so this is the one function whose implementations are not
# translations of each other:
#
#   Linux  — the mtime of the `/proc/<pid>` entry IS the start time. Exact, and
#            preferred over parsing `ps -o lstart`, whose format follows the
#            locale.
#   macOS  — there is no `/proc`, and every `ps` field that names an absolute
#            time (`lstart`, `start`) is locale-formatted for the same reason.
#            `etime` is not: it is ELAPSED time in a fixed `[[dd-]hh:]mm:ss`
#            shape, so the start time is derived by subtracting it from now.
#            Accurate to the second, which is far finer than the mtime
#            comparison it feeds.
#
# `etimes` (elapsed as plain seconds) would need no parsing at all and is what
# this would use if it existed — it is a procps extension, and BSD `ps` answers
# `keyword not found`.
portable_proc_start_epoch() {
  local pid="$1"
  [ -n "$pid" ] || return 1

  if [ "$ELDRUN_BSD_STAT" != 1 ]; then
    local started
    started="$(stat -c %Y "/proc/$pid" 2>/dev/null)" || return 1
    [ -n "$started" ] || return 1
    printf '%s\n' "$started"
    return 0
  fi

  local elapsed
  elapsed="$(ps -p "$pid" -o etime= 2>/dev/null | tr -d ' ')" || return 1
  [ -n "$elapsed" ] || return 1

  # [[dd-]hh:]mm:ss → seconds. Split the optional day part off first, then read
  # the clock part from the RIGHT, since it is the leading fields that are
  # omitted for a young process ("04:11" is 4m11s, not 4h11m).
  local days=0 clock="$elapsed"
  case "$elapsed" in
    *-*)
      days="${elapsed%%-*}"
      clock="${elapsed#*-}"
      ;;
  esac

  local secs=0 part
  local IFS=:
  for part in $clock; do
    # Strip leading zeros so `08` is not read as invalid octal by $(( )).
    part="${part#"${part%%[!0]*}"}"
    secs=$((secs * 60 + ${part:-0}))
  done
  unset IFS

  days="${days#"${days%%[!0]*}"}"
  secs=$((secs + ${days:-0} * 86400))

  printf '%s\n' "$(($(date +%s) - secs))"
}

# Now, as a sortable timestamp with an offset. GNU's `date -Is` is the short
# spelling and BSD `date` rejects it outright (`invalid argument 's' for -I`),
# so both sides use the explicit format string, which is portable and says what
# it produces.
portable_iso_now() {
  date +%Y-%m-%dT%H:%M:%S%z
}

# An epoch second, formatted for a human to read.
portable_fmt_epoch() {
  if [ "$ELDRUN_BSD_STAT" = 1 ]; then
    date -r "$1" '+%F %T' 2>/dev/null
  else
    date -d "@$1" '+%F %T' 2>/dev/null
  fi
}

# Executed rather than sourced: dispatch a single helper as a subcommand.
#
# This exists for `xargs`, which can invoke a command and cannot invoke a shell
# function — so the one caller that needs to stat a whole source tree in
# batches has something to hand it. Sourcing stays the normal way in; this
# branch is inert then, because `BASH_SOURCE[0]` only equals `$0` when the file
# is run directly. A long file list makes xargs call this more than once, which
# is harmless: each run prints its own share of the lines.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  eldrun_portable_cmd="${1:-}"
  shift || true
  case "$eldrun_portable_cmd" in
    mtimes) portable_mtimes "$@" ;;
    size) portable_file_size "$@" ;;
    proc-start) portable_proc_start_epoch "$@" ;;
    iso-now) portable_iso_now ;;
    fmt-epoch) portable_fmt_epoch "$@" ;;
    *)
      echo "usage: portable.sh {mtimes|size|proc-start|iso-now|fmt-epoch} [args…]" >&2
      exit 2
      ;;
  esac
fi

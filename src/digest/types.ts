// Plan morning-digest § 1. Types only: the reader implements `ReadNight` in another file, and
// the page, the JSON, the board link and the route tests (§ 2) are built against these.

/** Status of one run, as written in the log. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/**
 * One parsed line of `runs/<night>.jsonl`. A line that is not valid JSON or lacks a valid
 * `at`, `job` or `status` does not become a `RunLine`; it is counted in `Night.badLines`.
 */
export type RunLine = {
  /** ISO 8601 time exactly as in the log, offset kept (e.g. `2026-10-29T01:30:00+01:00`). */
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

/** One row per job for a night. */
export type DigestRow = {
  job: string;
  /** Owner from the job's last line. `null` is kept, never dropped; views render it as `—`. */
  owner: string | null;
  /** Number of parsed lines for this job. */
  runs: number;
  /** Number of those lines with status `retry`. */
  retries: number;
  /** Status of the job's last line (latest `at`). */
  lastStatus: RunStatus;
  /** Error of the job's last line, `null` if it has none. Views render `null` as `—`. */
  lastError: string | null;
  /** Earliest `at` for this job, the string exactly as in the log; never converted to UTC. */
  firstAt: string;
  /** Latest `at` for this job, the string exactly as in the log; never converted to UTC. */
  lastAt: string;
};

/** A night read from disk. */
export type Night = {
  /** The night asked for, `YYYY-MM-DD`. */
  night: string;
  /**
   * Rows sorted by `job` (plain string order, `a.job < b.job`). Already sorted here, so the
   * page and the JSON use this order as is and can't disagree (ADR 0001). An empty file gives
   * `[]` (render "nothing ran").
   */
  rows: DigestRow[];
  /** Lines that didn't parse (blank lines are not counted). Counted, never thrown. */
  badLines: number;
};

/**
 * Reads `<runsDir>/<night>.jsonl`. Returns `null` when that file does not exist (routes answer
 * 404); an existing file always gives a `Night`, even if empty or full of bad lines.
 */
export type ReadNight = (runsDir: string, night: string) => Night | null;

/** Parsed lines of a night by `status` (every run, not one per job), for the board link (plan § 2c). */
export type NightCounts = Record<RunStatus, number>;

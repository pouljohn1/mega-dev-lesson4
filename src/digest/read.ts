// Plan morning-digest § 1. Reads `runs/<night>.jsonl` into one row per job (`readNight`) and
// counts runs by status (`countNight`). Both share `parseNight`, the only parser of the log.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, NightCounts, ReadNight, RunLine, RunStatus } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

type ParsedNight = { lines: RunLine[]; badLines: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

/** One log line to a `RunLine`, or `null` if it is not valid JSON or misses a required field. */
function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { at, job, status, owner, error } = value;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;
  const line: RunLine = { at, job, status, owner };
  if (error !== undefined) line.error = error;
  return line;
}

/**
 * Reads and parses `<runsDir>/<night>.jsonl`. `null` when `night` is not `YYYY-MM-DD` (so a
 * route param can't reach outside `runsDir`) or when the file does not exist.
 */
function parseNight(runsDir: string, night: string): ParsedNight | null {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    if (isRecord(err) && err.code === 'ENOENT') return null;
    throw err;
  }
  const lines: RunLine[] = [];
  let badLines = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line) lines.push(line);
    else badLines += 1;
  }
  return { lines, badLines };
}

function toRow(lines: RunLine[]): DigestRow {
  // `lines` is non-empty and in file order. Ties on time: the later line in the file wins.
  let first = lines[0]!;
  let last = lines[0]!;
  let retries = 0;
  for (const line of lines) {
    const t = Date.parse(line.at);
    if (t < Date.parse(first.at)) first = line;
    if (t >= Date.parse(last.at)) last = line;
    if (line.status === 'retry') retries += 1;
  }
  return {
    job: last.job,
    owner: last.owner,
    runs: lines.length,
    retries,
    lastStatus: last.status,
    lastError: last.error ?? null,
    firstAt: first.at,
    lastAt: last.at,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  const parsed = parseNight(runsDir, night);
  if (!parsed) return null;
  const byJob = new Map<string, RunLine[]>();
  for (const line of parsed.lines) {
    const group = byJob.get(line.job);
    if (group) group.push(line);
    else byJob.set(line.job, [line]);
  }
  const rows = [...byJob.values()]
    .map(toRow)
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  const result: Night = { night, rows, badLines: parsed.badLines };
  return result;
};

/** Parsed lines by status over every run of the night; `null` exactly when `readNight` is. */
export function countNight(runsDir: string, night: string): NightCounts | null {
  const parsed = parseNight(runsDir, night);
  if (!parsed) return null;
  const counts: NightCounts = { ok: 0, retry: 0, fail: 0 };
  for (const line of parsed.lines) counts[line.status] += 1;
  return counts;
}

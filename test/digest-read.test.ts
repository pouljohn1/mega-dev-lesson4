import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { countNight, readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('gives 5 jobs and 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.rows).toHaveLength(5);
    expect(night?.badLines).toBe(1);
  });

  it('sorts rows by job', () => {
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('keeps a null owner', () => {
    const row = night?.rows.find((r) => r.job === 'digest/render');
    expect(row?.owner).toBeNull();
    expect(row?.runs).toBe(1);
  });

  it('counts runs and retries and takes the last status', () => {
    expect(night?.rows.find((r) => r.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps the error of a failed last run', () => {
    const row = night?.rows.find((r) => r.job === 'notes/backup');
    expect(row?.lastStatus).toBe('fail');
    expect(row?.lastError).toBe('quota exceeded');
    expect(row?.owner).toBe('lane-07');
  });

  it('keeps offsets in firstAt and lastAt', () => {
    expect(night?.rows.find((r) => r.job === 'lane/sync')).toEqual({
      job: 'lane/sync',
      owner: 'rook',
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('countNight counts every parsed run by status', () => {
    expect(countNight('runs', '2026-10-28')).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
    expect(countNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    writeFileSync(join(dir, 'secret.jsonl'), '{"at":"2026-10-29T01:00:00+01:00","job":"x","status":"ok","owner":null}\n');
    for (const bad of ['../etc', '../etc/passwd', 'secret', '2026-1-01', '2026-10-28/../secret', '']) {
      expect(readNight(dir, bad)).toBeNull();
      expect(countNight(dir, bad)).toBeNull();
    }
  });

  it('reads an empty file as no rows', () => {
    writeFileSync(join(dir, '2026-02-01.jsonl'), '');
    expect(readNight(dir, '2026-02-01')).toEqual({ night: '2026-02-01', rows: [], badLines: 0 });
    expect(countNight(dir, '2026-02-01')).toEqual({ ok: 0, retry: 0, fail: 0 });
  });

  it('ignores blank lines', () => {
    writeFileSync(
      join(dir, '2026-02-02.jsonl'),
      '\n  \n{"at":"2026-02-02T01:00:00+01:00","job":"a","status":"ok","owner":"rook"}\n\n\t\n',
    );
    const night = readNight(dir, '2026-02-02');
    expect(night?.rows).toHaveLength(1);
    expect(night?.badLines).toBe(0);
  });

  it('counts lines with a wrong shape as bad', () => {
    const lines = [
      '{"at":"2026-02-03T01:00:00+01:00","job":"a","status":"ok","owner":"rook"}',
      'not json',
      '[]',
      '{"at":"not a date","job":"a","status":"ok","owner":"rook"}',
      '{"job":"a","status":"ok","owner":"rook"}',
      '{"at":"2026-02-03T01:00:00+01:00","job":"","status":"ok","owner":"rook"}',
      '{"at":"2026-02-03T01:00:00+01:00","job":"a","status":"done","owner":"rook"}',
      '{"at":"2026-02-03T01:00:00+01:00","job":"a","status":"ok","owner":7}',
      '{"at":"2026-02-03T01:00:00+01:00","job":"a","status":"ok","owner":"rook","error":42}',
    ];
    writeFileSync(join(dir, '2026-02-03.jsonl'), lines.join('\n'));
    const night = readNight(dir, '2026-02-03');
    expect(night?.rows.map((r) => r.runs)).toEqual([1]);
    expect(night?.badLines).toBe(8);
  });

  it('takes the last run by time, not file order, with ties to the later line', () => {
    const lines = [
      '{"at":"2026-02-04T03:00:00+01:00","job":"a","status":"fail","owner":"x","error":"first"}',
      '{"at":"2026-02-04T01:00:00+01:00","job":"a","status":"retry","owner":"y"}',
      '{"at":"2026-02-04T02:00:00Z","job":"a","status":"ok","owner":"z"}',
    ];
    writeFileSync(join(dir, '2026-02-04.jsonl'), lines.join('\n'));
    const row = readNight(dir, '2026-02-04')?.rows[0];
    // 02:00Z is 03:00+01:00: same instant as line 1, so the later line wins.
    expect(row?.lastStatus).toBe('ok');
    expect(row?.owner).toBe('z');
    expect(row?.lastError).toBeNull();
    expect(row?.firstAt).toBe('2026-02-04T01:00:00+01:00');
    expect(row?.lastAt).toBe('2026-02-04T02:00:00Z');
  });
});

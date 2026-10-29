import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow } from '../src/digest/types.js';

type DigestJson = { night: string; rows: DigestRow[]; badLines: number };

const NORMAL = '2026-10-28';
const EMPTY = '2026-10-27';
const BAD = '2026-10-26';
const MISSING = '2026-10-25';

let runsDir = '';

beforeAll(() => {
  runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-runs-'));
  // Lines are deliberately out of job order, so sorting is what the tests see.
  const normal = [
    { at: '2026-10-28T03:00:00+01:00', job: 'cleanup', status: 'fail', owner: null, error: 'disk full' },
    { at: '2026-10-28T02:00:00+01:00', job: 'backup', status: 'retry', owner: 'ops', error: 'timeout' },
    { at: '2026-10-28T01:30:00+01:00', job: 'backup', status: 'ok', owner: 'ops' },
    { at: '2026-10-28T02:10:00+01:00', job: 'backup', status: 'ok', owner: 'ops' },
    { at: '2026-10-28T01:00:00+01:00', job: 'alerts', status: 'ok', owner: 'nobody' },
  ];
  fs.writeFileSync(
    path.join(runsDir, `${NORMAL}.jsonl`),
    normal.map((line) => JSON.stringify(line)).join('\n') + '\n',
  );
  fs.writeFileSync(path.join(runsDir, `${EMPTY}.jsonl`), '');
  fs.writeFileSync(
    path.join(runsDir, `${BAD}.jsonl`),
    [
      JSON.stringify({ at: '2026-10-26T02:00:00+01:00', job: 'sync', status: 'ok', owner: 'ops' }),
      '{"at":"2026-10-26T01:30:00+01:00","job":"bac',
      JSON.stringify({ at: '2026-10-26T01:00:00+01:00', job: 'backup', status: 'ok', owner: 'ops' }),
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  fs.rmSync(runsDir, { recursive: true, force: true });
});

const config = () => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

describe('digest page', () => {
  it('renders 200 with one row per job, missing owner as the dash placeholder', async () => {
    const res = await createApp(config()).request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('alerts');
    expect(html).toContain('backup');
    expect(html).toContain('cleanup');
    expect(html).toContain('disk full');
    expect(html).toContain('—');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config()).request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('says "nothing ran" for an empty night', async () => {
    const res = await createApp(config()).request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('renders 200 with the good rows and ignores the bad line', async () => {
    const res = await createApp(config()).request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('sync');
    expect(html).toContain('backup');
  });
});

describe('digest JSON', () => {
  it('returns 200 with rows sorted by job and the expected fields', async () => {
    const res = await createApp(config()).request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.night).toBe(NORMAL);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((row) => row.job)).toEqual(['alerts', 'backup', 'cleanup']);

    const backup = body.rows.find((row) => row.job === 'backup');
    expect(backup).toEqual({
      job: 'backup',
      owner: 'ops',
      runs: 3,
      retries: 1,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-28T01:30:00+01:00',
      lastAt: '2026-10-28T02:10:00+01:00',
    });

    const cleanup = body.rows.find((row) => row.job === 'cleanup');
    expect(cleanup?.owner).toBeNull();
    expect(cleanup?.lastError).toBe('disk full');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config()).request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('returns an empty rows array for an empty night', async () => {
    const res = await createApp(config()).request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.rows).toEqual([]);
  });

  it('counts the bad line and keeps the good rows', async () => {
    const res = await createApp(config()).request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((row) => row.job)).toEqual(['backup', 'sync']);
  });
});

describe('digest page and JSON agree', () => {
  it('lists the jobs in the page in the same order as the JSON rows', async () => {
    const app = createApp(config());
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    const body = (await (await app.request(`/api/digest/${NORMAL}`)).json()) as DigestJson;

    const positions = body.rows.map((row) => html.indexOf(row.job));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

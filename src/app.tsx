import { Hono } from 'hono';
import { readNight } from './digest/read.js';
import { loadConfig, type RigConfig } from './config.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  app.get('/api/digest/:night', (c) => {
    const param = c.req.param('night');
    const night = readNight(config.runsDir, param);
    if (!night) return c.json({ error: 'no run log for that night', night: param }, 404);
    return c.json(night);
  });

  return app;
}

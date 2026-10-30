import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Server } from 'colyseus';
import express from 'express';
import { MATCH, ROOM_NAME, SERVER_PORT, initPhysics } from '@splat/shared';
import { SplatRoom } from './SplatRoom';

async function main(): Promise<void> {
  await initPhysics();
  // Short matches for automated flow checks.
  if (process.env.SPLAT_MATCH_SEC) MATCH.durationSec = Number(process.env.SPLAT_MATCH_SEC);
  const app = express();
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDist = join(here, '../../client/dist');
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  const hasClient = existsSync(join(clientDist, 'index.html'));
  if (hasClient) {
    app.use(express.static(clientDist));
    // Invite links (/?room=ABCDE) and any other path fall back to the SPA.
    app.get(/^\/(?!matchmake).*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
  }
  const port = Number(process.env.PORT) || SERVER_PORT;
  const server = new Server({ transport: new WebSocketTransport({ server: createServer(app) }) });
  server.define(ROOM_NAME, SplatRoom);
  await server.listen(port, '0.0.0.0');
  console.log(`[splat] listening on :${port}${hasClient ? ' (serving client)' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

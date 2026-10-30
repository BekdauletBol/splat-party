// Headless load test: connects N fake players (default 7) to one room, wanders
// and shoots for a while, then reports the server tick rate seen by clients.
//   npm run bots -- --clients 7 --secs 30 [--room ABCDE] [--url http://host:2567]
import { Client, Room } from 'colyseus.js';
import { Btn, CHARACTER_IDS, MSG, ROOM_NAME, SERVER_PORT, TICK_DT, TICK_RATE } from '@splat/shared';

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const url = arg('url', `http://localhost:${SERVER_PORT}`);
const count = Number(arg('clients', '7'));
const secs = Number(arg('secs', '30'));
const code = arg('room', '');
const mode = arg('mode', 'ffa');

interface Fake {
  room: Room;
  seq: number;
  yaw: number;
  bytes: number;
}

async function main(): Promise<void> {
  const client = new Client(url);
  const fakes: Fake[] = [];
  const first = code ? await client.joinById(code, { nick: 'Load 0', char: CHARACTER_IDS[0] }) : await client.create(ROOM_NAME, { nick: 'Load 0', char: CHARACTER_IDS[0], bots: 0, mode });
  fakes.push({ room: first, seq: 0, yaw: 0, bytes: 0 });
  for (let i = 1; i < count; i++) {
    const room = await client.joinById(first.roomId, { nick: `Load ${i}`, char: CHARACTER_IDS[i % CHARACTER_IDS.length] });
    fakes.push({ room, seq: 0, yaw: Math.random() * 6, bytes: 0 });
  }
  for (const f of fakes) {
    f.room.onMessage('*', () => {});
    (f.room.connection.transport as unknown as { ws?: { addEventListener(t: string, cb: (e: { data: ArrayBuffer }) => void): void } }).ws?.addEventListener('message', (e) => {
      f.bytes += e.data?.byteLength ?? 0;
    });
  }
  console.log(`room ${first.roomId}: ${fakes.length} clients connected`);
  for (const f of fakes.slice(1)) f.room.send(MSG.Ready);
  await new Promise((r) => setTimeout(r, 300));
  if (!code) first.send(MSG.Start);

  const startTick = first.state.tick;
  const t0 = Date.now();
  const timer = setInterval(() => {
    for (const f of fakes) {
      if (Math.random() < 0.02) f.yaw += (Math.random() - 0.5) * 3;
      let b = Btn.Fire;
      if (Math.random() < 0.02) b |= Btn.Jump;
      if (Math.random() < 0.005) b |= Btn.Dash;
      f.room.send(MSG.Input, [{ s: ++f.seq, mx: Math.sin(f.seq / 40), mz: 1, y: f.yaw, ay: f.yaw, ap: 0, b, w: 0, v: f.room.state.tick }]);
    }
  }, TICK_DT * 1000);

  await new Promise((r) => setTimeout(r, secs * 1000));
  clearInterval(timer);
  const elapsed = (Date.now() - t0) / 1000;
  const ticks = first.state.tick - startTick;
  const tickRate = ticks / elapsed;
  const kbps = fakes.reduce((s, f) => s + f.bytes, 0) / fakes.length / elapsed / 1024;
  const kills = [...first.state.players.values()].reduce((s: number, p: any) => s + p.kills, 0);
  console.log(JSON.stringify({ clients: fakes.length, phase: first.state.phase, tickRate: Number(tickRate.toFixed(1)), target: TICK_RATE, kbPerSecPerClient: Number(kbps.toFixed(1)), kills, acked: fakes.map((f) => f.room.state.players.get(f.room.sessionId)?.lastSeq) }));
  process.exit(tickRate > TICK_RATE * 0.9 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Verifies bot slot filling and that bots actually move and fight.
import { Client } from 'colyseus.js';
import { MSG, ROOM_NAME, SERVER_PORT } from '@splat/shared';

const url = process.env.URL ?? `http://localhost:${SERVER_PORT}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const c = new Client(url);
  const a = await c.create(ROOM_NAME, { nick: 'Host', bots: 7, difficulty: 2, map: process.env.MAP ?? 'kitchen' });
  a.onMessage('*', () => {});
  let kills = 0;
  let falls = 0;
  a.onMessage(MSG.Event, (e: any) => {
    if (e.t === 'kill') {
      kills++;
      if (e.cause === 'fall') falls++;
    }
  });
  await sleep(500);
  a.send(MSG.Start);
  await sleep(4000);
  const countBots = (): number => [...a.state.players.values()].filter((p: any) => p.isBot).length;
  const afterOne = countBots();
  const start = new Map<string, [number, number]>();
  a.state.players.forEach((p: any, id: string) => start.set(id, [p.x, p.z]));
  const b = await c.joinById(a.roomId, { nick: 'Friend' });
  b.onMessage('*', () => {});
  await sleep(500);
  const afterTwo = countBots();
  await sleep(Number(process.env.SECS ?? 25) * 1000);
  const moved: Record<string, number> = {};
  a.state.players.forEach((p: any, id: string) => {
    const s = start.get(id);
    if (s && p.isBot) moved[p.nick] = Math.round(Math.hypot(p.x - s[0], p.z - s[1]));
  });
  const stuck = Object.values(moved).filter((d) => d < 2).length;
  await b.leave();
  await sleep(500);
  const afterLeave = countBots();
  const r = { afterOne, afterTwo, afterLeave, kills, falls, moved, stuck, ok: afterOne === 7 && afterTwo === 6 && afterLeave === 7 && kills > 0 && stuck <= 1 };
  console.log(JSON.stringify(r, null, 1));
  process.exit(r.ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

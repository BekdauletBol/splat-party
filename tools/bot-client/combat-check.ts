// End-to-end smoke test of the authoritative combat loop. Two real clients join a
// room; A aims at B purely through inputs. Run with: npx tsx combat-check.ts
import { Client } from 'colyseus.js';
import { Btn, MATCH, MSG, ROOM_NAME, SERVER_PORT, TICK_DT, muzzleOf } from '@splat/shared';

const url = process.env.URL ?? `http://localhost:${SERVER_PORT}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const client = new Client(url);
  const a = await client.create(ROOM_NAME, { nick: 'A', char: 'cactus', bots: 0, map: 'playground', mode: 'ffa' });
  const b = await client.joinById(a.roomId, { nick: 'B', char: 'baursak' });
  for (const r of [a, b]) r.onMessage('*', () => {});
  await sleep(300);
  a.send(MSG.Start);
  await sleep((MATCH.countdownSec + 0.5) * 1000);
  let seqA = 0;
  let seqB = 0;
  const pa = (): any => a.state.players.get(a.sessionId);
  const pb = (): any => a.state.players.get(b.sessionId);
  const log: Record<string, unknown> = {};
  let kills = 0;
  a.onMessage(MSG.Event, (e: any) => {
    if (e.t === 'kill') {
      kills++;
      log.lastKill = e;
    }
  });
  const startHp = pb().hp;
  let hit = false;
  const t0 = Date.now();
  let minHp = startHp;
  let alive = true;
  let sawDeath = false;
  let sawRespawn = false;
  // Fire for at most 20s, hunting B: A walks toward B and aims at it.
  while (Date.now() - t0 < 20000 && !sawRespawn) {
    const A = pa();
    const B = pb();
    const yaw = Math.atan2(-(B.x - A.x), -(B.z - A.z));
    const m = muzzleOf(A.x, A.y, A.z, yaw);
    const dx = B.x - m.x;
    const dy = B.y - m.y;
    const dz = B.z - m.z;
    const ay = Math.atan2(-dx, -dz);
    const ap = Math.atan2(dy, Math.hypot(dx, dz));
    const dist = Math.hypot(dx, dz);
    a.send(MSG.Input, [{ s: ++seqA, mx: 0, mz: dist > 12 ? 1 : 0, y: yaw, ay, ap, b: Btn.Fire | (seqA % 25 === 0 ? Btn.Jump : 0), w: 0, v: a.state.tick }]);
    b.send(MSG.Input, [{ s: ++seqB, mx: 0, mz: 0, y: 0, ay: 0, ap: 0, b: 0, w: 0, v: b.state.tick }]);
    if (B.hp < minHp) minHp = B.hp;
    if (B.hp < startHp) hit = true;
    if (!B.alive && alive) sawDeath = true;
    if (sawDeath && B.alive && !alive) sawRespawn = true;
    alive = B.alive;
    await sleep(TICK_DT * 1000);
  }
  // Forged input: huge values must not teleport or crash the server.
  const before = pa();
  const bx = before.x;
  a.send(MSG.Input, [{ s: ++seqA, mx: 9999, mz: -9999, y: NaN, ay: 'x', ap: 1e9, b: 9999, w: 77, v: -5, x: 500, hp: 999 }]);
  await sleep(200);
  const moved = Math.abs(pa().x - bx);
  const result = { startHp, hit, minHp, sawDeath, sawRespawn, kills, respawnHp: pb().hp, killerKills: pa().kills, forgedMove: moved, hpAfterForge: pa().hp, ok: hit && sawDeath && sawRespawn && moved < 2 };
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

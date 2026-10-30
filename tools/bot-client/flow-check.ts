// Full lobby → match → results → lobby flow across all modes. Run against a server
// started with SPLAT_MATCH_SEC=6 so matches finish quickly.
import { Client, Room } from 'colyseus.js';
import { MODE_IDS, MSG, MatchResults, ROOM_NAME, SERVER_PORT } from '@splat/shared';

const url = process.env.URL ?? `http://localhost:${SERVER_PORT}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(50);
  }
};
const quiet = (r: Room): void => r.onMessage('*', () => {});

async function main(): Promise<void> {
  const out: Record<string, unknown> = {};
  const c = new Client(url);
  const host = await c.create(ROOM_NAME, { nick: 'Host', bots: 3, difficulty: 2, isPrivate: true });
  quiet(host);
  let res: MatchResults | null = null;
  host.onMessage(MSG.Results, (r: MatchResults) => (res = r));
  await sleep(300);
  out.codeLength = host.roomId.length;

  // Private rooms stay out of quick play, but the code works.
  const quick = await c.joinOrCreate(ROOM_NAME, { quick: true, nick: 'Q' });
  quiet(quick);
  out.quickAvoidsPrivate = quick.roomId !== host.roomId;
  await until(() => quick.state.phase === 'playing' || quick.state.phase === 'countdown', 6000, 'quick auto start');
  out.quickAutoStart = true;
  await quick.leave();

  const guest = await c.joinById(host.roomId, { nick: 'Guest' });
  quiet(guest);
  await sleep(200);
  host.send(MSG.Start);
  await sleep(300);
  out.startBlockedUntilReady = host.state.phase === 'lobby';
  guest.send(MSG.Ready);
  await sleep(200);

  for (const mode of MODE_IDS) {
    res = null;
    host.send(MSG.Settings, { mode, map: mode === 'paint' || mode === 'koth' ? 'playground' : 'kitchen' });
    await sleep(200);
    host.send(MSG.Start);
    await until(() => host.state.phase === 'playing', 8000, `${mode} playing`);
    await until(() => host.state.phase === 'results' && res !== null, 40000, `${mode} results`);
    const r = res as unknown as MatchResults;
    out[mode] = { scoreA: r.scoreA, scoreB: r.scoreB, winnerTeam: r.winnerTeam, top: r.rows[0]?.nick, topScore: r.rows[0]?.score, awards: r.awards.map((a) => a.title) };
    host.send(MSG.Again);
    await until(() => host.state.phase === 'lobby', 3000, 'back to lobby');
    guest.send(MSG.Ready);
    await sleep(200);
  }

  // Non-host can't change settings, host migrates on leave.
  guest.send(MSG.Settings, { mode: 'tdm' });
  await sleep(200);
  out.guestCantConfigure = host.state.mode !== 'tdm';
  const oldHost = host.state.host;
  await host.leave();
  await until(() => guest.state.host !== oldHost, 2000, 'host migration');
  out.hostMigrated = guest.state.host === guest.sessionId;
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

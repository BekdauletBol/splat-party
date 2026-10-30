// M2 entry: minimal create/join, full menus come with the lobby milestone.
import { initPhysics } from '@splat/shared';
import { Game } from './game';
import { Connection } from './net/connection';

const params = new URLSearchParams(location.search);

async function start(): Promise<void> {
  await initPhysics();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const net = new Connection();
  const opts = { nick: `Игрок${Math.floor(Math.random() * 900 + 100)}`, char: 'pelmen' };
  const code = params.get('room');
  if (code) await net.join(code.toUpperCase(), opts);
  else await net.create(opts);
  history.replaceState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(params), room: net.room.roomId })}`);
  await new Promise<void>((res) => net.room.onStateChange.once(() => res()));
  const game = new Game(canvas, net, ui);
  game.loadMap(net.state.map);
  game.start();
  Object.assign(window, { __game: game, __net: net });
}

start().catch((e) => console.error(e));

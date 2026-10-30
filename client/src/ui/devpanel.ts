// lil-gui panel over every physics constant (?dev=1). Changes go to the server,
// which validates and rebroadcasts them, so prediction and authority stay in step.
import GUI from 'lil-gui';
import { MSG, PHYS, PHYS_RANGES, PhysKey } from '@splat/shared';
import type { Connection } from '../net/connection';

export function createDevPanel(net: Connection): GUI {
  const gui = new GUI({ title: 'Физика (dev)' });
  gui.domElement.style.pointerEvents = 'auto';
  const defaults = { ...PHYS };
  for (const key of Object.keys(PHYS) as PhysKey[]) {
    const [min, max, step] = PHYS_RANGES[key];
    gui
      .add(PHYS, key, min, max, step)
      .listen()
      .onChange((v: number) => net.send(MSG.Tune, { key, value: v }));
  }
  gui.add(
    {
      reset: () => {
        for (const key of Object.keys(defaults) as PhysKey[]) net.send(MSG.Tune, { key, value: defaults[key] });
      },
    },
    'reset',
  ).name('Сбросить');
  gui.close();
  return gui;
}

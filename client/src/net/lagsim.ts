// Debug network conditions: ?lag=150 adds that many ms round trip, ?loss=5 drops
// that percentage of unreliable-style traffic (inputs and state snapshots).
const params = new URLSearchParams(location.search);
const lag = Number(params.get('lag')) || 0;
const loss = (Number(params.get('loss')) || 0) / 100;

export const lagEnabled = lag > 0 || loss > 0;

export function outbound(fn: () => void, droppable = false): void {
  if (droppable && loss > 0 && Math.random() < loss) return;
  if (lag > 0) setTimeout(fn, lag / 2);
  else fn();
}

export function inbound(fn: () => void, droppable = false): void {
  if (droppable && loss > 0 && Math.random() < loss) return;
  if (lag > 0) setTimeout(fn, lag / 2);
  else fn();
}

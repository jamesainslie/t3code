import type { DesktopSshOutputBatch, DesktopSshOutputEntry } from "@t3tools/contracts";

/**
 * Follows one target's SSH output in the renderer: the snapshot from subscribing, then each
 * pushed batch, in `seq` order and without repeats. A push can arrive before the subscribe
 * reply names the target's key, so those wait for it.
 */
export function makeSshOutputFollower(
  listener: (entries: ReadonlyArray<DesktopSshOutputEntry>) => void,
) {
  let key: string | null = null;
  let lastSeq = 0;
  let early: DesktopSshOutputBatch[] = [];

  const deliver = (entries: ReadonlyArray<DesktopSshOutputEntry>) => {
    const fresh = entries.filter((entry) => entry.seq > lastSeq);
    const last = fresh.at(-1);
    if (last === undefined) return;
    lastSeq = last.seq;
    listener(fresh);
  };

  return {
    snapshot(batch: DesktopSshOutputBatch) {
      key = batch.key;
      deliver(batch.entries);
      for (const pushed of early) if (pushed.key === key) deliver(pushed.entries);
      early = [];
    },
    push(batch: DesktopSshOutputBatch) {
      if (key === null) early.push(batch);
      else if (batch.key === key) deliver(batch.entries);
    },
  };
}

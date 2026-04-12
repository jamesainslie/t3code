import { Context } from "effect";
import type { Stream } from "effect";
import type { HostResourceStreamEvent } from "@t3tools/contracts";

export interface HostResourceMonitorShape {
  /**
   * Subscribe to host resource events for a given workspace path.
   * First event is always a full snapshot. Subsequent events are threshold transitions.
   * The stream stays alive until the subscriber disconnects.
   */
  readonly subscribe: (workspacePath: string) => Stream.Stream<HostResourceStreamEvent>;
}

export class HostResourceMonitor extends Context.Service<
  HostResourceMonitor,
  HostResourceMonitorShape
>()("t3/hostResource/Services/HostResourceMonitor") {}

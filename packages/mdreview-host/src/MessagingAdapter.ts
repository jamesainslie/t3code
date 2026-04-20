import type { IPCMessage, MessagingAdapter as CoreMessagingAdapter } from "@mdreview/core";

/**
 * Null messaging adapter for the t3code mdview host. The browser extension
 * and Electron ports use this adapter to talk to background scripts, but the
 * t3code web app does everything over WebSocket RPC already. So every method
 * is a no-op that resolves with `undefined`. mdview core degrades gracefully
 * when messages go nowhere.
 */
export class T3NullMessagingAdapter implements CoreMessagingAdapter {
  async send(_message: IPCMessage): Promise<unknown> {
    return undefined;
  }
}

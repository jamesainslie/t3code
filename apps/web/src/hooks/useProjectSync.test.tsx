import { act, useSyncExternalStore } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { afterEach, expect, it, vi } from "vite-plus/test";

const connection = vi.hoisted(() => ({
  ready: false,
  prepared: {},
  listeners: new Set<() => void>(),
}));
vi.mock("../state/session", () => ({
  readPreparedConnection: () => (connection.ready ? {} : null),
  usePreparedConnection: () => {
    const ready = useSyncExternalStore(
      (listener) => {
        connection.listeners.add(listener);
        return () => connection.listeners.delete(listener);
      },
      () => connection.ready,
    );
    return ready ? Option.some(connection.prepared) : Option.none();
  },
}));
vi.mock("@t3tools/client-runtime/state/project-sync", () => ({
  executeProjectSync: () => ({ defaultSourceHome: "/main-install" }),
}));
vi.mock("../lib/runtime", () => ({ runtime: { runPromise: async (value: unknown) => value } }));
import { useProjectSync } from "./useProjectSync";

let view: ReactTestRenderer;
afterEach(async () => {
  await act(() => view?.unmount());
  connection.ready = false;
  connection.listeners.clear();
  vi.unstubAllGlobals();
});

it("loads sync status when the environment connects after Settings opens", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  function Status() {
    const { data, error } = useProjectSync(EnvironmentId.make("environment"));
    return <p>{data?.defaultSourceHome ?? error ?? "Connecting"}</p>;
  }
  await act(() => {
    view = create(<Status />);
  });
  await act(() => {
    connection.ready = true;
    for (const listener of connection.listeners) listener();
  });
  expect(view.root.findByType("p").children).toEqual(["/main-install"]);
});

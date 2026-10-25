import { useSyncExternalStore } from "react";
import { EnvironmentId } from "@lathe/contracts";
import * as Option from "effect/Option";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";

const connection = vi.hoisted(() => ({
  ready: false,
  prepared: {},
  listeners: new Set<() => void>(),
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  usePreparedConnection: (() => {
    const ready = useSyncExternalStore(
      (listener) => {
        connection.listeners.add(listener);
        return () => connection.listeners.delete(listener);
      },
      () => connection.ready,
    );
    return ready ? Option.some(connection.prepared) : Option.none();
  }) as never,
}));
vi.mock(import("@lathe/client-runtime/state/project-sync"), async (original) => ({
  ...(await original()),
  executeProjectSync: (() => ({ defaultSourceHome: "/main-install" })) as never,
}));
vi.mock(import("../lib/runtime"), async (original) => ({
  ...(await original()),
  runtime: { runPromise: async (value: unknown) => value } as never,
}));
import { useProjectSync } from "./useProjectSync";

function Status() {
  const { data, error } = useProjectSync(EnvironmentId.make("environment"));
  return <p>{data?.defaultSourceHome ?? error ?? "Connecting"}</p>;
}

it("loads sync status when the environment connects after Settings opens", async () => {
  using _connection = {
    [Symbol.dispose]: () => {
      connection.ready = false;
      connection.listeners.clear();
    },
  };
  await using screen = await render(<Status />);
  await expect.element(screen.getByText("Connecting")).toBeInTheDocument();

  await act(() => {
    connection.ready = true;
    for (const listener of connection.listeners) listener();
  });

  await expect.element(screen.getByText("/main-install")).toBeInTheDocument();
});

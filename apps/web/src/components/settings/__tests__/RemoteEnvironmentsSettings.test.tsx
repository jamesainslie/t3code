import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EnvironmentId, RemoteIdentityKey, SavedRemoteEnvironment } from "@t3tools/contracts";
import {
  RemoteEnvironmentsSectionView,
  type RemoteEnvironmentEntry,
} from "../RemoteEnvironmentsSettings";

const noop = () => {};

function makeMockRecord(overrides: Partial<SavedRemoteEnvironment> = {}): SavedRemoteEnvironment {
  const defaults: SavedRemoteEnvironment = {
    identityKey: "james@devbox:22:/home/james/app" as RemoteIdentityKey,
    host: "devbox",
    user: "james",
    port: 22,
    workspaceRoot: "/home/james/app",
    label: "My Remote",
    createdAt: "2026-01-01T00:00:00Z",
    environmentId: "env-1" as EnvironmentId,
    wsBaseUrl: "ws://devbox:3773",
    httpBaseUrl: "http://devbox:3773",
    lastConnectedAt: "2026-04-12T01:00:00Z",
    projectId: "proj-1",
  };
  return { ...defaults, ...overrides };
}

function makeEntry(
  recordOverrides: Partial<SavedRemoteEnvironment> = {},
  connectionState: RemoteEnvironmentEntry["connectionState"] = "disconnected",
): RemoteEnvironmentEntry {
  return {
    record: makeMockRecord(recordOverrides),
    connectionState,
    runtimeState: null,
  };
}

function renderSection(
  entries: RemoteEnvironmentEntry[],
  actingEnvironmentId: EnvironmentId | null = null,
) {
  return renderToStaticMarkup(
    <RemoteEnvironmentsSectionView
      entries={entries}
      actingEnvironmentId={actingEnvironmentId}
      onReconnect={noop}
      onDisconnect={noop}
      onRemove={noop}
      onRemoveAllDisconnected={noop}
    />,
  );
}

describe("RemoteEnvironmentsSectionView", () => {
  it("renders empty state message when no saved environments exist", () => {
    const html = renderSection([]);
    expect(html).toContain("No remote environments saved");
  });

  it("renders a row for each saved environment", () => {
    const entries = [
      makeEntry({
        identityKey: "james@devbox:22:/home/james/app1" as RemoteIdentityKey,
        label: "Dev Box 1",
        environmentId: "env-1" as EnvironmentId,
      }),
      makeEntry({
        identityKey: "james@devbox:22:/home/james/app2" as RemoteIdentityKey,
        label: "Dev Box 2",
        environmentId: "env-2" as EnvironmentId,
      }),
    ];

    const html = renderSection(entries);
    expect(html).toContain("Dev Box 1");
    expect(html).toContain("Dev Box 2");
  });

  it("displays host info in monospace format", () => {
    const html = renderSection([makeEntry()]);
    expect(html).toContain("james@devbox:22");
    expect(html).toContain("/home/james/app");
    expect(html).toContain("font-mono");
  });

  it("shows Connected status for connected environments", () => {
    const html = renderSection([makeEntry({}, "connected")]);
    expect(html).toContain("Connected");
  });

  it("shows Connecting status for connecting environments", () => {
    const html = renderSection([makeEntry({}, "connecting")]);
    expect(html).toContain("Connecting");
  });

  it("shows Disconnected status for disconnected environments", () => {
    const html = renderSection([makeEntry({}, "disconnected")]);
    expect(html).toContain("Disconnected");
  });

  it("shows Error status for error environments", () => {
    const html = renderSection([makeEntry({}, "error")]);
    expect(html).toContain("Error");
  });

  it("shows Never for environments that have not connected", () => {
    const html = renderSection([makeEntry({ lastConnectedAt: null })]);
    expect(html).toContain("Never");
  });

  it("renders Reconnect and Remove buttons for disconnected environments", () => {
    const html = renderSection([makeEntry({}, "disconnected")]);
    expect(html).toContain("Reconnect");
    expect(html).toContain("Remove");
  });

  it("renders Disconnect button for connected environments", () => {
    const html = renderSection([makeEntry({}, "connected")]);
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Reconnect");
  });

  it("renders Remove all disconnected button when there are disconnected environments", () => {
    const html = renderSection([makeEntry({}, "disconnected")]);
    expect(html).toContain("Remove all disconnected");
  });

  it("does not render Remove all disconnected when all environments are connected", () => {
    const html = renderSection([makeEntry({}, "connected")]);
    expect(html).not.toContain("Remove all disconnected");
  });
});

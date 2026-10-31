import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionTarget,
  RelayConnectionTarget,
  SshConnectionProfile,
  SshConnectionTarget,
} from "@lathe/client-runtime/connection";
import {
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  type ConnectionCatalogDocument,
} from "@lathe/client-runtime/platform";
import { EnvironmentId } from "@lathe/contracts";
import { describe, expect, it } from "vite-plus/test";

import { menuBarRemoteSources } from "./menuBarSources.ts";

const bearerEnv = EnvironmentId.make("env-bearer");
const sshEnv = EnvironmentId.make("env-ssh");
const relayEnv = EnvironmentId.make("env-relay");
const sshTarget = { alias: "incus-work", hostname: "incus", username: null, port: null };

function catalog(overrides: Partial<ConnectionCatalogDocument>): ConnectionCatalogDocument {
  return { ...EMPTY_CONNECTION_CATALOG_DOCUMENT, ...overrides };
}

const bearerProfile = (authorization?: "t3-connect") =>
  new BearerConnectionProfile({
    connectionId: "bearer-1",
    environmentId: bearerEnv,
    label: "Studio",
    httpBaseUrl: "https://studio.example.test",
    wsBaseUrl: "wss://studio.example.test",
    ...(authorization === undefined ? {} : { authorization }),
  });

describe("menuBarRemoteSources", () => {
  it("connects saved bearer and SSH environments with their saved tokens", () => {
    const sources = menuBarRemoteSources(
      catalog({
        targets: [
          new BearerConnectionTarget({
            environmentId: bearerEnv,
            label: "Studio",
            connectionId: "bearer-1",
          }),
          new SshConnectionTarget({
            environmentId: sshEnv,
            label: "incus-work",
            connectionId: "ssh-1",
          }),
        ],
        profiles: [
          bearerProfile(),
          new SshConnectionProfile({
            connectionId: "ssh-1",
            environmentId: sshEnv,
            label: "incus-work",
            target: sshTarget,
          }),
        ],
        credentials: [
          {
            connectionId: "bearer-1",
            credential: new BearerConnectionCredential({ token: "b-token" }),
          },
          {
            connectionId: "ssh-1",
            credential: new BearerConnectionCredential({ token: "s-token" }),
          },
        ],
      }),
    );
    expect(sources).toEqual([
      {
        _tag: "bearer",
        key: "bearer-1",
        environmentId: bearerEnv,
        label: "Studio",
        httpBaseUrl: "https://studio.example.test",
        wsBaseUrl: "wss://studio.example.test",
        token: "b-token",
      },
      {
        _tag: "ssh",
        key: "ssh-1",
        environmentId: sshEnv,
        label: "incus-work",
        target: sshTarget,
        token: "s-token",
      },
    ]);
  });

  it("skips disabled environments and reports the ones main cannot authorize", () => {
    const sources = menuBarRemoteSources(
      catalog({
        targets: [
          new RelayConnectionTarget({ environmentId: relayEnv, label: "Office" }),
          new BearerConnectionTarget({
            environmentId: bearerEnv,
            label: "Studio",
            connectionId: "bearer-1",
          }),
          new SshConnectionTarget({
            environmentId: sshEnv,
            label: "incus-work",
            connectionId: "ssh-1",
          }),
          new SshConnectionTarget({
            environmentId: EnvironmentId.make("env-off"),
            label: "Off",
            connectionId: "ssh-off",
          }),
        ],
        profiles: [
          bearerProfile("t3-connect"),
          new SshConnectionProfile({
            connectionId: "ssh-1",
            environmentId: sshEnv,
            label: "incus-work",
            target: sshTarget,
          }),
        ],
        disabledEnvironmentIds: [EnvironmentId.make("env-off")],
      }),
    );
    expect(sources.map((source) => [source._tag, source.label])).toEqual([
      ["unsupported", "Office"],
      ["unsupported", "Studio"],
      ["unsupported", "incus-work"],
    ]);
    expect(sources[2]).toMatchObject({ reason: "Open Lathe to reconnect." });
  });
});

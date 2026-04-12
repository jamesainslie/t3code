export type RemoteIdentityKey = string & { readonly _tag: "RemoteIdentityKey" };

export interface RemoteIdentityFields {
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
}

export function makeRemoteIdentityKey(fields: RemoteIdentityFields): RemoteIdentityKey {
  return `${fields.user}@${fields.host}:${fields.port}:${fields.workspaceRoot}` as RemoteIdentityKey;
}

export function parseRemoteIdentityKey(key: string): RemoteIdentityFields | null {
  const match = key.match(/^(.+)@(.+):(\d+):(.+)$/);
  if (!match) return null;
  const [, user, host, portStr, workspaceRoot] = match;
  const port = Number.parseInt(portStr!, 10);
  if (!user || !host || !Number.isFinite(port) || !workspaceRoot) return null;
  return { user, host, port, workspaceRoot };
}

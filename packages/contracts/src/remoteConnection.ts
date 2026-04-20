import { Schema } from "effect";
import { ProjectId } from "./baseSchemas.ts";

export const RemoteConnectionStatus = Schema.Literals([
  "disconnected",
  "provisioning",
  "starting",
  "connected",
  "reconnecting",
  "error",
]);
export type RemoteConnectionStatus = typeof RemoteConnectionStatus.Type;

export const RemoteConnectionState = Schema.Struct({
  projectId: ProjectId,
  status: RemoteConnectionStatus,
  wsUrl: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  remoteVersion: Schema.optional(Schema.String),
  tunnelLocalPort: Schema.optional(Schema.Number),
});
export type RemoteConnectionState = typeof RemoteConnectionState.Type;

// Broker RPC input/output — used by web app to talk to local t3 broker process
export const BrokerConnectInput = Schema.Struct({
  projectId: ProjectId,
  host: Schema.String,
  user: Schema.String,
  port: Schema.optional(Schema.Number),
  workspaceRoot: Schema.String,
});
export type BrokerConnectInput = typeof BrokerConnectInput.Type;

export const BrokerConnectResult = Schema.Struct({
  wsUrl: Schema.String,
  authToken: Schema.String,
});
export type BrokerConnectResult = typeof BrokerConnectResult.Type;

export const BrokerDisconnectInput = Schema.Struct({
  projectId: ProjectId,
});
export type BrokerDisconnectInput = typeof BrokerDisconnectInput.Type;

export const BrokerStatusResult = Schema.Struct({
  connections: Schema.Array(RemoteConnectionState),
});
export type BrokerStatusResult = typeof BrokerStatusResult.Type;

export class BrokerError extends Schema.TaggedErrorClass<BrokerError>()("BrokerError", {
  message: Schema.String,
  phase: Schema.optional(Schema.String),
}) {}

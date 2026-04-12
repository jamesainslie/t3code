/**
 * Re-exports from the canonical implementation in packages/shared.
 * Provisioner logic lives in @t3tools/shared/provision so it can be consumed
 * by both the server and the Electron desktop main process.
 */
export {
  parseServerStateFile,
  buildSshCommand,
  buildStartServerCommand,
  provision,
  teardown,
  type ServerState,
  type ProvisionOptions,
  type ProvisionResult,
} from "@t3tools/shared/provision";

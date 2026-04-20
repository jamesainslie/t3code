export function shouldRestartExitedApp({ expectedExit, shuttingDown }) {
  return !shuttingDown && !expectedExit;
}

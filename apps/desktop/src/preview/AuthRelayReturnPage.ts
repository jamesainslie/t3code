/**
 * Plain page shown in place of a sign-in's loopback response.
 *
 * Two paths serve it: an in-app tab whose return navigation the manager
 * intercepts, which loads it as a data URL because there is no response to
 * write, and the loopback host, which writes these bytes to whichever browser
 * on this machine made the request.
 */
export const AUTH_RELAY_RETURN_PAGE_HTML =
  "<!doctype html><title>Returning to your environment</title>" +
  '<body style="font:16px system-ui;margin:3rem;color:#333">' +
  '<h1 style="font-size:1.25rem">Returning to your environment</h1>' +
  "<p>T3 Code is passing this sign-in back to the command that started it. You can close this tab.</p>";

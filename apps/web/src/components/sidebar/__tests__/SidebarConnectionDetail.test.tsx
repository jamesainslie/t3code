import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarConnectionDetail } from "../SidebarConnectionDetail";

const noop = () => {};

function renderDetail(
  props?: Partial<Parameters<typeof SidebarConnectionDetail>[0]>,
) {
  return renderToStaticMarkup(
    <SidebarConnectionDetail
      connectionState="connected"
      user="deploy"
      host="devbox"
      workspaceRoot="/home/deploy/project"
      connectedAt="2026-05-07T10:00:00Z"
      errorCategory={null}
      errorGuidance={null}
      lastError={null}
      lastErrorAt={null}
      onReconnect={noop}
      onDisconnect={noop}
      {...props}
    />,
  );
}

describe("SidebarConnectionDetail", () => {
  it("shows user@host and workspace root when connected", () => {
    const html = renderDetail({ connectionState: "connected" });
    expect(html).toContain("deploy@devbox");
    expect(html).toContain("/home/deploy/project");
  });

  it("shows disconnect button when connected", () => {
    const html = renderDetail({ connectionState: "connected" });
    expect(html).toContain('data-testid="disconnect-button"');
    expect(html).toContain("Disconnect");
  });

  it("shows error headline and guidance text for tunnel-closed error", () => {
    const html = renderDetail({
      connectionState: "error",
      errorCategory: "tunnel-closed",
      errorGuidance: "Reconnect will re-establish the SSH tunnel.",
      lastError: "WebSocket connection closed unexpectedly",
      lastErrorAt: "2026-05-07T10:05:00Z",
    });
    expect(html).toContain("Connection lost");
    expect(html).toContain("Reconnect will re-establish the SSH tunnel.");
  });

  it("shows reconnect button when in error state", () => {
    const html = renderDetail({
      connectionState: "error",
      errorCategory: "tunnel-closed",
      errorGuidance: "Reconnect will re-establish the SSH tunnel.",
      lastError: "WebSocket connection closed unexpectedly",
      lastErrorAt: "2026-05-07T10:05:00Z",
    });
    expect(html).toContain('data-testid="action-button"');
    expect(html).toContain("Reconnect");
  });

  it("shows Re-pair button text for auth-expired errors", () => {
    const html = renderDetail({
      connectionState: "error",
      errorCategory: "auth-expired",
      errorGuidance: "Re-pair this environment from the remote host.",
      lastError: "401 Unauthorized",
      lastErrorAt: "2026-05-07T10:05:00Z",
    });
    expect(html).toContain("Re-pair");
    expect(html).not.toContain(">Reconnect<");
  });

  it("shows Connect button when disconnected with no error", () => {
    const html = renderDetail({
      connectionState: "disconnected",
      connectedAt: null,
    });
    expect(html).toContain("Connect");
    expect(html).toContain('data-testid="action-button"');
  });
});

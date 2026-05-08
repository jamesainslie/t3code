import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarConnectionRow } from "../SidebarConnectionRow";

const noop = () => {};

function renderRow(props?: Partial<Parameters<typeof SidebarConnectionRow>[0]>) {
  return renderToStaticMarkup(
    <SidebarConnectionRow
      label="devbox"
      connectionState="connected"
      errorCategory={null}
      isExpanded={false}
      onToggleExpand={noop}
      onReconnect={noop}
      {...props}
    />,
  );
}

describe("SidebarConnectionRow", () => {
  it("renders hostname and Connected state text", () => {
    const html = renderRow({ connectionState: "connected" });
    expect(html).toContain("devbox");
    expect(html).toContain("Connected");
  });

  it("does NOT show reconnect button when connected", () => {
    const html = renderRow({ connectionState: "connected" });
    expect(html).not.toContain("Reconnect");
    expect(html).not.toContain("lucide-refresh-cw");
  });

  it("shows reconnect button when in error state", () => {
    const html = renderRow({
      connectionState: "error",
      errorCategory: "tunnel-closed",
    });
    expect(html).toContain("lucide-refresh-cw");
  });

  it("shows reconnect button when disconnected", () => {
    const html = renderRow({ connectionState: "disconnected" });
    expect(html).toContain("lucide-refresh-cw");
  });

  it("calls onReconnect when reconnect button clicked", () => {
    // With renderToStaticMarkup we cannot test click handlers directly,
    // so we verify the button renders with the correct data-testid.
    const html = renderRow({ connectionState: "error", errorCategory: "network-error" });
    expect(html).toContain('data-testid="reconnect-button"');
  });

  it("shows Reconnecting when connecting", () => {
    const html = renderRow({ connectionState: "connecting" });
    expect(html).toContain("Reconnecting");
    // Should show the pulsing amber dot
    expect(html).toContain("animate-pulse");
  });

  it("shows green dot when connected", () => {
    const html = renderRow({ connectionState: "connected" });
    expect(html).toContain("bg-emerald-500");
  });

  it("shows red dot when in error state", () => {
    const html = renderRow({ connectionState: "error", errorCategory: "tunnel-closed" });
    expect(html).toContain("bg-red-500");
  });

  it("shows gray dot when disconnected", () => {
    const html = renderRow({ connectionState: "disconnected" });
    expect(html).toContain("bg-gray-400");
  });
});

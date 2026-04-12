import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteConnectionIcon } from "../RemoteConnectionIcon";

describe("RemoteConnectionIcon", () => {
  it("returns null when state is null", () => {
    const html = renderToStaticMarkup(<RemoteConnectionIcon state={null} />);
    expect(html).toBe("");
  });

  it("renders emerald Cloud icon when connected", () => {
    const html = renderToStaticMarkup(<RemoteConnectionIcon state="connected" />);
    expect(html).toContain("text-emerald-500");
    expect(html).not.toContain("animate-pulse");
  });

  it("renders pulsing Cloud icon when connecting", () => {
    const html = renderToStaticMarkup(<RemoteConnectionIcon state="connecting" />);
    expect(html).toContain("animate-pulse");
    expect(html).toContain("text-muted-foreground");
  });

  it("renders muted CloudOff icon when disconnected", () => {
    const html = renderToStaticMarkup(<RemoteConnectionIcon state="disconnected" />);
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain('aria-label="Remote: disconnected"');
  });

  it("renders red CloudOff icon when error", () => {
    const html = renderToStaticMarkup(<RemoteConnectionIcon state="error" />);
    expect(html).toContain("text-red-500");
    expect(html).toContain('aria-label="Remote: error"');
  });

  it("is clickable only for disconnected and error states", () => {
    const connectedHtml = renderToStaticMarkup(
      <RemoteConnectionIcon state="connected" onClick={() => {}} />,
    );
    expect(connectedHtml).toContain("cursor-default");

    const disconnectedHtml = renderToStaticMarkup(
      <RemoteConnectionIcon state="disconnected" onClick={() => {}} />,
    );
    expect(disconnectedHtml).toContain("cursor-pointer");

    const errorHtml = renderToStaticMarkup(
      <RemoteConnectionIcon state="error" onClick={() => {}} />,
    );
    expect(errorHtml).toContain("cursor-pointer");
  });
});

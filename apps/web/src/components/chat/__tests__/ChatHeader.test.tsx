import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "../../ui/sidebar";
import { ChatHeader } from "../ChatHeader";

function renderHeader(props?: Partial<Parameters<typeof ChatHeader>[0]>) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <ChatHeader
        activeThreadEnvironmentId={"env-1" as any}
        activeThreadId={"thread-1" as any}
        activeThreadTitle="Thread"
        activeProjectName={undefined}
        isGitRepo={false}
        openInCwd={null}
        activeProjectScripts={undefined}
        preferredScriptId={null}
        keybindings={{ commands: [] } as any}
        availableEditors={[]}
        terminalAvailable={false}
        terminalOpen={false}
        terminalToggleShortcutLabel={null}
        diffToggleShortcutLabel={null}
        gitCwd={null}
        diffOpen={false}
        markdownPreviewOpen={false}
        markdownPreviewAvailable={true}
        hostResourceSnapshot={null}
        onRunProjectScript={vi.fn()}
        onAddProjectScript={vi.fn()}
        onUpdateProjectScript={vi.fn()}
        onDeleteProjectScript={vi.fn()}
        onToggleTerminal={vi.fn()}
        onToggleDiff={vi.fn()}
        onToggleMarkdownPreview={vi.fn()}
        {...props}
      />
    </SidebarProvider>,
  );
}

describe("ChatHeader", () => {
  it("renders an explicit markdown preview toggle", () => {
    const html = renderHeader();

    expect(html).toContain("Open markdown preview");
    expect(html).toContain("lucide-file-text");
  });

  it("changes the markdown preview toggle label when open", () => {
    const html = renderHeader({ markdownPreviewOpen: true });

    expect(html).toContain("Close markdown preview");
  });
});

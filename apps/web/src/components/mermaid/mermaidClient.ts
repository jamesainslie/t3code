import mermaid from "mermaid";

export type MermaidAppTheme = "light" | "dark";

let initializedTheme: MermaidAppTheme | null = null;

function ensureInitialized(theme: MermaidAppTheme): void {
  if (initializedTheme === theme) {
    return;
  }
  mermaid.initialize({
    startOnLoad: false,
    // Agent-generated diagrams are untrusted input: strict mode disables HTML
    // labels and click/script directives and sanitizes the produced SVG.
    securityLevel: "strict",
    // Mermaid's own error rendering injects into the document; errors are
    // surfaced by the caller instead.
    suppressErrorRendering: true,
    theme: theme === "dark" ? "dark" : "default",
  });
  initializedTheme = theme;
}

export async function renderMermaidDiagram(
  id: string,
  source: string,
  theme: MermaidAppTheme,
): Promise<string> {
  ensureInitialized(theme);
  const { svg } = await mermaid.render(id, source);
  return svg;
}

export function resetMermaidInitializationForTests(): void {
  initializedTheme = null;
}

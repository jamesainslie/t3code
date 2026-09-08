import type { MermaidConfig } from "mermaid";

const cache = new Map<string, Promise<string>>();
let queue = Promise.resolve();
let nextId = 0;

function config(theme: "dark" | "light"): MermaidConfig {
  const dark = theme === "dark";
  const text = dark ? "#e4e4e7" : "#27272a";
  const border = dark ? "#71717a" : "#a1a1aa";
  const surface = dark ? "#27272a" : "#f4f4f5";
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    maxTextSize: 50000,
    maxEdges: 500,
    theme: "base",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    htmlLabels: false,
    // Diagram frontmatter must not change the viewer's trust or theme settings.
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "maxEdges",
      "suppressErrorRendering",
      "theme",
      "themeVariables",
      "themeCSS",
      "fontFamily",
      "htmlLabels",
    ],
    flowchart: { htmlLabels: false, curve: "basis", padding: 16 },
    themeVariables: {
      darkMode: dark,
      background: dark ? "#18181b" : "#ffffff",
      primaryColor: dark ? "#253451" : "#eaf1ff",
      primaryTextColor: text,
      primaryBorderColor: dark ? "#6b8bc2" : "#6489c6",
      secondaryColor: surface,
      secondaryTextColor: text,
      secondaryBorderColor: border,
      tertiaryColor: dark ? "#213c36" : "#ecf8f1",
      tertiaryTextColor: text,
      tertiaryBorderColor: border,
      lineColor: border,
      textColor: text,
      mainBkg: surface,
      nodeBorder: border,
      clusterBkg: dark ? "#202023" : "#fafafa",
      clusterBorder: border,
      edgeLabelBackground: dark ? "#18181b" : "#ffffff",
      actorBkg: surface,
      actorBorder: border,
      actorTextColor: text,
      actorLineColor: border,
      signalColor: text,
      signalTextColor: text,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: border,
      labelTextColor: text,
      loopTextColor: text,
      noteBkgColor: dark ? "#403921" : "#fff8df",
      noteBorderColor: dark ? "#a68c49" : "#c5ab69",
      noteTextColor: text,
      activationBkgColor: surface,
      activationBorderColor: border,
      fontSize: "14px",
    },
  };
}

/** Serialized because Mermaid's configuration and render queue are global. */
export function renderMermaid(source: string, theme: "dark" | "light"): Promise<string> {
  if (source.length > 50000)
    return Promise.reject(
      new Error(
        "This diagram exceeds the 50,000 character rendering limit. View or copy its source instead.",
      ),
    );
  const key = `${theme}:${source}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const result = queue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize(config(theme));
    const id = `t3-mermaid-${++nextId}`;
    try {
      return (await mermaid.render(id, source)).svg;
    } finally {
      // Mermaid can leave its temporary render node behind on a parser failure.
      if (typeof document !== "undefined") document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  cache.set(key, result);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  // A transient chunk-load error should be recoverable on retry.
  void result.catch(() => {
    if (cache.get(key) === result) cache.delete(key);
  });
  return result;
}

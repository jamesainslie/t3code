/**
 * Fork-only. Lathe's own MCP tools are named `lathe_*`; before the rename they
 * were `t3_*`. Stored tool calls and provider transcripts keep the old names,
 * so the tool resolver reads them as the Lathe tool. The server spellings
 * (t3-code, t3_code, t3code) are matched where the resolver matches `lathe`.
 */
export function latheMcpToolLabel(label: string): string {
  return label.replace(/(^|[^A-Za-z0-9])t3_(?!code(?:__|[^A-Za-z0-9_]|$))(?=[a-z])/g, "$1lathe_");
}

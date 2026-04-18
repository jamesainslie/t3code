import { describe, it, expect } from "vitest";

import { FileDocsService } from "../Services/FileDocsService.ts";
import { FileDocsServiceLive } from "../Layers/FileDocsServiceLive.ts";

describe("FileDocsService", () => {
  it("module exports Service tag", () => {
    expect(FileDocsService).toBeDefined();
    expect(FileDocsServiceLive).toBeDefined();
  });
});

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  MetricState,
  ResourceMetricKind,
  HostResourceSnapshot,
  HostResourceStreamEvent,
  HostResourceSubscribeInput,
  ResourceThresholds,
  KubeDangerPatterns,
  HostResourceMonitorError,
  RamMetric,
  CpuMetric,
  DiskMetric,
  ContainersMetric,
  KubecontextMetric,
  RemoteMetric,
} from "./hostResource";

const decodeMetricState = Schema.decodeUnknownSync(MetricState);
const decodeResourceMetricKind = Schema.decodeUnknownSync(ResourceMetricKind);
const decodeSnapshot = Schema.decodeUnknownSync(HostResourceSnapshot);
const encodeSnapshot = Schema.encodeUnknownSync(HostResourceSnapshot);
const decodeStreamEvent = Schema.decodeUnknownSync(HostResourceStreamEvent);

const validRam = {
  state: "normal",
  usagePercent: 45.2,
  totalBytes: 17179869184,
  usedBytes: 7784628224,
  availableBytes: 9395240960,
  swapUsedBytes: 0,
  swapTotalBytes: 0,
};

const validCpu = {
  state: "warn",
  usagePercent: 87.3,
  coreCount: 10,
  sustainedPercent: 60.0,
};

const validDisk = {
  state: "normal",
  usagePercent: 52.1,
  totalBytes: 1000000000000,
  usedBytes: 521000000000,
  availableBytes: 479000000000,
  mountPath: "/",
};

const validContainers = {
  state: "normal",
  running: 5,
  stopped: 2,
  total: 7,
};

const validKubecontext = {
  state: "critical",
  context: "pd-us-east-1",
  cluster: "pd-us-east-1",
  namespace: "default",
  isDanger: true,
  dangerReason: "Context matches danger pattern: pd-",
};

const validRemote = {
  isRemote: false,
  hostname: "macbook-pro",
  fqdn: "macbook-pro.local",
  isRoot: false,
};

const fullSnapshot = {
  ram: validRam,
  cpu: validCpu,
  disk: validDisk,
  containers: validContainers,
  kubecontext: validKubecontext,
  remote: validRemote,
};

describe("MetricState", () => {
  it("accepts valid states", () => {
    expect(decodeMetricState("normal")).toBe("normal");
    expect(decodeMetricState("warn")).toBe("warn");
    expect(decodeMetricState("critical")).toBe("critical");
  });

  it("rejects invalid states", () => {
    expect(() => decodeMetricState("unknown")).toThrow();
    expect(() => decodeMetricState("")).toThrow();
    expect(() => decodeMetricState(42)).toThrow();
  });
});

describe("ResourceMetricKind", () => {
  it("accepts all valid kinds", () => {
    for (const kind of ["ram", "cpu", "disk", "containers", "kubecontext", "remote"]) {
      expect(decodeResourceMetricKind(kind)).toBe(kind);
    }
  });

  it("rejects invalid kinds", () => {
    expect(() => decodeResourceMetricKind("memory")).toThrow();
    expect(() => decodeResourceMetricKind("gpu")).toThrow();
  });
});

describe("HostResourceSnapshot", () => {
  it("round-trips a full snapshot", () => {
    const decoded = decodeSnapshot(fullSnapshot);
    const encoded = encodeSnapshot(decoded);
    const reDecoded = decodeSnapshot(encoded);

    expect(reDecoded.ram.usagePercent).toBe(45.2);
    expect(reDecoded.cpu.state).toBe("warn");
    expect(reDecoded.disk.mountPath).toBe("/");
    expect(reDecoded.containers?.running).toBe(5);
    expect(reDecoded.kubecontext?.isDanger).toBe(true);
    expect(reDecoded.remote.isRemote).toBe(false);
  });

  it("accepts snapshot with null optional fields", () => {
    const snapshot = {
      ram: validRam,
      cpu: validCpu,
      disk: validDisk,
      containers: null,
      kubecontext: null,
      remote: validRemote,
    };
    const decoded = decodeSnapshot(snapshot);
    expect(decoded.containers).toBeNull();
    expect(decoded.kubecontext).toBeNull();
  });

  it("accepts kubecontext with null dangerReason", () => {
    const kubecontext = {
      ...validKubecontext,
      isDanger: false,
      dangerReason: null,
    };
    const snapshot = {
      ...fullSnapshot,
      kubecontext,
    };
    const decoded = decodeSnapshot(snapshot);
    expect(decoded.kubecontext?.dangerReason).toBeNull();
  });
});

describe("HostResourceStreamEvent", () => {
  it("decodes a snapshot event", () => {
    const event = {
      version: 1,
      type: "snapshot",
      data: fullSnapshot,
    };
    const decoded = decodeStreamEvent(event);
    expect(decoded.type).toBe("snapshot");
    expect(decoded.version).toBe(1);
  });

  it("decodes a transition event", () => {
    const event = {
      version: 1,
      type: "transition",
      metric: "ram",
      previousState: "normal",
      currentState: "warn",
      data: fullSnapshot,
    };
    const decoded = decodeStreamEvent(event);
    expect(decoded.type).toBe("transition");
    if (decoded.type === "transition") {
      expect(decoded.metric).toBe("ram");
      expect(decoded.previousState).toBe("normal");
      expect(decoded.currentState).toBe("warn");
    }
  });

  it("rejects events with invalid type discriminator", () => {
    expect(() =>
      decodeStreamEvent({
        version: 1,
        type: "invalid",
        data: fullSnapshot,
      }),
    ).toThrow();
  });

  it("rejects events with wrong version", () => {
    expect(() =>
      decodeStreamEvent({
        version: 2,
        type: "snapshot",
        data: fullSnapshot,
      }),
    ).toThrow();
  });
});

describe("HostResourceSubscribeInput", () => {
  const decodeInput = Schema.decodeUnknownSync(HostResourceSubscribeInput);

  it("accepts valid input with projectId", () => {
    const decoded = decodeInput({ projectId: "proj-123" });
    expect(decoded.projectId).toBe("proj-123");
  });

  it("rejects empty projectId", () => {
    expect(() => decodeInput({ projectId: "" })).toThrow();
  });
});

describe("ResourceThresholds", () => {
  it("has correct default values", () => {
    expect(ResourceThresholds.ram.warn).toBe(80);
    expect(ResourceThresholds.ram.critical).toBe(92);
    expect(ResourceThresholds.cpu.warn).toBe(85);
    expect(ResourceThresholds.cpu.critical).toBe(95);
    expect(ResourceThresholds.cpu.sustainedSeconds).toBe(5);
    expect(ResourceThresholds.disk.warn).toBe(85);
    expect(ResourceThresholds.disk.critical).toBe(95);
  });
});

describe("KubeDangerPatterns", () => {
  it("contains expected default patterns", () => {
    expect(KubeDangerPatterns).toContain("pd-");
    expect(KubeDangerPatterns).toContain("prod-");
    expect(KubeDangerPatterns).toContain("production");
    expect(KubeDangerPatterns).toHaveLength(3);
  });
});

describe("HostResourceMonitorError", () => {
  it("creates a tagged error", () => {
    const err = new HostResourceMonitorError({
      operation: "collect",
      detail: "failed to read /proc/meminfo",
    });
    expect(err._tag).toBe("HostResourceMonitorError");
    expect(err.message).toContain("collect");
    expect(err.message).toContain("failed to read /proc/meminfo");
  });
});

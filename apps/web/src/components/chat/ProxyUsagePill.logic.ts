/**
 * What the header pill and its ledger show for a `modelproxy` usage-limit
 * source. Pure over the published snapshot so the rules (which account,
 * which colour, which figure decides the account's fate soonest) are
 * testable without React.
 *
 * The runway rule mirrors modelproxy's own mini window: a spent shared
 * window's reset governs, else the fleet forecast, else the horizon.
 */
import type {
  ServerProviderUsageWindow,
  UsageLimitSourceAccount,
  UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/usageLimits";

export type ProxyTone = "ok" | "warn" | "crit" | "muted";

export interface ProxyWindowView {
  readonly key: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly tone: ProxyTone;
  /** `"↻ 2h 08m"`; empty when the source never observed a reset. */
  readonly resetText: string;
}

export interface ProxyAccountView {
  readonly id: string;
  readonly driver: string;
  readonly stateLabel: string;
  readonly stateTone: ProxyTone | "live";
  readonly windows: readonly ProxyWindowView[];
  /** The session window's percent, or the first window's when there is none. */
  readonly headline: string;
  /** The countdown or verdict that decides this account's fate soonest. */
  readonly runwayText: string;
  readonly runwayTone: ProxyTone;
}

export interface ProxyPillView {
  readonly sourceId: string;
  readonly label: string;
  readonly status: "signedOut" | "pending" | "offline" | "live";
  /** The account the gateway is serving, when it is signed in and serving one. */
  readonly current: ProxyAccountView | null;
  readonly tone: ProxyTone;
  readonly runwayText: string;
  readonly fallbackText: string | null;
  readonly accounts: readonly ProxyAccountView[];
  readonly fallbacks: readonly string[];
  readonly footer: string;
  readonly pending: { userCode: string; verificationUrl: string; expiresAt: string } | null;
  readonly error: string | null;
}

const DEFAULT_THRESHOLD = 90;
const WARN_AT = 60;

function windowTone(usedPercent: number, threshold: number): ProxyTone {
  if (usedPercent >= threshold) return "crit";
  if (usedPercent >= WARN_AT) return "warn";
  return "ok";
}

function shortLabel(window: ServerProviderUsageWindow): string {
  if (window.id === "five_hour") return "5h";
  if (window.id === "seven_day") return "7d";
  if (window.id.startsWith("seven_day_")) return window.id.slice("seven_day_".length);
  return window.label;
}

function countdown(at: string | undefined, now: number): string {
  if (!at) return "";
  const ms = Date.parse(at) - now;
  if (!Number.isFinite(ms)) return "";
  return ms <= 0 ? "now" : formatDuration(ms);
}

function spent(window: ServerProviderUsageWindow, threshold: number, now: number): boolean {
  if (window.usedPercent < threshold) return false;
  return !window.resetsAt || Date.parse(window.resetsAt) > now;
}

function accountView(
  account: UsageLimitSourceAccount,
  input: { threshold: number; modelThreshold: number; now: number },
): ProxyAccountView {
  const windows = account.usageLimits.windows.map((window): ProxyWindowView => {
    const threshold =
      window.id === "five_hour" || window.id === "seven_day"
        ? input.threshold
        : input.modelThreshold;
    return {
      key: window.id,
      label: shortLabel(window),
      usedPercent: window.usedPercent,
      tone: windowTone(window.usedPercent, threshold),
      resetText: window.resetsAt ? `↻ ${countdown(window.resetsAt, input.now)}` : "",
    };
  });
  const session = account.usageLimits.windows.find((window) => window.id === "five_hour");
  const first = account.usageLimits.windows[0];
  const headline = session ?? first;

  const proxy = account.proxy;
  let stateLabel = "ready";
  let stateTone: ProxyAccountView["stateTone"] = "muted";
  let runwayText = "";
  let runwayTone: ProxyTone = "muted";
  switch (proxy?.state) {
    case "live":
      stateLabel = proxy.inflight > 0 ? `live now · ${proxy.inflight} in flight` : "live now";
      stateTone = "live";
      break;
    case "cooling":
      stateLabel = proxy.coolingUntil
        ? `cooling · back in ${countdown(proxy.coolingUntil, input.now)}`
        : "circuit open";
      stateTone = "crit";
      runwayText = proxy.coolingUntil ? countdown(proxy.coolingUntil, input.now) : "circuit";
      runwayTone = "crit";
      break;
    case "paused":
      stateLabel = "paused by operator";
      runwayText = "off";
      break;
    case "reauthentication":
      stateLabel = "login required";
      stateTone = "crit";
      runwayText = "login";
      runwayTone = "crit";
      break;
    case "suspended":
      stateLabel = "subscription suspended";
      stateTone = "crit";
      runwayText = "off";
      runwayTone = "crit";
      break;
    default:
      break;
  }
  if (runwayText === "") {
    // The shared windows take the account out of selection; a per-model
    // bucket only blocks that model, so it warns rather than governs.
    const shared = account.usageLimits.windows.filter(
      (window) => window.id === "five_hour" || window.id === "seven_day",
    );
    const spentShared = shared
      .filter((window) => spent(window, input.threshold, input.now))
      .toSorted(
        (left, right) => Date.parse(left.resetsAt ?? "") - Date.parse(right.resetsAt ?? ""),
      );
    const governing = spentShared[0];
    if (governing) {
      if (proxy?.credits) {
        stateLabel = "on credits";
        stateTone = "warn";
        runwayText = "credits";
        runwayTone = "warn";
      } else {
        stateLabel = `${shortLabel(governing)} spent`;
        stateTone = "crit";
        runwayText = governing.resetsAt ? countdown(governing.resetsAt, input.now) : "spent";
        runwayTone = "crit";
      }
    } else {
      const soonest = [...account.usageLimits.windows]
        .filter((window) => window.resetsAt)
        .toSorted((left, right) => Date.parse(left.resetsAt!) - Date.parse(right.resetsAt!))[0];
      runwayText = soonest ? countdown(soonest.resetsAt, input.now) : "";
      runwayTone = "muted";
    }
  }

  return {
    id: account.id,
    driver: String(account.driver),
    stateLabel,
    stateTone,
    windows,
    headline: headline ? `${Math.round(headline.usedPercent)}%` : "no data",
    runwayText,
    runwayTone,
  };
}

function fleetRunway(snapshot: UsageLimitSourceSnapshot, now: number): string {
  const runway = snapshot.proxy?.runway;
  if (!runway) return "";
  switch (runway.kind) {
    case "at":
      return countdown(runway.at, now) || "now";
    case "resetsFirst":
      return runway.at ? `resets ${countdown(runway.at, now)}` : "resets first";
    case "idle":
      return "idle";
    case "beyondHorizon":
      return ">7d";
    default:
      return "";
  }
}

function fallbackText(snapshot: UsageLimitSourceSnapshot): string | null {
  const fallbacks = snapshot.proxy?.fallback ?? [];
  const spend = fallbacks.reduce((total, fallback) => total + fallback.spendUsd, 0);
  if (fallbacks.length === 0) return null;
  const window = fallbacks[0]?.window;
  return `$${spend.toFixed(2)}${window === "day" ? " today" : window === "month" ? " this month" : ""}`;
}

/** `null` for a source the pill does not represent. */
export function deriveProxyPill(
  snapshot: UsageLimitSourceSnapshot,
  now: number,
): ProxyPillView | null {
  if (snapshot.kind !== "modelproxy") return null;
  const proxy = snapshot.proxy;
  const auth = proxy?.auth ?? { state: "signedOut" as const };
  const threshold = proxy?.rotationThresholdPercent ?? DEFAULT_THRESHOLD;
  const modelThreshold = proxy?.modelThresholdPercent ?? threshold;
  const accounts = snapshot.accounts.map((account) =>
    accountView(account, { threshold, modelThreshold, now }),
  );
  const current = accounts.find((account) => account.id === proxy?.current) ?? null;
  const fallbacks = (proxy?.fallback ?? []).map(
    (fallback) =>
      `${fallback.name} · $${fallback.spendUsd.toFixed(2)}${fallback.capUsd ? ` of $${fallback.capUsd.toFixed(0)}` : ""}${fallback.window ? ` per ${fallback.window}` : ""}`,
  );
  const footer = [
    `threshold ${threshold}%`,
    ...(proxy?.modelThresholdPercent !== undefined
      ? [`model ${proxy.modelThresholdPercent}%`]
      : []),
    ...(proxy?.queueDepth ? [`queue ${proxy.queueDepth}`] : []),
    ...(proxy?.inflightTotal ? [`${proxy.inflightTotal} in flight`] : []),
  ].join(" · ");

  const base = {
    sourceId: snapshot.id,
    label: snapshot.label,
    accounts,
    fallbacks,
    footer,
    pending:
      auth.state === "pending"
        ? {
            userCode: auth.userCode,
            verificationUrl: auth.verificationUrlComplete ?? auth.verificationUrl,
            expiresAt: auth.expiresAt,
          }
        : null,
    error: snapshot.error ?? null,
  };
  if (auth.state !== "signedIn") {
    return {
      ...base,
      status: auth.state,
      current: null,
      tone: "muted",
      runwayText: "",
      fallbackText: null,
    };
  }
  if (snapshot.error) {
    return {
      ...base,
      status: "offline",
      current: null,
      tone: "muted",
      runwayText: "",
      fallbackText: null,
    };
  }
  const poolSpent =
    current === null &&
    accounts.length > 0 &&
    accounts.every((account) => account.stateTone === "crit" || account.runwayText === "off");
  const tone: ProxyTone = poolSpent
    ? "crit"
    : current
      ? (current.windows.find((window) => window.key === "five_hour")?.tone ?? "ok")
      : "muted";
  return {
    ...base,
    status: "live",
    current,
    tone,
    runwayText: fleetRunway(snapshot, now),
    fallbackText: poolSpent ? fallbackText(snapshot) : null,
  };
}

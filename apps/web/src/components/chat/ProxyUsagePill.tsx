import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, UsageLimitSourceSnapshot } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  deriveProxyPill,
  selectProxySource,
  type ProxyAccountView,
  type ProxyPillView,
  type ProxyTone,
} from "./ProxyUsagePill.logic";

const TONE_TEXT: Record<ProxyTone | "live", string> = {
  ok: "text-success-foreground",
  warn: "text-warning-foreground",
  crit: "text-error-foreground",
  muted: "text-muted-foreground",
  live: "text-info-foreground",
};

const TONE_FILL: Record<ProxyTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  crit: "bg-error",
  muted: "bg-muted-foreground/60",
};

const TONE_STROKE: Record<ProxyTone, string> = {
  ok: "var(--color-success)",
  warn: "var(--color-warning)",
  crit: "var(--color-error)",
  muted: "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)",
};
const TRACK_STROKE = "color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)";

function ring(cx: number, r: number, usedPercent: number | null, tone: ProxyTone, width: number) {
  const circumference = 2 * Math.PI * r;
  const fill = usedPercent === null ? 0 : Math.max(0, Math.min(100, usedPercent)) / 100;
  return (
    <>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={TRACK_STROKE} strokeWidth={width} />
      {fill > 0 ? (
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={TONE_STROKE[tone]}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fill)}
        />
      ) : null}
    </>
  );
}

/**
 * The iris of an eye, the gateway's namesake, drawn as two gauges: the outer
 * ring is the serving account's session window and the inner its weekly
 * window. A window the gateway has not observed leaves its track empty.
 */
function IrisGauge({
  session,
  weekly,
  className,
}: {
  readonly session: { usedPercent: number; tone: ProxyTone } | null;
  readonly weekly: { usedPercent: number; tone: ProxyTone } | null;
  readonly className?: string;
}) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-3.5 shrink-0 -rotate-90", className)} aria-hidden>
      {ring(8, 6.4, session?.usedPercent ?? null, session?.tone ?? "muted", 1.8)}
      {ring(8, 3.4, weekly?.usedPercent ?? null, weekly?.tone ?? "muted", 1.8)}
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** The wall clock to the second, for a ledger that only exists while it is open. */
function useNowSecond(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** A 3px bar with a hairline at the rotation threshold. */
function Meter({
  usedPercent,
  tone,
  threshold,
  className,
}: {
  readonly usedPercent: number;
  readonly tone: ProxyTone;
  readonly threshold: number;
  readonly className?: string;
}) {
  return (
    <span className={cn("relative block h-[3px] w-full rounded-full bg-muted", className)}>
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full", TONE_FILL[tone])}
        style={{ width: `${Math.max(0, Math.min(100, usedPercent))}%` }}
      />
      <span
        aria-hidden
        className="absolute -inset-y-0.5 w-px bg-foreground/40"
        style={{ left: `${threshold}%` }}
      />
    </span>
  );
}

function windowsOf(account: ProxyAccountView | null) {
  const session = account?.windows.find((window) => window.key === "five_hour") ?? null;
  const weekly = account?.windows.find((window) => window.key === "seven_day") ?? null;
  return { session, weekly };
}

function LedgerRow({
  account,
  threshold,
}: {
  readonly account: ProxyAccountView;
  readonly threshold: number;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_2.25rem_4.5rem] items-center gap-x-2.5 border-t border-border/60 py-1.5 first:border-t-0">
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{account.id}</div>
        <div className={cn("truncate text-[10.5px]", TONE_TEXT[account.stateTone])}>
          {account.stateLabel}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {account.windows.length === 0 ? (
          <span className="text-[10px] text-muted-foreground">no data</span>
        ) : (
          account.windows.map((window) => (
            <div
              key={window.key}
              className="grid grid-cols-[1.25rem_1fr] items-center gap-1.5 font-mono text-[10px] text-muted-foreground"
            >
              <span className="truncate">{window.label}</span>
              <Meter usedPercent={window.usedPercent} tone={window.tone} threshold={threshold} />
            </div>
          ))
        )}
      </div>
      <div className="text-right font-mono text-[11px] text-foreground tabular-nums">
        {account.headline}
      </div>
      <div
        className={cn(
          "text-right font-mono text-[11px] tabular-nums",
          TONE_TEXT[account.runwayTone],
        )}
      >
        {account.runwayText}
      </div>
    </div>
  );
}

function SignIn({
  environmentId,
  pill,
}: {
  readonly environmentId: EnvironmentId;
  readonly pill: ProxyPillView;
}) {
  const auth = useAtomCommand(serverEnvironment.usageLimitSourceAuth, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const run = async (action: "start" | "cancel" | "signOut") => {
    setBusy(true);
    setFailure(null);
    const result = await auth({
      environmentId,
      input: { sourceId: pill.sourceId as never, action },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      setFailure(
        "error" in result.cause && result.cause.error instanceof Error
          ? result.cause.error.message
          : "The gateway sign-in could not be started.",
      );
    }
  };
  if (pill.status === "pending" && pill.pending) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground">
          Open the sign-in page and confirm this device code. Then sign in with your password and
          your second factor: a passkey, or the code from your authenticator app. Any browser on any
          device will do.
        </div>
        <div className="flex items-center justify-between gap-3">
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm tracking-widest text-foreground">
            {pill.pending.userCode}
          </code>
          <Button
            size="xs"
            variant="outline"
            render={<a href={pill.pending.verificationUrl} target="_blank" rel="noreferrer" />}
          >
            Open sign-in
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            This panel updates on its own once you finish.
          </span>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run("cancel")}>
            Cancel
          </Button>
        </div>
        {failure ? <div className="text-error-foreground">{failure}</div> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground">
        {pill.status === "signedOut"
          ? "Sign in as yourself to see which account the gateway is serving and how much headroom is left."
          : (pill.error ?? "The gateway could not be read.")}
      </div>
      <div className="flex items-center justify-end gap-2">
        {pill.status !== "signedOut" ? (
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run("signOut")}>
            Sign out
          </Button>
        ) : null}
        {pill.status === "signedOut" ? (
          <Button size="xs" disabled={busy} onClick={() => void run("start")}>
            Sign in
          </Button>
        ) : null}
      </div>
      {failure ? <div className="text-error-foreground">{failure}</div> : null}
    </div>
  );
}

function Ledger({
  environmentId,
  snapshot,
  threshold,
}: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: UsageLimitSourceSnapshot;
  readonly threshold: number;
}) {
  // The popover unmounts when it closes, so this second-by-second clock and
  // the re-derivation it drives only run while someone is looking.
  const now = useNowSecond();
  const pill = useMemo(() => deriveProxyPill(snapshot, now, { seconds: true }), [snapshot, now]);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const auth = useAtomCommand(serverEnvironment.usageLimitSourceAuth, { reportFailure: false });
  if (!pill) return null;
  return (
    <div className="flex flex-col gap-2 p-[var(--floating-content-inset)] text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-muted-foreground">
          {pill.label} · {pill.accounts.length}{" "}
          {pill.accounts.length === 1 ? "account" : "accounts"}
        </span>
        <span className="font-mono text-[10.5px] text-secondary-label">
          {pill.runwayText ? `fleet runway ${pill.runwayText}` : ""}
        </span>
      </div>
      {pill.status === "live" ? (
        <>
          <div className="flex flex-col">
            {pill.accounts.map((account) => (
              <LedgerRow key={account.id} account={account} threshold={threshold} />
            ))}
          </div>
          {pill.fallbacks.length > 0 ? (
            <div className="border-t border-border/60 pt-1.5 font-mono text-[10.5px] text-muted-foreground">
              {pill.fallbacks.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-1.5 font-mono text-[10.5px] text-secondary-label">
            <span>{pill.footer}</span>
            {confirmSignOut ? (
              <span className="flex items-center gap-1">
                <Button size="micro" variant="ghost" onClick={() => setConfirmSignOut(false)}>
                  Keep
                </Button>
                <Button
                  size="micro"
                  variant="destructive-outline"
                  onClick={() => {
                    setConfirmSignOut(false);
                    void auth({
                      environmentId,
                      input: { sourceId: pill.sourceId as never, action: "signOut" },
                    });
                  }}
                >
                  Sign out
                </Button>
              </span>
            ) : (
              <Button size="micro" variant="ghost" onClick={() => setConfirmSignOut(true)}>
                Sign out
              </Button>
            )}
          </div>
        </>
      ) : (
        <SignIn environmentId={environmentId} pill={pill} />
      )}
    </div>
  );
}

function pillLabel(pill: ProxyPillView): string {
  switch (pill.status) {
    case "signedOut":
      return "Sign in";
    case "pending":
      return "Finish sign-in";
    case "offline":
      return "offline";
    default:
      return pill.fallbackText ?? pill.current?.headline ?? "pool";
  }
}

/**
 * The gateway's serving account and headroom, at the size of the other
 * header controls. Two bars are its session and weekly windows against
 * the rotation threshold; the number is the session window; after the
 * rule is the fleet runway. Hover for every pooled account.
 */
export function ProxyUsagePill({
  environmentId: threadEnvironmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const minute = useNowMinute();
  const selected = useMemo(
    () => selectProxySource(configs, [threadEnvironmentId, primaryEnvironmentId]),
    [configs, threadEnvironmentId, primaryEnvironmentId],
  );
  const snapshot: UsageLimitSourceSnapshot | undefined = selected?.snapshot;
  const environmentId = (selected?.environmentId ?? threadEnvironmentId) as EnvironmentId;
  const threshold = snapshot?.proxy?.rotationThresholdPercent ?? 90;
  const pill = useMemo(
    () => (snapshot ? deriveProxyPill(snapshot, Date.parse(`${minute}:00Z`)) : null),
    [snapshot, minute],
  );
  if (!pill) return null;
  const { session, weekly } = windowsOf(pill.current);
  const dim = pill.status !== "live";
  const tone = pill.tone;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        render={
          <Button
            size="xs"
            variant="outline"
            data-toolbar-control=""
            aria-label={`${pill.label}: ${pill.current ? `${pill.current.id} ${pill.current.headline}` : pillLabel(pill)}`}
            className={cn(
              "gap-2 px-2",
              dim && "text-muted-foreground",
              tone === "crit" && !dim && "border-error/50",
            )}
          />
        }
      >
        <IrisGauge
          session={pill.status === "live" ? session : null}
          weekly={pill.status === "live" ? weekly : null}
          className={cn(
            pill.status === "pending" && "text-warning-foreground",
            tone === "crit" && !dim && "text-error-foreground",
            dim && "opacity-60",
          )}
        />
        {pill.status === "live" ? (
          <span className="flex w-8 flex-col gap-[3px]" aria-hidden>
            <Meter
              usedPercent={session?.usedPercent ?? (pill.fallbackText ? 100 : 0)}
              tone={session?.tone ?? tone}
              threshold={threshold}
            />
            <Meter
              usedPercent={weekly?.usedPercent ?? (pill.fallbackText ? 100 : 0)}
              tone={weekly?.tone ?? tone}
              threshold={threshold}
            />
          </span>
        ) : null}
        <span
          className={cn(
            "font-mono text-[11.5px] tabular-nums",
            pill.status === "live" && pill.fallbackText && "text-error-foreground",
          )}
        >
          {pillLabel(pill)}
        </span>
        {pill.status === "live" && pill.runwayText ? (
          <>
            <span className="h-3.5 w-px bg-border" aria-hidden />
            <span
              className={cn(
                "hidden font-mono text-[11.5px] tabular-nums @3xl/header-actions:inline",
                tone === "crit" ? "text-error-foreground" : "text-muted-foreground",
              )}
            >
              {pill.runwayText}
            </span>
          </>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup
        tooltipStyle
        side="bottom"
        align="end"
        padding="none"
        className="w-[21rem] max-w-none text-left whitespace-normal"
      >
        {snapshot ? (
          <Ledger environmentId={environmentId} snapshot={snapshot} threshold={threshold} />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

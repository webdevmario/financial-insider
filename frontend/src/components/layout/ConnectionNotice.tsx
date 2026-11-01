import { useCallback, useEffect, useRef, useState } from "react";
import { useSyncStatus } from "../../lib/offline/status";

type Kind = "offline" | "syncing" | "synced";

/** How long the server must stay unreachable before suggesting Tailscale */
const HINT_DELAY = 60_000;

const TONES: Record<Kind, { border: string; dot: string }> = {
  offline: { border: "border-amber/30", dot: "bg-amber" },
  syncing: { border: "border-accent/30", dot: "bg-accent" },
  synced: { border: "border-green/30", dot: "bg-green" },
};

/** "3m ago" style label for the last time the server answered */
function sinceLabel(iso: string | null): string {
  if (!iso) return "earlier";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface ConnectionNotice {
  kind: Kind | null;
  /** Full text for wider screens */
  text: string;
  /** Compact text for phones */
  short: string;
  /** Shown once the server has been unreachable for a while */
  hint: string | null;
  /** Only while changes are actively being sent */
  pulse: boolean;
  /** The user closed the pill for this state; the logo dot stands in for it */
  dismissed: boolean;
  dismiss: () => void;
  reopen: () => void;
}

/**
 * Connection state for the pill under the nav: offline, catching up on queued
 * changes, or briefly confirming everything synced after an outage.
 */
export function useConnectionNotice(): ConnectionNotice {
  const { reachable, pending, syncing, lastOnline } = useSyncStatus();
  const [justSynced, setJustSynced] = useState(false);
  const [offlineLong, setOfflineLong] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<{ kind: Kind; pending: number; hint: boolean } | null>(null);
  const wasOffline = useRef(false);

  // After an outage, confirm once everything queued has reached the server.
  // Normal online saves sync in the background without a notice.
  useEffect(() => {
    if (reachable === false) {
      wasOffline.current = true;
      setJustSynced(false);
    } else if (reachable && pending === 0 && wasOffline.current) {
      wasOffline.current = false;
      setJustSynced(true);
      const t = setTimeout(() => setJustSynced(false), 3000);
      return () => clearTimeout(t);
    }
  }, [reachable, pending]);

  // Repeated failed checks don't change `reachable`, so this times one continuous outage
  useEffect(() => {
    setOfflineLong(false);
    if (reachable !== false) return;
    const t = setTimeout(() => setOfflineLong(true), HINT_DELAY);
    return () => clearTimeout(t);
  }, [reachable]);

  const changes = `${pending} change${pending === 1 ? "" : "s"}`;
  let kind: Kind | null = null;
  let text = "";
  let short = "";

  if (reachable === false) {
    kind = "offline";
    const since = sinceLabel(lastOnline);
    text = pending > 0
      ? `Offline · ${changes} saved on this device, will sync when you're back`
      : `Offline · showing data from ${since}`;
    short = pending > 0 ? `Offline · ${pending} queued` : `Offline · data from ${since}`;
  } else if (reachable && pending > 0 && (wasOffline.current || !syncing)) {
    // Catching up after an outage, or stuck retrying (e.g. the server is erroring)
    kind = "syncing";
    text = syncing ? `Syncing ${changes}…` : `${changes} waiting to sync`;
    short = syncing ? `Syncing ${pending}…` : `${pending} waiting to sync`;
  } else if (justSynced) {
    kind = "synced";
    text = "Back online · all changes synced";
    short = "Back online · synced";
  }

  const hint = kind === "offline" && offlineLong ? "Can't reach the Mac — is Tailscale on?" : null;

  // A dismissal covers one state. Moving to another state clears it.
  useEffect(() => {
    if (dismissedAt && dismissedAt.kind !== kind) setDismissedAt(null);
  }, [kind, dismissedAt]);

  // More queued changes, or the Tailscale hint appearing, bring the pill back
  const dismissed =
    !!dismissedAt &&
    dismissedAt.kind === kind &&
    pending <= dismissedAt.pending &&
    (dismissedAt.hint || !hint);

  const dismiss = useCallback(() => {
    if (kind) setDismissedAt({ kind, pending, hint: !!hint });
  }, [kind, pending, hint]);
  const reopen = useCallback(() => setDismissedAt(null), []);

  return { kind, text, short, hint, pulse: kind === "syncing" && syncing, dismissed, dismiss, reopen };
}

function StatusDot({ kind, pulse }: { kind: Kind; pulse?: boolean }) {
  const color = TONES[kind].dot;
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      {pulse && (
        <span className={`motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color}`} />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
    </span>
  );
}

/** Floating pill under the nav */
export function ConnectionPill({ notice }: { notice: ConnectionNotice }) {
  const { kind, text, short, hint, pulse, dismissed, dismiss } = notice;
  if (!kind || dismissed) return null;

  return (
    <div className="fixed top-[68px] inset-x-0 z-[100] flex justify-center px-4 pointer-events-none">
      <div
        role="status"
        className={`pointer-events-auto flex items-center gap-2 max-w-full bg-bg-card border ${TONES[kind].border}
          ${hint ? "rounded-2xl" : "rounded-full"} pl-3.5 pr-1.5 py-1.5 text-xs font-medium text-text
          shadow-[0_8px_32px_rgba(0,0,0,0.3)] motion-safe:animate-[pillIn_0.2s_ease]`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot kind={kind} pulse={pulse} />
            <span className="md:hidden">{short}</span>
            <span className="hidden md:inline">{text}</span>
          </div>
          {hint && <div className="pl-4 mt-0.5 font-normal text-text-dim">{hint}</div>}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss connection status"
          className="flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-full text-base leading-none text-text-muted hover:text-text hover:bg-white/[0.06] transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** Small status dot on the logo while the pill is dismissed; tapping it brings the pill back */
export function ConnectionDot({ notice }: { notice: ConnectionNotice }) {
  const { kind, dismissed, reopen } = notice;
  if (!kind || !dismissed) return null;

  return (
    <button
      onClick={reopen}
      aria-label="Show connection status"
      title="Show connection status"
      className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center"
    >
      <span className={`h-2.5 w-2.5 rounded-full ring-2 ring-bg ${TONES[kind].dot}`} />
    </button>
  );
}

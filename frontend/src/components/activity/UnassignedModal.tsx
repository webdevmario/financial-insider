import { useEffect, useState } from "react";
import Modal from "../layout/Modal";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/formatters";
import { Empty, money, moneyInNote, TxnRows } from "./shared";
import type { UnassignedMerchant, UnassignedTxn } from "../../types";

const FIRST_PAGE = 50;

interface Props {
  group: UnassignedMerchant | null;
  version: number;
  onClose: () => void;
  /** Hand ticked transactions to the payee picker; they're assigned one by one, by hand */
  onAssign: (group: UnassignedMerchant, rows: UnassignedTxn[]) => void;
  /** Hand the whole bank name to the payee picker (becomes an alias) */
  onGroupAll: (group: UnassignedMerchant) => void;
  onToast: (msg: string, err?: boolean) => void;
}

/**
 * Inspect the transactions behind one No payee yet bank name before grouping it:
 * date, what the bank wrote, account and amount. Ticking some assigns just those;
 * otherwise the whole bank name can be named or grouped from here.
 */
export default function UnassignedModal({ group, version, onClose, onAssign, onGroupAll, onToast }: Props) {
  const [data, setData] = useState<{ total: number; rows: UnassignedTxn[] } | null>(null);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const key = group?.key;

  // A different bank name starts fresh
  useEffect(() => {
    setData(null);
    setAll(false);
    setPicked(new Set());
  }, [key]);

  useEffect(() => {
    if (!key) return;
    let live = true;
    api.payees.unassignedTransactions(key, all ? undefined : FIRST_PAGE)
      .then((d) => {
        if (!live) return;
        setData(d);
        // Keep only ticks on rows still here (assigned rows drop out)
        setPicked((p) => new Set(d.rows.filter((r) => p.has(r.id)).map((r) => r.id)));
      })
      .catch((err) => live && onToast(err instanceof Error ? err.message : "Couldn't load transactions", true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, all, version]);

  if (!group) return null;
  const g = group;
  const rows = data?.rows ?? [];
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const extra = moneyInNote(g.spent, g.received);

  function toggle(txnId: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(txnId)) next.delete(txnId);
      else next.add(txnId);
      return next;
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      variant="detail"
      title={g.merchant}
      className="h-[min(680px,85%)] md:!w-[760px] max-md:h-[min(760px,92%)]"
      footer={
        picked.size > 0 ? (
          <>
            <button className="btn mr-auto" onClick={() => setPicked(new Set())}>Clear</button>
            <button className="btn btn-primary" onClick={() => onAssign(g, rows.filter((r) => picked.has(r.id)))}>
              Assign {picked.size} to payee…
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Close</button>
            <button className="btn btn-primary" disabled={!data || data.total === 0} onClick={() => onGroupAll(g)}>
              Name all {data?.total ?? g.count}…
            </button>
          </>
        )
      }
    >
      <div className="text-xs text-text-muted mb-3">
        {g.count}× · <span className="font-mono text-text-dim">{money(g.spent, g.received)}</span>
        {extra && <> · <span className="text-green">{extra}</span></>}
        {g.lastDate && <> · last {fmtDate(g.lastDate)}</>}
      </div>

      {data === null ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>No transactions left under this bank name.</Empty>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 pb-1.5 mb-0.5 border-b border-border text-[11px] text-text-muted">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allPicked}
                ref={(el) => { if (el) el.indeterminate = picked.size > 0 && !allPicked; }}
                onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))}
              />
              {picked.size > 0 ? `${picked.size} ticked` : "Tick rows to give just those a payee"}
            </label>
            <span className="shrink-0">
              {data.total > rows.length ? `Latest ${rows.length} of ${data.total}` : `${data.total} transaction${data.total === 1 ? "" : "s"}`}
            </span>
          </div>
          <TxnRows rows={rows} select={{ picked, onToggle: toggle }} />
          {data.total > FIRST_PAGE && (
            <button type="button" className="link-tap text-xs mt-3" onClick={() => setAll((v) => !v)}>
              {all ? `Show latest ${FIRST_PAGE}` : `Show all ${data.total}`}
            </button>
          )}
        </>
      )}
    </Modal>
  );
}

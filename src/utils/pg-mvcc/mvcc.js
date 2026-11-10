/**
 * MVCC visibility simulator: a pure, simplified but faithful port of
 * HeapTupleSatisfiesMVCC() (src/backend/access/heap/heapam_visibility.c) and
 * XidInMVCCSnapshot() (src/backend/utils/time/snapmgr.c) of PostgreSQL.
 *
 * Simplifications (documented in the UI):
 *   - pre-9.0 HEAP_MOVED_OFF / HEAP_MOVED_IN handling is skipped;
 *   - a MultiXact xmax is modelled by its single updater xid (the `xmax` input);
 *   - subtransactions are not modelled (the snapshot has no subxip array);
 *   - commit status comes from the user instead of pg_xact (clog).
 */

export const InvalidTransactionId = 0;
export const BootstrapTransactionId = 1;
export const FrozenTransactionId = 2;
export const FirstNormalTransactionId = 3;

export const HINTS = [
  { id: "xminCommitted", name: "HEAP_XMIN_COMMITTED", bit: 0x0100 },
  { id: "xminInvalid", name: "HEAP_XMIN_INVALID", bit: 0x0200 },
  { id: "xmaxCommitted", name: "HEAP_XMAX_COMMITTED", bit: 0x0400 },
  { id: "xmaxInvalid", name: "HEAP_XMAX_INVALID", bit: 0x0800 },
  { id: "xmaxLockOnly", name: "HEAP_XMAX_LOCK_ONLY", bit: 0x0080 },
  { id: "xmaxExclLock", name: "HEAP_XMAX_EXCL_LOCK", bit: 0x0040 },
  { id: "xmaxKeyshrLock", name: "HEAP_XMAX_KEYSHR_LOCK", bit: 0x0010 },
  { id: "xmaxIsMulti", name: "HEAP_XMAX_IS_MULTI", bit: 0x1000 },
];

export const STATUSES = ["in progress", "committed", "aborted"];

/** Hint checkbox state -> t_infomask number (visibility bits only). */
export const hintsToInfomask = (hints) => HINTS.reduce((m, h) => (hints[h.id] ? m | h.bit : m), 0);

/** t_infomask number -> hint checkbox state. */
export const infomaskToHints = (mask) => Object.fromEntries(HINTS.map((h) => [h.id, (mask & h.bit) !== 0]));

// ---------- xid arithmetic (transam.c) ----------
const XID_MOD = 2 ** 32;
/** 64-bit FullTransactionId (as from pg_current_snapshot) -> 32-bit xid. */
export const toXid32 = (n) => ((n % XID_MOD) + XID_MOD) % XID_MOD;
export const isNormalXid = (x) => x >= FirstNormalTransactionId;

/** TransactionIdPrecedes: modulo-2^32 comparison for normal xids, plain otherwise. */
export function xidPrecedes(a, b) {
  if (!isNormalXid(a) || !isNormalXid(b)) return a < b;
  const diff = (a - b) | 0; // int32 wraparound
  return diff < 0;
}
export const xidFollowsOrEquals = (a, b) => !xidPrecedes(a, b);

// ---------- snapshot ----------
/**
 * Parse pg_current_snapshot() / txid_current_snapshot() text: "xmin:xmax:xip1,xip2".
 * Returns { xmin, xmax, xip: [] } as 32-bit xids, or { error }.
 */
export function parseSnapshot(text) {
  const s = String(text ?? "").trim();
  const m = /^(\d+):(\d+):([\d,\s]*)$/.exec(s);
  if (!m) return { error: "Snapshot must look like xmin:xmax:xip_list, e.g. 100:105:101,103" };
  const xmin = Number(m[1]);
  const xmax = Number(m[2]);
  const xip = m[3]
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);
  if (xmin > xmax) return { error: "Snapshot xmin must be ≤ xmax." };
  const bad = xip.find((x) => x < xmin || x >= xmax);
  if (bad !== undefined) return { error: `xip ${bad} must satisfy xmin ≤ xip < xmax.` };
  return { xmin: toXid32(xmin), xmax: toXid32(xmax), xip: xip.map(toXid32), text: s };
}

/**
 * XidInMVCCSnapshot: is `xid` still "in progress" as far as the snapshot is concerned?
 * Returns { inSnapshot, reason }.
 */
export function xidInMVCCSnapshot(xid, snap) {
  if (xidPrecedes(xid, snap.xmin))
    return { inSnapshot: false, reason: `${xid} < snapshot xmin ${snap.xmin}: finished before the snapshot was taken` };
  if (xidFollowsOrEquals(xid, snap.xmax))
    return { inSnapshot: true, reason: `${xid} ≥ snapshot xmax ${snap.xmax}: started after the snapshot, so treated as running` };
  if (snap.xip.includes(xid)) return { inSnapshot: true, reason: `${xid} is in the snapshot's xip list: it was running when the snapshot was taken` };
  return { inSnapshot: false, reason: `${xid} is between xmin and xmax but not in xip: it had finished when the snapshot was taken` };
}

// ---------- the check ----------
/**
 * @param {object} input
 *   xmin, xmax: tuple xids (32-bit or 64-bit, reduced mod 2^32)
 *   hints: { xminCommitted, xminInvalid, xmaxCommitted, xmaxInvalid, xmaxLockOnly, xmaxExclLock, xmaxKeyshrLock, xmaxIsMulti }
 *   xminStatus, xmaxStatus: "in progress" | "committed" | "aborted" (what pg_xact would say)
 *   myXid: current transaction's xid (0 = none assigned yet)
 *   curcid: current command id of the scan (snapshot->curcid)
 *   cmin, cmax: tuple's command ids (only consulted for own-transaction cases)
 *   snapshot: "xmin:xmax:xip" text
 * @returns {{ visible: boolean|null, steps: object[], hintsSet: string[], warnings: string[], error?: string }}
 */
export function satisfiesMVCC(input) {
  const steps = [];
  const hintsSet = [];
  const warnings = [];
  const snap = parseSnapshot(input.snapshot);
  if (snap.error) return { visible: null, steps, hintsSet, warnings, error: snap.error };

  const h = input.hints ?? {};
  const xmin = toXid32(Number(input.xmin) || 0);
  const xmax = toXid32(Number(input.xmax) || 0);
  const myXid = toXid32(Number(input.myXid) || 0);
  const curcid = Number(input.curcid) || 0;
  const cmin = Number(input.cmin) || 0;
  const cmax = Number(input.cmax) || 0;

  const isCurrent = (x) => isNormalXid(x) && myXid !== 0 && x === myXid;
  /** TransactionIdDidCommit, per the user's status (special xids per transam.c). */
  const didCommit = (x, status) => {
    if (x === BootstrapTransactionId || x === FrozenTransactionId) return true;
    if (!isNormalXid(x)) return false;
    return status === "committed";
  };

  const step = (code, text, extra = {}) => steps.push({ code, text, ...extra });
  const done = (visible, code, text) => {
    step(code, text, { result: visible });
    return { visible, steps, hintsSet, warnings, snapshot: snap };
  };

  // Consistency checks: these are not part of PostgreSQL, they flag impossible inputs.
  const checkStatus = (label, x, status) => {
    if (!isNormalXid(x) || isCurrent(x)) return;
    const { inSnapshot } = xidInMVCCSnapshot(x, snap);
    if (status === "in progress" && !inSnapshot)
      warnings.push(`${label} ${x} is marked in progress, but the snapshot says it had already finished. A real snapshot can't see that.`);
  };
  checkStatus("xmin", xmin, input.xminStatus);
  if (!h.xmaxInvalid && xmax !== 0) checkStatus("xmax", xmax, input.xmaxStatus);
  if (h.xminCommitted && !h.xminInvalid && input.xminStatus === "aborted" && !isCurrent(xmin))
    warnings.push("HEAP_XMIN_COMMITTED is set but xmin is marked aborted: hint bits are only set after commit.");
  if (h.xmaxCommitted && input.xmaxStatus === "aborted")
    warnings.push("HEAP_XMAX_COMMITTED is set but xmax is marked aborted.");
  if (h.xmaxCommitted && h.xmaxInvalid) warnings.push("XMAX_COMMITTED and XMAX_INVALID together mean a composite datum, never a heap tuple.");
  if (myXid !== 0 && snap.xip.includes(myXid)) warnings.push(`Your own xid ${myXid} is in the xip list; a backend's own snapshot never lists its own xid.`);

  const frozen = h.xminCommitted && h.xminInvalid;
  const xminCommittedHint = h.xminCommitted; // HeapTupleHeaderXminCommitted
  const xminInvalidHint = h.xminInvalid && !h.xminCommitted; // HeapTupleHeaderXminInvalid
  const lockOnly = h.xmaxLockOnly || (!h.xmaxIsMulti && h.xmaxExclLock && !h.xmaxKeyshrLock);

  step("start", `Snapshot ${snap.xmin}:${snap.xmax}:${snap.xip.join(",")} · curcid ${curcid}${myXid ? ` · my xid ${myXid}` : " · no xid assigned"}`);

  // ----- xmin -----
  if (!xminCommittedHint) {
    step("xmin-not-hinted", "HEAP_XMIN_COMMITTED is not set, so the inserter has to be checked.");
    if (xminInvalidHint) return done(false, "xmin-invalid", "HEAP_XMIN_INVALID is set: the inserting transaction aborted. Invisible.");

    if (isCurrent(xmin)) {
      step("own-insert", `xmin ${xmin} is my own transaction (TransactionIdIsCurrentTransactionId).`);
      if (cmin >= curcid)
        return done(false, "own-cmin", `cmin ${cmin} ≥ curcid ${curcid}: inserted by this or a later command of my transaction, after the scan started. Invisible.`);
      step("own-cmin-ok", `cmin ${cmin} < curcid ${curcid}: inserted by an earlier command.`);
      if (h.xmaxInvalid || xmax === 0) return done(true, "own-xmax-invalid", "xmax is invalid: not deleted. Visible.");
      if (lockOnly) return done(true, "own-lock-only", "xmax only locked the row (HEAP_XMAX_IS_LOCKED_ONLY). Visible.");
      if (h.xmaxIsMulti) step("own-multi", `xmax is a MultiXact; its updater is taken to be ${xmax}.`);
      if (!isCurrent(xmax)) {
        hintsSet.push("HEAP_XMAX_INVALID");
        return done(true, "own-xmax-other", `xmax ${xmax} is not my transaction, so the deleting subtransaction must have aborted. Visible.`);
      }
      if (cmax >= curcid)
        return done(true, "own-cmax-later", `I deleted it, but cmax ${cmax} ≥ curcid ${curcid}: the delete happened after the scan started. Visible.`);
      return done(false, "own-cmax-earlier", `I deleted it with cmax ${cmax} < curcid ${curcid}: deleted before the scan started. Invisible.`);
    }

    const s = xidInMVCCSnapshot(xmin, snap);
    if (s.inSnapshot) return done(false, "xmin-in-snapshot", `XidInMVCCSnapshot(xmin): ${s.reason}. The insert is not visible yet. Invisible.`);
    step("xmin-not-in-snapshot", `XidInMVCCSnapshot(xmin): ${s.reason}.`);
    if (didCommit(xmin, input.xminStatus)) {
      hintsSet.push("HEAP_XMIN_COMMITTED");
      step("xmin-did-commit", `TransactionIdDidCommit(${xmin}) is true: the inserter committed (hint HEAP_XMIN_COMMITTED would be set).`);
    } else {
      hintsSet.push("HEAP_XMIN_INVALID");
      return done(false, "xmin-aborted", `TransactionIdDidCommit(${xmin}) is false: the inserter aborted or crashed (hint HEAP_XMIN_INVALID would be set). Invisible.`);
    }
  } else if (frozen) {
    step("xmin-frozen", "xmin is frozen (XMIN_COMMITTED | XMIN_INVALID): the insert is visible to every snapshot; skip the snapshot test.");
  } else {
    step("xmin-hinted", "HEAP_XMIN_COMMITTED is set: the inserter committed, but maybe not as far as this snapshot is concerned.");
    const s = xidInMVCCSnapshot(xmin, snap);
    if (s.inSnapshot) return done(false, "xmin-committed-in-snapshot", `XidInMVCCSnapshot(xmin): ${s.reason}. Treat the insert as still in progress. Invisible.`);
    step("xmin-committed-visible", `XidInMVCCSnapshot(xmin): ${s.reason}.`);
  }

  step("inserter-committed", "By here the inserting transaction is committed and visible to the snapshot.");

  // ----- xmax -----
  if (h.xmaxInvalid || xmax === 0) {
    if (!h.xmaxInvalid) hintsSet.push("HEAP_XMAX_INVALID");
    return done(true, "xmax-invalid", `xmax is ${h.xmaxInvalid ? "marked HEAP_XMAX_INVALID" : "0 (never deleted)"}: nobody deleted the row. Visible.`);
  }
  if (lockOnly)
    return done(true, "xmax-lock-only", `xmax ${xmax} only locked the row (HEAP_XMAX_IS_LOCKED_ONLY), it did not delete it. Visible.`);
  if (h.xmaxIsMulti) step("xmax-multi", `xmax is a MultiXact; its updater is taken to be ${xmax} (HeapTupleGetUpdateXid).`);

  if (!h.xmaxCommitted) {
    step("xmax-not-hinted", "HEAP_XMAX_COMMITTED is not set, so the deleter has to be checked.");
    if (isCurrent(xmax)) {
      if (cmax >= curcid)
        return done(true, "own-delete-later", `I deleted it, but cmax ${cmax} ≥ curcid ${curcid}: deleted after the scan started. Visible.`);
      return done(false, "own-delete-earlier", `I deleted it with cmax ${cmax} < curcid ${curcid}: deleted before the scan started. Invisible.`);
    }
    const s = xidInMVCCSnapshot(xmax, snap);
    if (s.inSnapshot) return done(true, "xmax-in-snapshot", `XidInMVCCSnapshot(xmax): ${s.reason}. The delete isn't visible to us. Visible.`);
    step("xmax-not-in-snapshot", `XidInMVCCSnapshot(xmax): ${s.reason}.`);
    if (!didCommit(xmax, input.xmaxStatus)) {
      hintsSet.push("HEAP_XMAX_INVALID");
      return done(true, "xmax-aborted", `TransactionIdDidCommit(${xmax}) is false: the deleter aborted or crashed (hint HEAP_XMAX_INVALID would be set). Visible.`);
    }
    hintsSet.push("HEAP_XMAX_COMMITTED");
    step("xmax-did-commit", `TransactionIdDidCommit(${xmax}) is true: the deleter committed (hint HEAP_XMAX_COMMITTED would be set).`);
  } else {
    step("xmax-hinted", "HEAP_XMAX_COMMITTED is set: the deleter committed, but maybe not as far as this snapshot is concerned.");
    const s = xidInMVCCSnapshot(xmax, snap);
    if (s.inSnapshot) return done(true, "xmax-committed-in-snapshot", `XidInMVCCSnapshot(xmax): ${s.reason}. Treat the delete as still in progress. Visible.`);
    step("xmax-committed-visible", `XidInMVCCSnapshot(xmax): ${s.reason}.`);
  }
  return done(false, "deleted", "The deleting transaction committed before the snapshot. Invisible.");
}

// ---------- presets ----------
const NO_HINTS = Object.fromEntries(HINTS.map((x) => [x.id, false]));
const base = {
  xmin: 100,
  xmax: 0,
  hints: { ...NO_HINTS, xmaxInvalid: true },
  xminStatus: "committed",
  xmaxStatus: "committed",
  myXid: 0,
  curcid: 0,
  cmin: 0,
  cmax: 0,
  snapshot: "120:125:121,123",
};

export const PRESETS = [
  {
    id: "committed-live",
    label: "Plain live row",
    note: "Inserted by a transaction that committed long before the snapshot.",
    input: { ...base, hints: { ...NO_HINTS, xminCommitted: true, xmaxInvalid: true } },
  },
  {
    id: "concurrent-insert",
    label: "Inserted by concurrent txn",
    note: "xmin 121 was still running when the snapshot was taken (it's in xip), even though it has committed since.",
    input: { ...base, xmin: 121, xminStatus: "committed" },
  },
  {
    id: "insert-after-snapshot",
    label: "Inserted after snapshot",
    note: "xmin 126 started after the snapshot (≥ xmax), so it is invisible regardless of its outcome.",
    input: { ...base, xmin: 126, xminStatus: "committed" },
  },
  {
    id: "deleted-before",
    label: "Deleted before snapshot",
    note: "xmax 110 committed before the snapshot: the row is gone for us.",
    input: { ...base, xmax: 110, hints: { ...NO_HINTS, xminCommitted: true }, xmaxStatus: "committed" },
  },
  {
    id: "deleted-after",
    label: "Deleted after snapshot",
    note: "xmax 123 was running when the snapshot was taken. It has since committed, but we still see the row.",
    input: { ...base, xmax: 123, hints: { ...NO_HINTS, xminCommitted: true, xmaxCommitted: true }, xmaxStatus: "committed" },
  },
  {
    id: "aborted-delete",
    label: "Aborted delete",
    note: "xmax 115 rolled back; no hint bit yet, so pg_xact is consulted and the row stays visible.",
    input: { ...base, xmax: 115, hints: { ...NO_HINTS, xminCommitted: true }, xmaxStatus: "aborted" },
  },
  {
    id: "aborted-insert",
    label: "Aborted insert",
    note: "xmin 112 rolled back: the tuple was never really there.",
    input: { ...base, xmin: 112, xminStatus: "aborted" },
  },
  {
    id: "own-insert",
    label: "Own insert (earlier cmd)",
    note: "My transaction 124 inserted it in command 0; this scan runs as command 2.",
    input: { ...base, xmin: 124, xminStatus: "in progress", myXid: 124, curcid: 2, cmin: 0, snapshot: "120:125:121,123" },
  },
  {
    id: "own-insert-same-cmd",
    label: "Own insert (same cmd)",
    note: "Inserted by the command that is scanning (cmin = curcid), e.g. INSERT ... SELECT reading its own target.",
    input: { ...base, xmin: 124, xminStatus: "in progress", myXid: 124, curcid: 2, cmin: 2, snapshot: "120:125:121,123" },
  },
  {
    id: "own-delete",
    label: "Own delete",
    note: "My transaction deleted a committed row in command 1; command 3 no longer sees it.",
    input: {
      ...base,
      xmax: 124,
      hints: { ...NO_HINTS, xminCommitted: true },
      xmaxStatus: "in progress",
      myXid: 124,
      curcid: 3,
      cmax: 1,
    },
  },
  {
    id: "locked-only",
    label: "Locked FOR UPDATE",
    note: "xmax 123 ran SELECT ... FOR UPDATE. A locker never hides the row.",
    input: {
      ...base,
      xmax: 123,
      hints: { ...NO_HINTS, xminCommitted: true, xmaxLockOnly: true, xmaxExclLock: true },
      xmaxStatus: "in progress",
    },
  },
  {
    id: "frozen",
    label: "Frozen tuple",
    note: "VACUUM FREEZE set XMIN_COMMITTED | XMIN_INVALID. xmin 3 is ancient (or wrapped around) and the snapshot test is skipped.",
    input: { ...base, xmin: 3, hints: { ...NO_HINTS, xminCommitted: true, xminInvalid: true, xmaxInvalid: true } },
  },
];

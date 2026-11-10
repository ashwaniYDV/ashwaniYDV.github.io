/**
 * PostgreSQL LSN / WAL arithmetic (pure, no React). All positions are BigInt byte offsets.
 *
 * An LSN is printed as `%X/%X`: the high and low 32 bits of a 64-bit WAL position.
 * WAL file names follow XLogFileName() in src/include/access/xlog_internal.h:
 *   %08X%08X%08X  =  timeline, segno / segmentsPerXLogId, segno % segmentsPerXLogId
 * where segmentsPerXLogId = 0x100000000 / wal_segment_size.
 */
import { parseTable } from "./table.js";

export const MAX_LSN = (1n << 64n) - 1n;
export const DEFAULT_SEG_SIZE = 16n * 1024n * 1024n;
export const MB = 1024n * 1024n;
/** wal_segment_size must be a power of two between 1 MB and 1 GB (initdb --wal-segsize). */
export const SEGMENT_SIZES = [1n, 2n, 4n, 8n, 16n, 32n, 64n, 128n, 256n, 512n, 1024n].map((m) => m * MB);
export const XLOG_BLCKSZ = 8192n;

const LSN_RE = /^([0-9a-f]{1,8})\/([0-9a-f]{1,8})$/i;

/** Parse `16/B374D848` into a BigInt. Returns `{ value }` or `{ error }`. */
export function parseLsn(text) {
  const s = String(text ?? "").trim().replace(/^'|'(::pg_lsn)?$/gi, "");
  if (!s) return { error: "Enter an LSN like 16/B374D848." };
  const m = LSN_RE.exec(s);
  if (!m) {
    if (/^\d+$/.test(s)) {
      const v = BigInt(s);
      if (v > MAX_LSN) return { error: "Byte position is larger than 2^64 − 1." };
      return { value: v, fromBytes: true };
    }
    if (/[0-9a-f]+\/[0-9a-f]+/i.test(s) && s.includes("/")) {
      return { error: "Each half of an LSN is at most 8 hex digits (32 bits), e.g. 16/B374D848." };
    }
    return { error: "Not an LSN. Use the X/Y hex form, e.g. 0/16B3748 or 16/B374D848." };
  }
  return { value: (BigInt(`0x${m[1]}`) << 32n) | BigInt(`0x${m[2]}`) };
}

/** BigInt -> `X/Y` exactly as PostgreSQL prints it (uppercase, no padding). */
export function formatLsn(value) {
  if (value < 0n || value > MAX_LSN) throw new RangeError("LSN out of range");
  return `${(value >> 32n).toString(16).toUpperCase()}/${(value & 0xffffffffn).toString(16).toUpperCase()}`;
}

/** 1536 -> "1.50 KiB". Signed. */
export function humanBytes(bytes) {
  const neg = bytes < 0n;
  let abs = neg ? -bytes : bytes;
  const units = ["bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  if (abs < 1024n) return `${neg ? "−" : ""}${abs} ${abs === 1n ? "byte" : "bytes"}`;
  let u = 0;
  let div = 1n;
  while (abs >= div * 1024n && u < units.length - 1) {
    div *= 1024n;
    u++;
  }
  // Two decimals without losing precision on huge values.
  let hundredths = (abs * 100n + div / 2n) / div;
  if (hundredths >= 102400n && u < units.length - 1) {
    // Rounding carried into the next unit (e.g. 1023.999 KiB).
    u++;
    div *= 1024n;
    hundredths = (abs * 100n + div / 2n) / div;
  }
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, "0");
  return `${neg ? "−" : ""}${whole.toLocaleString("en-US")}.${frac} ${units[u]}`;
}

export const groupDigits = (n) => {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return neg ? `−${s}` : s;
};

const UNIT_FACTORS = {
  "": 1n,
  b: 1n,
  byte: 1n,
  bytes: 1n,
  k: 1024n,
  kb: 1024n,
  kib: 1024n,
  m: MB,
  mb: MB,
  mib: MB,
  g: MB * 1024n,
  gb: MB * 1024n,
  gib: MB * 1024n,
  t: MB * MB,
  tb: MB * MB,
  tib: MB * MB,
};

/** Parse "4096", "-16MB", "1.5 GB", "0x1000" (units are 1024-based like PostgreSQL). */
export function parseByteAmount(text) {
  const s = String(text ?? "").trim().replace(/,/g, "").replace(/−/g, "-");
  if (!s) return { error: "Enter a byte amount, e.g. 16MB or -4096." };
  const hex = /^([+-]?)0x([0-9a-f]+)$/i.exec(s);
  if (hex) {
    const v = BigInt(`0x${hex[2]}`);
    return { value: hex[1] === "-" ? -v : v };
  }
  const m = /^([+-]?)(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(s);
  if (!m) return { error: "Use a number with an optional unit: 8192, 16MB, -1.5GB." };
  const factor = UNIT_FACTORS[m[3].toLowerCase()];
  if (factor === undefined) return { error: `Unknown unit "${m[3]}". Use bytes, kB, MB, GB or TB.` };
  const [int, frac = ""] = m[2].split(".");
  const scale = 10n ** BigInt(frac.length);
  const raw = (BigInt(int + frac) * factor) / scale;
  if ((BigInt(int + frac) * factor) % scale !== 0n) return { error: "That amount is not a whole number of bytes." };
  return { value: m[1] === "-" ? -raw : raw };
}

/** a + delta, validated to stay inside 0 .. 2^64-1. */
export function addBytes(lsn, delta) {
  const v = lsn + delta;
  if (v < 0n) return { error: "Result is below 0/0." };
  if (v > MAX_LSN) return { error: "Result is past FFFFFFFF/FFFFFFFF." };
  return { value: v };
}

export function validateSegSize(segSize) {
  const s = BigInt(segSize);
  if (!SEGMENT_SIZES.includes(s)) return "wal_segment_size must be a power of two from 1 MB to 1 GB.";
  return null;
}

export function validateTimeline(tli) {
  const t = Number(tli);
  if (!Number.isInteger(t) || t < 1 || t > 0xffffffff) return "Timeline must be an integer from 1 to 4294967295.";
  return null;
}

const hex8 = (n) => n.toString(16).toUpperCase().padStart(8, "0");

/** Segment number containing byte `lsn` (XLByteToSeg). */
export const segNo = (lsn, segSize = DEFAULT_SEG_SIZE) => lsn / BigInt(segSize);

/** XLogFileName(tli, segno, segSize). */
export function walFileName(tli, segno, segSize = DEFAULT_SEG_SIZE) {
  const perId = 0x100000000n / BigInt(segSize);
  return `${hex8(BigInt(tli))}${hex8(segno / perId)}${hex8(segno % perId)}`;
}

/**
 * Everything about where an LSN sits in WAL.
 * `fileName` is the segment containing the byte at `lsn`. pg_walfile_name() uses XLByteToPrevSeg
 * (the segment holding the byte *before* lsn), so it differs exactly on a segment boundary.
 */
export function lsnToSegment(lsn, tli = 1, segSize = DEFAULT_SEG_SIZE) {
  const size = BigInt(segSize);
  const err = validateSegSize(size) || validateTimeline(tli);
  if (err) return { error: err };
  const seg = segNo(lsn, size);
  const offset = lsn % size;
  const prevSeg = lsn === 0n ? 0n : (lsn - 1n) / size;
  return {
    segno: seg,
    fileName: walFileName(tli, seg, size),
    walfileName: walFileName(tli, prevSeg, size),
    offset,
    pageOffset: offset % XLOG_BLCKSZ,
    page: offset / XLOG_BLCKSZ,
    start: seg * size,
    end: seg * size + size, // exclusive
    onBoundary: offset === 0n,
  };
}

/** `000000010000001600000002` -> `{ tli, segno, start, end }` (end exclusive). */
export function segmentToLsn(name, segSize = DEFAULT_SEG_SIZE) {
  const size = BigInt(segSize);
  const sizeErr = validateSegSize(size);
  if (sizeErr) return { error: sizeErr };
  const s = String(name ?? "")
    .trim()
    .replace(/^.*\//, "")
    .replace(/\.partial$/i, "");
  if (!s) return { error: "Enter a 24-character WAL file name, e.g. 000000010000001600000002." };
  if (/\.history$/i.test(s)) return { error: "That is a timeline history file, not a WAL segment." };
  const backup = /^([0-9a-f]{24})\.[0-9a-f]{8}\.backup$/i.exec(s);
  const m = /^([0-9a-f]{8})([0-9a-f]{8})([0-9a-f]{8})$/i.exec(backup ? backup[1] : s);
  if (!m) return { error: "A WAL segment name is exactly 24 hex digits: timeline (8) + log (8) + segment (8)." };
  const tli = BigInt(`0x${m[1]}`);
  const log = BigInt(`0x${m[2]}`);
  const seg = BigInt(`0x${m[3]}`);
  const perId = 0x100000000n / size;
  if (tli === 0n) return { error: "Timeline 0 is not valid (timelines start at 1)." };
  if (seg >= perId) {
    return {
      error: `Segment part ${m[3].toUpperCase()} is too large for a ${size / MB} MB segment size (max ${hex8(perId - 1n)}). Check wal_segment_size.`,
    };
  }
  const segno = log * perId + seg;
  return { tli: Number(tli), segno, start: segno * size, end: segno * size + size, isBackupLabel: Boolean(backup) };
}

// ---------- replication lag ----------
const LSN_COLUMNS = ["sent_lsn", "write_lsn", "flush_lsn", "replay_lsn"];
// PostgreSQL 9.6 and older names.
const LEGACY = { sent_location: "sent_lsn", write_location: "write_lsn", flush_location: "flush_lsn", replay_location: "replay_lsn" };

/**
 * Parse pasted pg_stat_replication rows and compute lag per standby.
 * `currentText` is pg_current_wal_lsn() on the primary; if blank, the highest sent_lsn is used.
 */
export function replicationLag(text, currentText = "") {
  const table = parseTable(text);
  if (table.error) return { error: table.error === "empty" ? "empty" : table.error };
  const rename = (c) => LEGACY[c] ?? c;
  const columns = table.columns.map(rename);
  const rows = table.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [rename(k), v])));
  const present = LSN_COLUMNS.filter((c) => columns.includes(c));
  if (!present.length) {
    return { error: "No sent_lsn / write_lsn / flush_lsn / replay_lsn columns found. Paste pg_stat_replication output with its header row." };
  }

  const standbys = [];
  const problems = [];
  rows.forEach((r, i) => {
    const name = r.application_name || r.client_addr || r.client_hostname || r.pid || `standby ${i + 1}`;
    const lsn = {};
    for (const c of present) {
      if (!r[c]) continue; // NULL (e.g. not yet streaming)
      const p = parseLsn(r[c]);
      if (p.error) problems.push(`Row ${i + 1} (${name}): ${c} "${r[c]}" is not an LSN.`);
      else lsn[c] = p.value;
    }
    standbys.push({ name, state: r.state ?? "", syncState: r.sync_state ?? "", lsn, raw: r });
  });

  let current;
  let currentSource = "pg_current_wal_lsn()";
  if (String(currentText).trim()) {
    const p = parseLsn(currentText);
    if (p.error) return { error: `Primary LSN: ${p.error}` };
    current = p.value;
  } else {
    const sent = standbys.map((s) => s.lsn.sent_lsn).filter((v) => v !== undefined);
    if (sent.length) {
      current = sent.reduce((a, b) => (b > a ? b : a));
      currentSource = "highest sent_lsn";
    }
  }

  const diff = (a, b) => (a === undefined || b === undefined ? undefined : a - b);
  for (const s of standbys) {
    const { sent_lsn, write_lsn, flush_lsn, replay_lsn } = s.lsn;
    s.lag = {
      send: diff(current, sent_lsn), // still on the primary
      write: diff(sent_lsn, write_lsn), // sent, not yet written by the standby
      flush: diff(write_lsn, flush_lsn), // written, not yet fsynced
      replay: diff(flush_lsn, replay_lsn), // durable, not yet applied
      total: diff(current, replay_lsn ?? flush_lsn ?? write_lsn ?? sent_lsn),
    };
  }
  return { standbys, current, currentSource, problems, columns: present };
}

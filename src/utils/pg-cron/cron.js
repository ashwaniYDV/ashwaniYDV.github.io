/**
 * pg_cron schedule parsing, explanation and next-run calculation (no React).
 *
 * pg_cron's parser is Paul Vixie's cron parser (src/entry.c) plus two
 * additions: '$' (last day of the month) in the day-of-month field and
 * '[1-59] seconds' interval schedules. This module follows that code:
 *   - fields: minute hour day-of-month month day-of-week
 *   - each field is a comma list of: *, n, a-b, *\/s, a-b/s  (n/s alone is an error)
 *   - month and weekday names (jan..dec, sun..sat), case-insensitive
 *   - day-of-week 0 and 7 are both Sunday
 *   - @yearly @annually @monthly @weekly @daily @midnight @hourly
 *   - day matching: if the day-of-month OR day-of-week field starts with '*',
 *     both must match (AND); otherwise either may match (OR), unless
 *     cron.match_dom_and_dow is on.
 * Times are evaluated in the cron.timezone setting (default GMT).
 */

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOW_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const FIELDS = [
  { id: "minute", label: "Minute", low: 0, high: 59 },
  { id: "hour", label: "Hour", low: 0, high: 23 },
  { id: "dom", label: "Day of month", low: 1, high: 31 },
  { id: "month", label: "Month", low: 1, high: 12, names: MONTH_NAMES },
  { id: "dow", label: "Day of week", low: 0, high: 7, names: DOW_NAMES },
];

const SPECIALS = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

class CronError extends Error {}

function parseNumber(text, field, isStep) {
  if (/^\d+$/.test(text)) return Number(text);
  if (!isStep && field.names) {
    const i = field.names.indexOf(text.toLowerCase());
    if (i !== -1) return i + field.low;
  }
  throw new CronError(
    field.names && !isStep
      ? `${field.label}: "${text}" is not a number or a name (${field.names.slice(0, 3).join(", ")}, ...)`
      : `${field.label}: "${text}" is not a number`,
  );
}

/** Parse one field into { values: Set, parts: [{start,end,step,star}], star } */
function parseField(text, field) {
  if (!text) throw new CronError(`${field.label} is missing`);
  const values = new Set();
  const parts = [];
  for (const piece of text.split(",")) {
    if (!piece) throw new CronError(`${field.label}: empty item in list "${text}"`);
    const m = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/([A-Za-z0-9]*))?$/.exec(piece);
    if (!m) throw new CronError(`${field.label}: cannot read "${piece}"`);
    const [, base, stepText] = m;
    let start;
    let end;
    const star = base === "*";
    if (star) {
      start = field.low;
      end = field.high;
    } else if (base.includes("-")) {
      const [a, b] = base.split("-");
      start = parseNumber(a, field);
      end = parseNumber(b, field);
    } else {
      start = parseNumber(base, field);
      if (stepText !== undefined) {
        throw new CronError(`${field.label}: a step needs a range or *, e.g. "*/${stepText}" or "${base}-${field.high}/${stepText}" (not "${piece}")`);
      }
      end = start;
    }
    let step = 1;
    if (stepText !== undefined) {
      if (stepText === "") throw new CronError(`${field.label}: missing step after "/" in "${piece}"`);
      step = parseNumber(stepText, field, true);
      if (step <= 0 || step > field.high) throw new CronError(`${field.label}: step ${step} is out of range 1-${field.high}`);
    }
    for (const v of [start, end]) {
      if (v < field.low || v > field.high) {
        throw new CronError(`${field.label}: ${v} is out of range ${field.low}-${field.high}`);
      }
    }
    if (start > end) throw new CronError(`${field.label}: range ${start}-${end} goes backwards (pg_cron would never match it)`);
    for (let v = start; v <= end; v += step) values.add(v);
    parts.push({ start, end, step, star, single: !star && start === end });
  }
  return { values, parts, star: text.startsWith("*"), text };
}

/**
 * Parse a pg_cron schedule. Returns either
 *   { kind: "interval", seconds }
 *   { kind: "cron", fields: {minute,hour,dom,month,dow}, domLast, domStar, dowStar, normalized, special? }
 * or throws an Error with a readable message.
 */
export function parseSchedule(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new CronError("Enter a schedule, e.g. */5 * * * * or 30 seconds");

  // pg_cron: sscanf(" %u secon%c%c %c"), 1..59, "second" or "seconds".
  const interval = /^(\d+)\s*(second|seconds)$/i.exec(raw);
  if (interval) {
    const seconds = Number(interval[1]);
    if (seconds < 1 || seconds > 59) throw new CronError("Interval schedules must be between 1 and 59 seconds");
    return { kind: "interval", seconds };
  }
  if (/^\d+\s*(sec|secs|s|minutes?|mins?|hours?)$/i.test(raw)) {
    throw new CronError('pg_cron only understands "N seconds" (1-59); use a cron expression for minutes or hours');
  }

  let text = raw;
  let special;
  if (raw.startsWith("@")) {
    const key = raw.toLowerCase();
    if (key === "@reboot" || key === "@restart") throw new CronError("@reboot is not supported by pg_cron");
    if (!SPECIALS[key]) throw new CronError(`Unknown shortcut ${raw}. Try @hourly, @daily, @weekly, @monthly or @yearly`);
    special = key;
    text = SPECIALS[key];
  }

  const pieces = text.split(/\s+/);
  if (pieces.length !== 5) {
    throw new CronError(
      `Expected 5 fields (minute hour day-of-month month day-of-week), got ${pieces.length}` +
        (pieces.length === 6 ? ". pg_cron has no seconds field; use \"N seconds\" for sub-minute schedules" : ""),
    );
  }

  const fields = {};
  let domLast = false;
  FIELDS.forEach((field, i) => {
    if (field.id === "dom" && pieces[i] === "$") {
      domLast = true;
      fields.dom = { values: new Set(), parts: [], star: false, text: "$" };
      return;
    }
    if (field.id === "dom" && pieces[i].includes("$")) throw new CronError('Day of month: "$" must be used on its own');
    fields[field.id] = parseField(pieces[i], field);
  });
  // Sunday is both 0 and 7.
  if (fields.dow.values.has(0) || fields.dow.values.has(7)) {
    fields.dow.values.add(0);
    fields.dow.values.add(7);
  }
  // @yearly / @monthly / @weekly set DOW_STAR in entry.c even though dow is "*" anyway.
  return {
    kind: "cron",
    fields,
    domLast,
    domStar: fields.dom.star,
    dowStar: fields.dow.star,
    minStar: fields.minute.star,
    hourStar: fields.hour.star,
    special,
    normalized: text,
  };
}

// ---------- time zone helpers ----------

const formatters = new Map();
function partsFormatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `ms` (epoch millis) in `timeZone`. */
export function zonedParts(ms, timeZone) {
  const p = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(new Date(ms))) p[type] = value;
  const parts = {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    dow: WEEKDAY_INDEX[p.weekday],
  };
  parts.offsetMin = Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(ms / 60000) * 60000) / 60000);
  return parts;
}

export function isValidTimeZone(tz) {
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Does the schedule run in the minute starting at `ms`? Mirrors pg_cron's ShouldRunTask. */
export function matchesMinute(schedule, ms, timeZone, { matchDomAndDow = false } = {}) {
  const p = zonedParts(ms, timeZone);
  return matchParts(schedule, p, ms, timeZone, matchDomAndDow);
}

function isLastDom(ms, timeZone) {
  return zonedParts(ms + 86400000, timeZone).day === 1;
}

function dayMatches(schedule, p, ms, timeZone, matchDomAndDow) {
  const { fields } = schedule;
  const thisDom = fields.dom.values.has(p.day) || (schedule.domLast && isLastDom(ms, timeZone));
  const thisDow = fields.dow.values.has(p.dow);
  return matchDomAndDow || schedule.domStar || schedule.dowStar ? thisDom && thisDow : thisDom || thisDow;
}

function matchParts(schedule, p, ms, timeZone, matchDomAndDow) {
  const { fields } = schedule;
  return (
    fields.minute.values.has(p.minute) &&
    fields.hour.values.has(p.hour) &&
    fields.month.values.has(p.month) &&
    dayMatches(schedule, p, ms, timeZone, matchDomAndDow)
  );
}

/**
 * Next `count` run times (epoch ms) strictly after `fromMs`, evaluated in
 * `timeZone` like pg_cron does: every real minute is converted to wall-clock
 * time and checked, so a local time skipped by a DST change never runs and a
 * repeated one runs twice. Searches up to `maxYears` ahead.
 */
export function nextRuns(schedule, fromMs, count = 10, { timeZone = "GMT", matchDomAndDow = false, maxYears = 8 } = {}) {
  if (schedule.kind === "interval") {
    const step = schedule.seconds * 1000;
    const first = Math.floor(fromMs / 1000) * 1000 + step;
    return Array.from({ length: count }, (_, i) => first + i * step);
  }
  const out = [];
  let t = Math.floor(fromMs / 60000) * 60000 + 60000;
  const limit = fromMs + maxYears * 366 * 86400000;
  const { fields } = schedule;
  // Jump to `minutes` ahead in wall-clock terms, correcting for an offset change on the way.
  const jump = (p, minutes) => {
    let next = t + minutes * 60000;
    const q = zonedParts(next, timeZone);
    const drift = q.offsetMin - p.offsetMin; // e.g. +60 when clocks went forward
    if (drift > 0) next -= drift * 60000;
    return next > t ? next : t + 60000;
  };
  while (out.length < count && t <= limit) {
    const p = zonedParts(t, timeZone);
    if (!fields.month.values.has(p.month) || !dayMatches(schedule, p, t, timeZone, matchDomAndDow)) {
      t = jump(p, 24 * 60 - (p.hour * 60 + p.minute)); // next local midnight
    } else if (!fields.hour.values.has(p.hour)) {
      t = jump(p, 60 - p.minute); // next local hour
    } else if (!fields.minute.values.has(p.minute)) {
      t += 60000;
    } else {
      out.push(t);
      t += 60000;
    }
  }
  return out;
}

// ---------- plain English ----------

const pad = (n) => String(n).padStart(2, "0");

function joinList(items, word = "and") {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const isAll = (f) => f.star && f.parts.length === 1 && f.parts[0].step === 1;
const allSingles = (f) => f.parts.every((p) => p.single);
const sorted = (set) => [...set].sort((a, b) => a - b);

/**
 * Describe one field's parts, e.g. "every 5 minutes", "0 and 30", "9 through 17".
 * Uneven steps get a preview of the values they produce ("every 2 days (1st, 3rd, 5th, ...)").
 */
function describeParts(field, fmt, unit, units) {
  return joinList(
    field.parts.map((p) => {
      if (p.single) return fmt(p.start);
      if (p.step === 1) return p.star ? `every ${unit}` : `${fmt(p.start)} through ${fmt(p.end)}`;
      let text = p.star ? `every ${p.step} ${units}` : `every ${p.step} ${units} from ${fmt(p.start)} through ${fmt(p.end)}`;
      if ((p.end - p.start + 1) % p.step !== 0 || !p.star) {
        const vals = [];
        for (let v = p.start; v <= p.end && vals.length < 4; v += p.step) vals.push(fmt(v));
        text += ` (${vals.slice(0, 3).join(", ")}${vals.length > 3 ? ", ..." : ""})`;
      }
      return text;
    }),
  );
}

const dowName = (d) => DOW_LABELS[d];
const monthName = (m) => MONTH_LABELS[m - 1];

function describeTime(s) {
  const { minute, hour } = s.fields;
  const mins = sorted(minute.values);
  const hours = sorted(hour.values);
  if (allSingles(minute) && allSingles(hour) && mins.length * hours.length <= 6) {
    return `At ${joinList(hours.flatMap((h) => mins.map((m) => `${pad(h)}:${pad(m)}`)))}`;
  }
  let text;
  if (isAll(minute)) text = "Every minute";
  else if (allSingles(minute)) text = `At minute ${joinList(mins.map(String))}`;
  else if (minute.parts.length === 1 && minute.parts[0].star) text = describeParts(minute, String, "minute", "minutes").replace(/^e/, "E");
  else text = `At minutes ${describeParts(minute, String, "minute", "minutes")}`;

  if (isAll(hour)) {
    if (!text.startsWith("Every ")) text += " past every hour";
  } else if (hour.parts.length === 1 && !hour.parts[0].single && hour.parts[0].step === 1) {
    text += text.startsWith("At ")
      ? ` past every hour from ${pad(hour.parts[0].start)}:00 through ${pad(hour.parts[0].end)}:00`
      : `, between ${pad(hour.parts[0].start)}:00 and ${pad(hour.parts[0].end)}:59`;
  } else if (allSingles(hour)) {
    text += ` past ${hours.length === 1 ? "hour" : "hours"} ${joinList(hours.map(pad))}`;
  } else {
    text += `, ${describeParts(hour, pad, "hour", "hours")}`;
  }
  return text;
}

function describeDays(s, matchDomAndDow) {
  const { dom, dow } = s.fields;
  let domText;
  if (s.domLast) domText = "on the last day of the month";
  else if (allSingles(dom)) domText = `on the ${joinList(sorted(dom.values).map(ordinal))} of the month`;
  else domText = `on ${describeParts(dom, ordinal, "day", "days")} of the month`;
  const dowText = `on ${describeParts(dow, dowName, "day", "days")}`;

  const domAll = !s.domLast && isAll(dom);
  const dowAll = isAll(dow);
  if (domAll && dowAll) return { text: "", logic: null };
  if (dowAll) return { text: domText, logic: null };
  if (domAll) return { text: dowText, logic: null };
  const and = matchDomAndDow || s.domStar || s.dowStar;
  return { text: `${domText} ${and ? "and" : "or"} ${dowText}`, logic: and ? "and" : "or" };
}

function describeMonths(s) {
  const { month } = s.fields;
  if (isAll(month)) return "";
  if (allSingles(month)) return `in ${joinList(sorted(month.values).map(monthName))}`;
  return `in ${describeParts(month, monthName, "month", "months")}`;
}

/** Plain-English summary plus notes about pg_cron-specific behaviour. */
export function explain(schedule, { matchDomAndDow = false } = {}) {
  if (schedule.kind === "interval") {
    return {
      text: `Every ${schedule.seconds} second${schedule.seconds === 1 ? "" : "s"}`,
      notes: [
        "Interval jobs are not tied to the clock: a run is due this many seconds after the previous run started. If the previous run is still going, the next one waits for it.",
      ],
    };
  }
  const notes = [];
  const days = describeDays(schedule, matchDomAndDow);
  const text = [describeTime(schedule), days.text, describeMonths(schedule)].filter(Boolean).join(" ");
  if (days.logic === "or") {
    notes.push(
      "Both day-of-month and day-of-week are restricted, so (as in classic cron) the job runs on days that match EITHER field. Turn on cron.match_dom_and_dow to require both.",
    );
  } else if (days.logic === "and" && !matchDomAndDow) {
    const f = schedule.domStar ? ["day-of-month", schedule.fields.dom.text] : ["day-of-week", schedule.fields.dow.text];
    notes.push(`Because ${f[0]} "${f[1]}" starts with "*", cron requires BOTH day fields to match rather than either.`);
  }
  if (schedule.fields.dow.text.split(",").some((p) => /(^|-)7($|\/|-)/.test(p))) notes.push("Day-of-week 7 means Sunday, the same as 0.");
  if (schedule.domLast) notes.push('"$" matches the last day of each month (28th to 31st), judged in cron.timezone.');
  const domMax = Math.max(0, ...schedule.fields.dom.values);
  if (!schedule.domLast && domMax >= 29 && allSingles(schedule.fields.dom) && Math.min(...schedule.fields.dom.values) >= 29 && days.logic !== "or") {
    notes.push(`Months without a ${ordinal(domMax)} day are skipped${domMax === 29 ? " (February has one only in leap years)" : ""}.`);
  }
  if (schedule.special) notes.push(`${schedule.special} is shorthand for "${schedule.normalized}".`);
  return { text, notes };
}

// ---------- SQL ----------

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Pick a dollar-quote tag that does not appear in the body. */
export function dollarQuote(body) {
  let tag = "$$";
  for (let i = 0; body.includes(tag); i += 1) tag = `$${i === 0 ? "cmd" : `cmd${i}`}$`;
  return `${tag}${body}${tag}`;
}

export function scheduleSql({ name, schedule, command, database }) {
  const args = [];
  if (name || database) args.push(sqlString(name || "job"));
  args.push(sqlString(schedule.trim()), dollarQuote(command.trim()));
  if (database) {
    args.push(sqlString(database));
    return `SELECT cron.schedule_in_database(${args.join(", ")});`;
  }
  return `SELECT cron.schedule(${args.join(", ")});`;
}

export function unscheduleSql({ name }) {
  return name ? `SELECT cron.unschedule(${sqlString(name)});` : "SELECT cron.unschedule(<jobid>);";
}

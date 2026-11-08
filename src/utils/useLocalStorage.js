import { useEffect, useRef, useState } from "react";

const PREFIX = "ashwaniydv:utils:";

const hasStorage = () => {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false; // e.g. storage disabled in the browser
  }
};

/** `initial` may be a value or a function returning one (like useState). */
function read(storageKey, initial) {
  const fallback = () => (typeof initial === "function" ? initial() : initial);
  if (!hasStorage()) return fallback();
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? fallback() : JSON.parse(raw);
  } catch {
    return fallback(); // corrupt JSON: start fresh rather than crash the tool
  }
}

/**
 * useState that persists to localStorage (JSON) under a namespaced key.
 *
 * - Reads synchronously on first render, so tools open with their data.
 * - Writes are debounced and flushed on unmount / tab hide, so typing stays fast.
 * - Stays in sync across tabs via the `storage` event.
 * - `status` is "saved" or "error" (e.g. storage full or disabled) for UI hints.
 */
export function useLocalStorage(key, initialValue, { debounceMs = 300 } = {}) {
  const storageKey = PREFIX + key;
  const [value, setValue] = useState(() => read(storageKey, initialValue));
  const [status, setStatus] = useState(hasStorage() ? "saved" : "error");

  const latest = useRef(value);
  const dirty = useRef(false);
  const fromOtherTab = useRef(false);

  const flush = useRef(() => {});
  flush.current = () => {
    if (!dirty.current || !hasStorage()) return;
    dirty.current = false;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(latest.current));
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  // Debounced save whenever the value changes locally.
  useEffect(() => {
    latest.current = value;
    if (fromOtherTab.current) {
      fromOtherTab.current = false;
      return undefined;
    }
    dirty.current = true;
    const timer = window.setTimeout(() => flush.current(), debounceMs);
    return () => window.clearTimeout(timer);
  }, [value, debounceMs]);

  // Flush pending writes when leaving the page or the tool.
  useEffect(() => {
    const onHide = () => flush.current();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flush.current();
    };
  }, []);

  // Pick up edits made in another tab.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== storageKey || e.newValue === null) return;
      try {
        fromOtherTab.current = true;
        setValue(JSON.parse(e.newValue));
      } catch {
        fromOtherTab.current = false;
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  return [value, setValue, status];
}

/** Trigger a browser download for a Blob or string. */
export function download(filename, content, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Short unique id for list items. */
export const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

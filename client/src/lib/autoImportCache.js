const STORAGE_KEY = 'hrd:auto-import:state';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

const toSignature = ({ scope = 'today-tomorrow', trackCode = 'OP', dates = [] }) => {
  const normalizedDates = Array.isArray(dates)
    ? dates.map((value) => String(value).trim()).filter(Boolean).sort()
    : [];
  return `${scope}|${String(trackCode || 'OP').toUpperCase()}|${normalizedDates.join(',')}`;
};

const readState = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeState = (state) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
};

export const shouldRunAutoImport = ({ scope, trackCode, dates, ttlMs = DEFAULT_TTL_MS }) => {
  const now = Date.now();
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS;
  const signature = toSignature({ scope, trackCode, dates });
  const state = readState();
  const previous = state[signature];
  if (!previous || !Number.isFinite(Number(previous.lastRunAt))) {
    return { run: true, signature, reason: 'first-run', ageMs: null, remainingMs: null };
  }

  const ageMs = now - Number(previous.lastRunAt);
  if (ageMs >= ttl) {
    return { run: true, signature, reason: 'ttl-expired', ageMs, remainingMs: 0 };
  }

  return {
    run: false,
    signature,
    reason: 'cached',
    ageMs,
    remainingMs: ttl - ageMs
  };
};

export const markAutoImportRan = ({ signature }) => {
  if (!signature) {
    return;
  }
  const state = readState();
  state[signature] = { lastRunAt: Date.now() };
  writeState(state);
};

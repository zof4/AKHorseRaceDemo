import db, { jsonParseSafe } from '../db/connection.js';
import { payoutPerDollar } from './parimutuel.js';

const DEFAULT_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

const AUTO_RESULTS_CACHE_TTL_MS = Math.max(30_000, Number(process.env.EQUIBASE_RESULTS_CACHE_MS ?? 90_000));
const autoResultsCache = new Map();

const roundCurrency = (value) => Number((Number(value || 0) + Number.EPSILON).toFixed(2));
const pad = (value) => String(value).padStart(2, '0');

const getRaceStmt = db.prepare(
  `SELECT
      id,
      name,
      track,
      race_number,
      post_time,
      status,
      takeout_pct,
      external_id,
      race_config_json
   FROM races
   WHERE id = ?`
);

const listRaceHorsesStmt = db.prepare(
  `SELECT id, name, post_position, scratched
   FROM horses
   WHERE race_id = ?
   ORDER BY COALESCE(post_position, 999), id ASC`
);

const listRaceResultsStmt = db.prepare(
  `SELECT race_id, horse_id, finish_position
   FROM results
   WHERE race_id = ?
   ORDER BY finish_position ASC`
);

const deleteRaceResultsStmt = db.prepare('DELETE FROM results WHERE race_id = ?');

const insertRaceResultStmt = db.prepare(
  `INSERT INTO results (race_id, horse_id, finish_position)
   VALUES (?, ?, ?)`
);

const markRaceOfficialStmt = db.prepare(
  `UPDATE races
   SET status = 'official'
   WHERE id = ?`
);

const listRaceBetsStmt = db.prepare(
  `SELECT
      id,
      user_id,
      bet_type,
      selections,
      expanded_combinations,
      base_amount,
      is_winner
   FROM bets
   WHERE race_id = ?
   ORDER BY id ASC`
);

const listRacePoolTotalsStmt = db.prepare(
  `SELECT bet_type, total_amount
   FROM pools
   WHERE race_id = ?`
);

const settleBetStmt = db.prepare(
  `UPDATE bets
   SET payout = ?, is_winner = ?
   WHERE id = ?`
);

const creditUserStmt = db.prepare(
  `UPDATE users
   SET balance = balance + ?
   WHERE id = ?`
);

const countSettledBetsStmt = db.prepare(
  `SELECT COUNT(1) AS count
   FROM bets
   WHERE race_id = ? AND is_winner IS NOT NULL`
);

const normalizeHorseName = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const normalizeProgramToken = (value) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();

const parseProgramNumber = (value) => {
  const match = normalizeProgramToken(value).match(/^(\d{1,2})[A-Z]?$/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const formatCombinationKey = (betType, combination) => {
  const ids = Array.isArray(combination)
    ? combination.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0)
    : [];

  if (!ids.length) {
    return null;
  }

  if (betType === 'quinella') {
    ids.sort((left, right) => left - right);
  }

  return ids.join('-');
};

const extractTicketCombinationKeys = (bet) => {
  const betType = String(bet?.bet_type ?? '').trim();
  const combos = jsonParseSafe(bet?.expanded_combinations, []);

  if (Array.isArray(combos) && combos.length) {
    const keys = combos
      .map((combo) => formatCombinationKey(betType, combo))
      .filter(Boolean);
    return [...new Set(keys)];
  }

  const selections = jsonParseSafe(bet?.selections, {});
  const fallbackHorses = Array.isArray(selections?.horses) ? selections.horses : [];
  const fallbackKey = formatCombinationKey(betType, fallbackHorses);
  return fallbackKey ? [fallbackKey] : [];
};

const buildWinningKeysByType = (finishOrder) => {
  const first = finishOrder[0] ?? null;
  const second = finishOrder[1] ?? null;
  const third = finishOrder[2] ?? null;
  const fourth = finishOrder[3] ?? null;
  const fifth = finishOrder[4] ?? null;

  const map = new Map();

  if (first && second) {
    map.set('exacta', new Set([`${first}-${second}`]));
    map.set('quinella', new Set([[first, second].sort((a, b) => a - b).join('-')]));
  }

  if (first && second && third) {
    map.set('trifecta', new Set([`${first}-${second}-${third}`]));
  }

  if (first && second && third && fourth) {
    map.set('superfecta', new Set([`${first}-${second}-${third}-${fourth}`]));
  }

  if (first && second && third && fourth && fifth) {
    map.set('super_hi_5', new Set([`${first}-${second}-${third}-${fourth}-${fifth}`]));
  }

  if (first) {
    map.set('win', new Set([String(first)]));
  }

  if (first && second) {
    map.set('place', new Set([String(first), String(second)]));
  }

  if (first && second && third) {
    map.set('show', new Set([String(first), String(second), String(third)]));
  }

  return map;
};

const resolveFinishOrder = (finishOrderInput, horses) => {
  const warnings = [];
  const horseIds = horses.map((horse) => Number(horse.id)).filter((id) => Number.isInteger(id) && id > 0);
  const horseIdSet = new Set(horseIds);
  const horseNameToId = new Map();
  const horseNameEntries = [];
  const postPositionToId = new Map();

  for (const horse of horses) {
    const key = normalizeHorseName(horse.name);
    if (key && !horseNameToId.has(key)) {
      horseNameToId.set(key, Number(horse.id));
    }
    if (key) {
      horseNameEntries.push({
        key,
        horseId: Number(horse.id)
      });
    }

    const postPosition = Number(horse.post_position);
    if (Number.isInteger(postPosition) && postPosition > 0 && !postPositionToId.has(postPosition)) {
      postPositionToId.set(postPosition, Number(horse.id));
    }
  }

  const normalized = [];

  for (const rawEntry of Array.isArray(finishOrderInput) ? finishOrderInput : []) {
    let horseId = null;

    if (Number.isInteger(Number(rawEntry)) && horseIdSet.has(Number(rawEntry))) {
      horseId = Number(rawEntry);
    } else if (typeof rawEntry === 'string') {
      const normalizedName = normalizeHorseName(rawEntry);
      horseId = horseNameToId.get(normalizedName) ?? null;
      if (!horseId && normalizedName) {
        const fuzzyMatches = horseNameEntries.filter(
          (entry) => normalizedName.includes(entry.key) || entry.key.includes(normalizedName)
        );
        if (fuzzyMatches.length === 1) {
          horseId = fuzzyMatches[0].horseId;
        }
      }
    } else if (rawEntry && typeof rawEntry === 'object') {
      const idFromPayload = Number(rawEntry.horse_id ?? rawEntry.horseId ?? rawEntry.id);
      if (Number.isInteger(idFromPayload) && horseIdSet.has(idFromPayload)) {
        horseId = idFromPayload;
      } else {
        const programNumber =
          parseProgramNumber(
            rawEntry.post_position ??
              rawEntry.postPosition ??
              rawEntry.programNumber ??
              rawEntry.program ??
              rawEntry.number
          ) ?? null;
        if (programNumber && postPositionToId.has(programNumber)) {
          horseId = postPositionToId.get(programNumber) ?? null;
        }

        const name = String(rawEntry.horse_name ?? rawEntry.horseName ?? rawEntry.name ?? '').trim();
        if (!horseId && name) {
          const normalizedName = normalizeHorseName(name);
          horseId = horseNameToId.get(normalizedName) ?? null;
          if (!horseId && normalizedName) {
            const fuzzyMatches = horseNameEntries.filter(
              (entry) => normalizedName.includes(entry.key) || entry.key.includes(normalizedName)
            );
            if (fuzzyMatches.length === 1) {
              horseId = fuzzyMatches[0].horseId;
            }
          }
        }
      }
    }

    if (!horseId) {
      warnings.push(`Could not map result entry to race horse: ${String(rawEntry ?? '').slice(0, 80)}`);
      continue;
    }

    if (normalized.includes(horseId)) {
      continue;
    }

    normalized.push(horseId);
  }

  return { finishOrder: normalized, warnings };
};

const extractDateFromRace = (race) => {
  const raceConfig = jsonParseSafe(race?.race_config_json, null);
  if (
    raceConfig &&
    Number.isInteger(Number(raceConfig.year)) &&
    Number.isInteger(Number(raceConfig.month)) &&
    Number.isInteger(Number(raceConfig.day))
  ) {
    return {
      year: Number(raceConfig.year),
      month: Number(raceConfig.month),
      day: Number(raceConfig.day),
      raceConfig
    };
  }

  const fromExternal = String(race?.external_id ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (fromExternal) {
    return {
      year: Number(fromExternal[1]),
      month: Number(fromExternal[2]),
      day: Number(fromExternal[3]),
      raceConfig
    };
  }

  const postTime = new Date(race?.post_time ?? '');
  if (!Number.isNaN(postTime.getTime())) {
    return {
      year: postTime.getFullYear(),
      month: postTime.getMonth() + 1,
      day: postTime.getDate(),
      raceConfig
    };
  }

  return null;
};

const inferTrackCode = (race, raceConfig) => {
  const configured = String(raceConfig?.trackCode ?? '').trim().toUpperCase();
  if (configured) {
    return configured;
  }

  const track = String(race?.track ?? '').toLowerCase();
  if (track.includes('oaklawn')) {
    return 'OP';
  }

  return '';
};

const decodeHtmlEntities = (text) =>
  String(text ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const stripHtml = (html) =>
  decodeHtmlEntities(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|tr|td|li|h1|h2|h3|h4|h5|h6)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u00a0/g, ' ')
  );

const asLines = (html) =>
  stripHtml(html)
    .split(/\n+/)
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const getRaceSectionLines = (html, raceNumber) => {
  const lines = asLines(html);
  const startIndex = lines.findIndex((line) => new RegExp(`\\bRace\\s*${raceNumber}\\b`, 'i').test(line));
  if (startIndex < 0) {
    return [];
  }

  const section = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > startIndex && /\bRace\s*\d+\b/i.test(line)) {
      break;
    }
    section.push(line);
  }

  return section;
};

const isResultsLabelLine = (line) => /^Results(?:\s+Win\s+Place\s+Show)?$/i.test(String(line ?? '').trim());

const looksLikePayoutLine = (line) =>
  /\b(?:Win|Place|Show)\s+\$/i.test(String(line ?? '').trim()) ||
  /\$\d+(?:\.\d{2})?(?:\s+\$\d+(?:\.\d{2})?)+/.test(String(line ?? '').trim());

const parseFinishersFromResultsBlocks = (html, raceNumber) => {
  const section = getRaceSectionLines(html, raceNumber);
  const finishers = [];

  for (let index = 0; index < section.length; index += 1) {
    if (!isResultsLabelLine(section[index])) {
      continue;
    }

    const programToken = normalizeProgramToken(section[index + 1] ?? '');
    const programNumber = parseProgramNumber(programToken);
    if (!programNumber) {
      continue;
    }

    const horseNameLine = String(section[index + 2] ?? '').trim();
    if (
      !horseNameLine ||
      isResultsLabelLine(horseNameLine) ||
      /^Wager Type\b/i.test(horseNameLine) ||
      /^Winning Connections\b/i.test(horseNameLine)
    ) {
      continue;
    }

    finishers.push({
      post_position: programNumber,
      horse_name: sanitizeHorseCandidate(horseNameLine)
    });

    if (looksLikePayoutLine(section[index + 3] ?? '')) {
      index += 3;
    }
  }

  return finishers;
};

const parseFinishersFromWagerWinners = (html, raceNumber) => {
  const section = getRaceSectionLines(html, raceNumber);
  const sequences = new Map();

  for (const line of section) {
    const match = String(line ?? '').match(
      /^Wager Type\s+(Super Hi-5|Super High Five|Superfecta|Trifecta|Exacta|Quinella|Win)(?:\s+[\d.$]+)?\s+Winners\s+([A-Z0-9/\- ]+)/i
    );
    if (!match) {
      continue;
    }

    const wagerType = String(match[1]).toLowerCase();
    const tokens = String(match[2])
      .split('-')
      .map((entry) => parseProgramNumber(entry))
      .filter((entry) => Number.isInteger(entry) && entry > 0);

    if (tokens.length) {
      sequences.set(wagerType, tokens);
    }
  }

  const prioritizedSequences = [
    sequences.get('super hi-5'),
    sequences.get('super high five'),
    sequences.get('superfecta'),
    sequences.get('trifecta'),
    sequences.get('exacta'),
    sequences.get('quinella'),
    sequences.get('win')
  ].filter((entry) => Array.isArray(entry) && entry.length);

  const finishOrder = prioritizedSequences[0] ?? [];
  return finishOrder.map((postPosition) => ({
    post_position: postPosition
  }));
};

const sanitizeHorseCandidate = (value) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:\d+|\d+(?:st|nd|rd|th))\s+/, '')
    .replace(/\s+\([^)]*\)\s*$/, '')
    .replace(/\s+\d+[:.]\d+(?:\.\d+)?\s*$/, '')
    .replace(/\s+[0-9]+\/[0-9]+\s*$/, '')
    .trim();
  return text;
};

const parseFinishersFromLines = (html, raceNumber) => {
  const section = getRaceSectionLines(html, raceNumber);
  if (!section.length) {
    return [];
  }

  const finishers = new Map();
  for (const line of section) {
    const ranked = line.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s.)-]+([A-Za-z0-9' .,-]{2,})$/i);
    if (ranked) {
      const position = Number(ranked[1]);
      const name = sanitizeHorseCandidate(ranked[2]);
      if (position > 0 && name) {
        finishers.set(position, name);
      }
      continue;
    }

    const compact = line.match(/^([A-Za-z0-9' .,-]{2,})\s+-\s+(\d{1,2})(?:st|nd|rd|th)$/i);
    if (compact) {
      const name = sanitizeHorseCandidate(compact[1]);
      const position = Number(compact[2]);
      if (position > 0 && name) {
        finishers.set(position, name);
      }
    }
  }

  return [...finishers.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1]);
};

const parseFinishersFromTableRows = (html, raceNumber) => {
  const raceSectionPattern = new RegExp(`Race\\s*${raceNumber}[\\s\\S]*?(?=Race\\s*\\d+|$)`, 'i');
  const section = String(html ?? '').match(raceSectionPattern)?.[0] ?? '';
  if (!section) {
    return [];
  }

  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const finishers = new Map();

  for (const rowMatch of section.matchAll(rowPattern)) {
    const rowHtml = rowMatch[1] ?? '';
    const columns = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((entry) => sanitizeHorseCandidate(stripHtml(entry[1])));
    if (columns.length < 2) {
      continue;
    }

    const position = Number(String(columns[0]).replace(/[^0-9]/g, ''));
    const horseName = sanitizeHorseCandidate(columns[1]);

    if (!Number.isInteger(position) || position <= 0 || !horseName) {
      continue;
    }

    finishers.set(position, horseName);
  }

  return [...finishers.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1]);
};

const fetchRaceResultsPage = async ({ provider, cacheKey, urls, parseFinishers }) => {
  const now = Date.now();
  const cached = autoResultsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      ...cached.payload,
      diagnostics: {
        ...(cached.payload.diagnostics ?? {}),
        cache: {
          hit: true,
          cachedAt: new Date(cached.cachedAt).toISOString(),
          expiresAt: new Date(cached.expiresAt).toISOString()
        }
      }
    };
  }

  const diagnostics = {
    requests: []
  };

  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: DEFAULT_HEADERS });
      diagnostics.requests.push({ url, status: response.status, ok: response.ok });
      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      const finishers = parseFinishers(html);

      const payload = {
        provider,
        fetchedAt: new Date().toISOString(),
        found: finishers.length > 0,
        finishers,
        url,
        diagnostics
      };

      autoResultsCache.set(cacheKey, {
        cachedAt: now,
        expiresAt: now + AUTO_RESULTS_CACHE_TTL_MS,
        payload
      });

      return payload;
    } catch (error) {
      diagnostics.requests.push({
        url,
        status: null,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown request error'
      });
    }
  }

  const payload = {
    provider,
    fetchedAt: new Date().toISOString(),
    found: false,
    finishers: [],
    diagnostics
  };

  autoResultsCache.set(cacheKey, {
    cachedAt: now,
    expiresAt: now + AUTO_RESULTS_CACHE_TTL_MS,
    payload
  });

  return payload;
};

const fetchOfficialFinishersFromEquibase = async (race) => {
  const date = extractDateFromRace(race);
  if (!date) {
    return {
      provider: 'Equibase',
      fetchedAt: new Date().toISOString(),
      found: false,
      finishers: [],
      diagnostics: {
        message: 'Race date unavailable for results lookup.'
      }
    };
  }

  const trackCode = inferTrackCode(race, date.raceConfig);
  const raceNumber = Number(race?.race_number ?? date.raceConfig?.raceNumber ?? 0);

  if (!trackCode || !Number.isInteger(raceNumber) || raceNumber <= 0) {
    return {
      provider: 'Equibase',
      fetchedAt: new Date().toISOString(),
      found: false,
      finishers: [],
      diagnostics: {
        message: 'Race config is missing track code or race number.'
      }
    };
  }

  const cacheKey = `equibase:${trackCode}-${date.year}-${pad(date.month)}-${pad(date.day)}-r${raceNumber}`;
  const urls = [
    `https://mobile.equibase.com/html/results${trackCode}${date.year}${pad(date.month)}${pad(date.day)}USA.html`,
    `https://mobile.equibase.com/html/results${trackCode}${date.year}${pad(date.month)}${pad(date.day)}.html`
  ];

  return fetchRaceResultsPage({
    provider: 'Equibase',
    cacheKey,
    urls,
    parseFinishers: (html) => {
      const fromResultBlocks = parseFinishersFromResultsBlocks(html, raceNumber);
      if (fromResultBlocks.length) {
        return fromResultBlocks;
      }

      const fromWagers = parseFinishersFromWagerWinners(html, raceNumber);
      if (fromWagers.length) {
        return fromWagers;
      }

      const fromRows = parseFinishersFromTableRows(html, raceNumber);
      const fromLines = parseFinishersFromLines(html, raceNumber);
      return fromRows.length >= fromLines.length ? fromRows : fromLines;
    }
  });
};

const fetchOfficialFinishersFromOaklawn = async (race) => {
  const date = extractDateFromRace(race);
  if (!date) {
    return {
      provider: 'Oaklawn',
      fetchedAt: new Date().toISOString(),
      found: false,
      finishers: [],
      diagnostics: {
        message: 'Race date unavailable for results lookup.'
      }
    };
  }

  const raceNumber = Number(race?.race_number ?? date.raceConfig?.raceNumber ?? 0);
  if (!Number.isInteger(raceNumber) || raceNumber <= 0) {
    return {
      provider: 'Oaklawn',
      fetchedAt: new Date().toISOString(),
      found: false,
      finishers: [],
      diagnostics: {
        message: 'Race config is missing race number.'
      }
    };
  }

  const dateKey = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
  const url = `https://oaklawn.com/equibase/results/${dateKey}`;

  return fetchRaceResultsPage({
    provider: 'Oaklawn',
    cacheKey: `oaklawn:${dateKey}-r${raceNumber}`,
    urls: [url],
    parseFinishers: (html) => {
      const fromResultBlocks = parseFinishersFromResultsBlocks(html, raceNumber);
      if (fromResultBlocks.length) {
        return fromResultBlocks;
      }

      return parseFinishersFromWagerWinners(html, raceNumber);
    }
  });
};

const fetchOfficialFinishers = async (race) => {
  const track = String(race?.track ?? '').toLowerCase();
  const providers = track.includes('oaklawn')
    ? [fetchOfficialFinishersFromOaklawn, fetchOfficialFinishersFromEquibase]
    : [fetchOfficialFinishersFromEquibase];

  const attempts = [];

  for (const fetchProvider of providers) {
    const result = await fetchProvider(race);
    attempts.push({
      provider: result.provider,
      found: Boolean(result.found),
      fetchedAt: result.fetchedAt,
      sourceUrl: result.url ?? null,
      diagnostics: result.diagnostics ?? null
    });

    if (result.found && Array.isArray(result.finishers) && result.finishers.length) {
      return {
        ...result,
        diagnostics: {
          ...(result.diagnostics ?? {}),
          attempts
        }
      };
    }
  }

  const lastAttempt = attempts[attempts.length - 1] ?? null;
  return {
    provider: lastAttempt?.provider ?? null,
    fetchedAt: new Date().toISOString(),
    found: false,
    finishers: [],
    diagnostics: {
      attempts
    }
  };
};

const settleRaceResultsTx = db.transaction(({ raceId, finishOrder, markOfficial }) => {
  const race = getRaceStmt.get(raceId);
  if (!race) {
    throw new Error('Race not found.');
  }

  const settledCountRow = countSettledBetsStmt.get(raceId);
  const alreadySettledCount = Number(settledCountRow?.count ?? 0);
  if (alreadySettledCount > 0) {
    throw new Error('Race is already settled. Re-settlement is blocked to prevent duplicate credits.');
  }

  const horses = listRaceHorsesStmt.all(raceId);
  const resolved = resolveFinishOrder(finishOrder, horses);

  if (resolved.finishOrder.length < 1) {
    throw new Error('No valid finish order entries were provided.');
  }

  deleteRaceResultsStmt.run(raceId);
  resolved.finishOrder.forEach((horseId, index) => {
    insertRaceResultStmt.run(raceId, horseId, index + 1);
  });

  const winningKeysByType = buildWinningKeysByType(resolved.finishOrder);
  const bets = listRaceBetsStmt.all(raceId);
  const poolByType = new Map(
    listRacePoolTotalsStmt.all(raceId).map((row) => [String(row.bet_type), Number(row.total_amount || 0)])
  );

  const betKeys = bets.map((bet) => ({
    bet,
    keys: extractTicketCombinationKeys(bet)
  }));

  const winningAmountByTypeByKey = new Map();
  for (const { bet, keys } of betKeys) {
    const winningKeys = winningKeysByType.get(String(bet.bet_type));
    if (!winningKeys || !winningKeys.size) {
      continue;
    }

    const baseAmount = Number(bet.base_amount || 0);
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
      continue;
    }

    for (const key of keys) {
      if (!winningKeys.has(key)) {
        continue;
      }
      const typeKey = String(bet.bet_type);
      if (!winningAmountByTypeByKey.has(typeKey)) {
        winningAmountByTypeByKey.set(typeKey, new Map());
      }
      const byKey = winningAmountByTypeByKey.get(typeKey);
      byKey.set(key, roundCurrency((byKey.get(key) ?? 0) + baseAmount));
    }
  }

  const settled = [];
  let settledCount = 0;

  for (const { bet, keys } of betKeys) {
    if (typeof bet.is_winner === 'number') {
      continue;
    }

    const typeKey = String(bet.bet_type);
    const winningKeys = winningKeysByType.get(typeKey);
    const matched = winningKeys ? keys.filter((key) => winningKeys.has(key)) : [];

    if (!matched.length) {
      settleBetStmt.run(0, 0, bet.id);
      settled.push({ betId: bet.id, userId: bet.user_id, isWinner: false, payout: 0 });
      settledCount += 1;
      continue;
    }

    const poolTotal = Number(poolByType.get(typeKey) ?? 0);
    const takeoutPct = Number(race.takeout_pct ?? 0.22);
    const baseAmount = Number(bet.base_amount || 0);
    const winningAmountsByKey = winningAmountByTypeByKey.get(typeKey) ?? new Map();

    let payout = 0;
    for (const key of matched) {
      const winningAmount = Number(winningAmountsByKey.get(key) ?? 0);
      const perDollar = payoutPerDollar({
        grossPool: poolTotal,
        takeoutPct,
        winningAmount
      });
      payout += Number.isFinite(perDollar) ? perDollar * baseAmount : 0;
    }

    const normalizedPayout = roundCurrency(payout);
    settleBetStmt.run(normalizedPayout, 1, bet.id);
    if (normalizedPayout > 0) {
      creditUserStmt.run(normalizedPayout, bet.user_id);
    }

    settled.push({
      betId: bet.id,
      userId: bet.user_id,
      isWinner: true,
      payout: normalizedPayout
    });
    settledCount += 1;
  }

  if (markOfficial) {
    markRaceOfficialStmt.run(raceId);
  }

  const results = listRaceResultsStmt.all(raceId);

  return {
    raceId,
    finishOrder: resolved.finishOrder,
    warnings: resolved.warnings,
    settledCount,
    settled,
    results
  };
});

export const setOfficialResultsAndSettle = ({ raceId, finishOrder, markOfficial = true }) =>
  settleRaceResultsTx({ raceId, finishOrder, markOfficial });

export const tryAutoFetchAndSettleRace = async ({ raceId }) => {
  const race = getRaceStmt.get(raceId);
  if (!race) {
    throw new Error('Race not found.');
  }

  const settledCountRow = countSettledBetsStmt.get(raceId);
  const alreadySettledCount = Number(settledCountRow?.count ?? 0);
  if (alreadySettledCount > 0) {
    return {
      settled: false,
      alreadyOfficial: true,
      provider: null,
      message: 'Race is already settled.'
    };
  }

  const existingResults = listRaceResultsStmt.all(raceId);
  if (existingResults.length) {
    return {
      settled: false,
      alreadyOfficial: true,
      provider: null,
      message: 'Race already has stored official results.'
    };
  }

  const fetched = await fetchOfficialFinishers(race);
  if (!fetched.found || !Array.isArray(fetched.finishers) || !fetched.finishers.length) {
    const providerLabel =
      Array.isArray(fetched.diagnostics?.attempts) && fetched.diagnostics.attempts.length
        ? fetched.diagnostics.attempts.map((attempt) => attempt.provider).filter(Boolean).join(' / ')
        : fetched.provider;

    return {
      settled: false,
      provider: fetched.provider,
      fetchedAt: fetched.fetchedAt,
      diagnostics: fetched.diagnostics,
      message: providerLabel
        ? `Official finish order not available yet from ${providerLabel}.`
        : 'Official finish order not available yet.'
    };
  }

  const settled = setOfficialResultsAndSettle({
    raceId,
    finishOrder: fetched.finishers,
    markOfficial: true
  });

  return {
    settled: true,
    provider: fetched.provider,
    fetchedAt: fetched.fetchedAt,
    sourceUrl: fetched.url,
    diagnostics: fetched.diagnostics,
    settlement: settled
  };
};

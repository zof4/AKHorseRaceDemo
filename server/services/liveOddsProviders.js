const DEFAULT_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

const collapseWhitespace = (text) => text.replace(/\s+/g, ' ').trim();

const decodeHtmlEntities = (text) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const stripHtml = (html) =>
  collapseWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  );

const summarizeHtmlPreview = async (response) => {
  try {
    const raw = await response.text();
    return stripHtml(raw).slice(0, 220);
  } catch {
    return '';
  }
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeOdds = (odds) => odds.replace(/\s+/g, '');
const normalizeHorseName = (name) =>
  String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const parseRaceHintsFromUrl = (value) => {
  const url = String(value ?? '');
  if (!url) {
    return [];
  }

  const match = url.match(/race(?:s)?-([0-9-]+)/i);
  if (!match) {
    return [];
  }

  return [...new Set(match[1].split('-').map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0))];
};

const parseDateFromUpdatedLine = (line) => {
  const value = String(line ?? '').trim();
  if (!value) {
    return null;
  }
  return value;
};

const buildTrackNeedles = (trackName) => {
  const value = String(trackName ?? '').trim();
  if (!value) {
    return [];
  }

  const compact = value.replace(/\s+/g, ' ').trim();
  const withoutPark = compact.replace(/\bPark\b/gi, '').replace(/\s+/g, ' ').trim();
  const firstToken = compact.split(/\s+/)[0] ?? '';

  return [...new Set([compact, withoutPark, firstToken].filter(Boolean).map((entry) => entry.toLowerCase()))];
};

export const buildBettingNewsRaceUrl = (raceConfig) => {
  const { trackSlug, year, month, day, raceNumber } = raceConfig;
  return `https://horses.bettingnews.com/${trackSlug}/${year}/${month}/${day}/${raceNumber}`;
};

export const extractOddsFromText = (plainText, horseNames) => {
  const headerAnchor = 'Name Win % / Place % / Show % Predictions M/L Info Jockey Trainer Style';
  const startIndex = plainText.indexOf(headerAnchor);
  const windowText = startIndex >= 0 ? plainText.slice(startIndex) : plainText;
  const oddsByHorse = {};

  for (const horseName of horseNames) {
    const pattern = new RegExp(escapeRegExp(horseName), 'gi');
    const matches = [...windowText.matchAll(pattern)];
    let selectedOdds = null;

    for (const match of matches) {
      if (typeof match.index !== 'number') {
        continue;
      }
      const segment = windowText.slice(match.index, match.index + 500);
      const oddsMatch = segment.match(/(\d+\s*\/\s*\d+)\s+[A-Z]\b/);
      if (oddsMatch) {
        selectedOdds = normalizeOdds(oddsMatch[1]);
      }
    }

    if (selectedOdds) {
      oddsByHorse[horseName] = selectedOdds;
    }
  }

  return oddsByHorse;
};

export const fetchBettingNewsOdds = async (raceConfig, horseNames) => {
  const url = buildBettingNewsRaceUrl(raceConfig);
  const response = await fetch(url, { headers: DEFAULT_HEADERS });

  if (!response.ok) {
    const preview = await summarizeHtmlPreview(response);
    const detail = preview ? ` (${preview})` : '';
    throw new Error(`BettingNews request failed with status ${response.status}${detail}`);
  }

  const html = await response.text();
  const plainText = stripHtml(html);
  const oddsByHorse = extractOddsFromText(plainText, horseNames);

  return {
    provider: 'BettingNews',
    url,
    fetchedAt: new Date().toISOString(),
    oddsByHorse
  };
};

const stripHtmlToLines = (html) => {
  const text = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h1|h2|h3|h4|h5|h6|li|div|section|article|tr|td)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );

  return text
    .split(/\n+/)
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);
};

const extractBrisnetSpotPlay = (lines, trackName, raceNumber) => {
  const trackNeedles = buildTrackNeedles(trackName);
  const trackIndex =
    lines.findIndex((line) => trackNeedles.some((needle) => line.toLowerCase().includes(needle))) ?? -1;
  const startIndex = trackIndex >= 0 ? trackIndex : 0;

  for (let index = startIndex; index < Math.min(lines.length, startIndex + 120); index += 1) {
    const line = lines[index];
    const raceMatch = line.match(/^Race\s+(\d+)/i);
    if (!raceMatch || Number(raceMatch[1]) !== Number(raceNumber)) {
      continue;
    }

    for (let probe = index + 1; probe < Math.min(lines.length, index + 12); probe += 1) {
      const candidate = lines[probe];
      const candidateMatch =
        candidate.match(/^(.+?)\s+(\d+\s*(?:-|\/)\s*\d+)$/i) ||
        candidate.match(/^(.+?)\s+\((\d+\s*(?:-|\/)\s*\d+)\)$/i);
      if (candidateMatch) {
        return {
          raceNumber: Number(raceMatch[1]),
          horseName: candidateMatch[1].trim(),
          quotedOdds: candidateMatch[2].replace(/\s+/g, '')
        };
      }
    }
  }

  return null;
};

const extractBrisnetOptixSelections = (lines, raceNumber) => {
  const normalizedRace = Number(raceNumber);
  let activeRace = null;
  const selections = [];

  for (const line of lines) {
    const raceMatch = line.match(/RACE\s+(\d+)/i);
    if (raceMatch) {
      activeRace = Number(raceMatch[1]);
      continue;
    }

    if (activeRace !== normalizedRace) {
      continue;
    }

    const horseMatch = line.match(/#\d+\s+([A-Za-z][A-Za-z' -]+)/);
    if (horseMatch) {
      selections.push(collapseWhitespace(horseMatch[1].trim()));
    }
  }

  return [...new Set(selections)];
};

const computeBrisnetSignals = (horseNames, spotPlay, optixSelections) => {
  const signals = {};
  const normalizedSpot = spotPlay ? normalizeHorseName(spotPlay.horseName) : '';
  const normalizedOptix = new Set(optixSelections.map((name) => normalizeHorseName(name)));

  for (const horseName of horseNames) {
    const normalized = normalizeHorseName(horseName);
    let signal = 50;

    if (normalizedSpot && normalized === normalizedSpot) {
      signal += 40;
    }
    if (normalizedOptix.has(normalized)) {
      signal += 25;
    }

    signals[horseName] = Math.max(0, Math.min(100, signal));
  }

  return signals;
};

export const getBrisnetSignals = async (brisnetConfig, horseNames) => {
  const cleanHorseNames = [...new Set(horseNames.map((name) => String(name).trim()).filter(Boolean))];
  const result = {
    provider: 'BRISNET',
    fetchedAt: new Date().toISOString(),
    spotPlay: null,
    optixSelections: [],
    signals: Object.fromEntries(cleanHorseNames.map((name) => [name, 50])),
    sources: [],
    diagnostics: {
      requests: {
        spotPlays: null,
        optix: null
      },
      matching: {
        spotPlayMatchedFieldHorse: false,
        optixMatchedFieldCount: 0,
        unmatchedOptixSelections: [],
        optixUrlRaceHints: [],
        optixUrlLooksMismatched: false
      }
    }
  };

  if (!brisnetConfig || typeof brisnetConfig !== 'object') {
    return result;
  }

  const { spotPlaysUrl, optixUrl, trackName, raceNumber } = brisnetConfig;
  const normalizedRaceNumber = Number(raceNumber);
  const normalizedFieldHorseNames = new Set(cleanHorseNames.map((name) => normalizeHorseName(name)));
  const optixUrlRaceHints = parseRaceHintsFromUrl(optixUrl);

  if (spotPlaysUrl) {
    try {
      const spotResponse = await fetch(spotPlaysUrl, { headers: DEFAULT_HEADERS });
      result.diagnostics.requests.spotPlays = {
        url: spotPlaysUrl,
        status: spotResponse.status,
        ok: spotResponse.ok
      };

      if (spotResponse.ok) {
        const spotHtml = await spotResponse.text();
        const lines = stripHtmlToLines(spotHtml);
        result.spotPlay = extractBrisnetSpotPlay(
          lines,
          trackName ?? 'Oaklawn Park',
          normalizedRaceNumber
        );
        result.sources.push(spotPlaysUrl);
      } else {
        result.diagnostics.requests.spotPlays.preview = await summarizeHtmlPreview(spotResponse);
      }
    } catch (error) {
      result.diagnostics.requests.spotPlays = {
        url: spotPlaysUrl,
        status: null,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  if (optixUrl) {
    try {
      const optixResponse = await fetch(optixUrl, { headers: DEFAULT_HEADERS });
      result.diagnostics.requests.optix = {
        url: optixUrl,
        status: optixResponse.status,
        ok: optixResponse.ok
      };

      if (optixResponse.ok) {
        const optixHtml = await optixResponse.text();
        const lines = stripHtmlToLines(optixHtml);
        result.optixSelections = extractBrisnetOptixSelections(lines, normalizedRaceNumber);
        result.sources.push(optixUrl);
      } else {
        result.diagnostics.requests.optix.preview = await summarizeHtmlPreview(optixResponse);
      }
    } catch (error) {
      result.diagnostics.requests.optix = {
        url: optixUrl,
        status: null,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  result.signals = computeBrisnetSignals(cleanHorseNames, result.spotPlay, result.optixSelections);

  const normalizedSpotPlay = result.spotPlay ? normalizeHorseName(result.spotPlay.horseName) : '';
  const normalizedOptixSelections = result.optixSelections.map((name) => normalizeHorseName(name));
  const unmatchedOptixSelections = result.optixSelections.filter(
    (name) => !normalizedFieldHorseNames.has(normalizeHorseName(name))
  );

  result.diagnostics.matching = {
    spotPlayMatchedFieldHorse: normalizedSpotPlay ? normalizedFieldHorseNames.has(normalizedSpotPlay) : false,
    optixMatchedFieldCount: normalizedOptixSelections.filter((name) => normalizedFieldHorseNames.has(name)).length,
    unmatchedOptixSelections,
    optixUrlRaceHints,
    optixUrlLooksMismatched:
      optixUrlRaceHints.length > 0 && Number.isFinite(normalizedRaceNumber)
        ? !optixUrlRaceHints.includes(normalizedRaceNumber)
        : false
  };

  return result;
};

export const getLiveOdds = async (raceConfig, horseNames) => {
  if (!Array.isArray(horseNames) || horseNames.length === 0) {
    return {
      provider: 'BettingNews',
      url: buildBettingNewsRaceUrl(raceConfig),
      fetchedAt: new Date().toISOString(),
      oddsByHorse: {}
    };
  }

  const uniqueHorseNames = [...new Set(horseNames.map((name) => String(name).trim()).filter(Boolean))];
  return fetchBettingNewsOdds(raceConfig, uniqueHorseNames);
};

export const getEquibaseScratches = async (trackCode = 'OP') => {
  const normalizedTrackCode = String(trackCode || 'OP')
    .trim()
    .toUpperCase();
  const url = `https://mobile.equibase.com/html/scratches${normalizedTrackCode}.html`;
  const response = await fetch(url, { headers: DEFAULT_HEADERS });

  const result = {
    provider: 'Equibase',
    url,
    fetchedAt: new Date().toISOString(),
    scratchesByRace: {},
    diagnostics: {
      status: response.status,
      ok: response.ok,
      updatedLine: null,
      preview: null
    }
  };

  if (!response.ok) {
    result.diagnostics.preview = await summarizeHtmlPreview(response);
    return result;
  }

  const html = await response.text();
  const lines = stripHtmlToLines(html);
  const updatedLine = lines.find((line) => /^Updated:/i.test(line));
  result.diagnostics.updatedLine = parseDateFromUpdatedLine(updatedLine);

  let activeRace = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const raceMatch = line.match(/^Race\s+(\d+)/i);
    if (raceMatch) {
      activeRace = Number(raceMatch[1]);
      if (!result.scratchesByRace[activeRace]) {
        result.scratchesByRace[activeRace] = [];
      }
      continue;
    }

    if (!activeRace) {
      continue;
    }

    const candidateMatch = line.match(/^#\s*\d+\s+(.+?):$/);
    if (!candidateMatch) {
      continue;
    }

    const horseName = candidateMatch[1].trim();
    const nextWindow = lines.slice(index + 1, index + 5).join(' ');
    if (/Scratched/i.test(nextWindow)) {
      result.scratchesByRace[activeRace].push(horseName);
    }
  }

  for (const [raceNumber, names] of Object.entries(result.scratchesByRace)) {
    result.scratchesByRace[raceNumber] = [...new Set(names)];
  }

  return result;
};

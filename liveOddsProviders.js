const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

const collapseWhitespace = (text) => text.replace(/\s+/g, " ").trim();

const decodeHtmlEntities = (text) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripHtml = (html) =>
  collapseWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeOdds = (odds) => odds.replace(/\s+/g, "");
const normalizeHorseName = (name) =>
  String(name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

export const buildBettingNewsRaceUrl = (raceConfig) => {
  const { trackSlug, year, month, day, raceNumber } = raceConfig;
  return `https://horses.bettingnews.com/${trackSlug}/${year}/${month}/${day}/${raceNumber}`;
};

export const extractOddsFromText = (plainText, horseNames) => {
  const headerAnchor = "Name Win % / Place % / Show % Predictions M/L Info Jockey Trainer Style";
  const startIndex = plainText.indexOf(headerAnchor);
  const windowText = startIndex >= 0 ? plainText.slice(startIndex) : plainText;
  const oddsByHorse = {};

  for (const horseName of horseNames) {
    const pattern = new RegExp(escapeRegExp(horseName), "gi");
    const matches = [...windowText.matchAll(pattern)];
    let selectedOdds = null;

    for (const match of matches) {
      if (typeof match.index !== "number") {
        continue;
      }
      const segment = windowText.slice(match.index, match.index + 500);
      const oddsMatch = segment.match(/(\d+\s*\/\s*\d+)\s+[A-Z]\b/);
      if (oddsMatch) {
        // Keep the last matched occurrence because BettingNews often repeats horses in two tables.
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
    throw new Error(`BettingNews request failed with status ${response.status}`);
  }

  const html = await response.text();
  const plainText = stripHtml(html);
  const oddsByHorse = extractOddsFromText(plainText, horseNames);

  return {
    provider: "BettingNews",
    url,
    fetchedAt: new Date().toISOString(),
    oddsByHorse
  };
};

const stripHtmlToLines = (html) => {
  const text = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h1|h2|h3|h4|h5|h6|li|div|section|article|tr|td)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );

  return text
    .split(/\n+/)
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);
};

const extractBrisnetSpotPlay = (lines, trackName, raceNumber) => {
  const trackIndex = lines.findIndex((line) =>
    line.toLowerCase().includes(trackName.toLowerCase())
  );
  if (trackIndex < 0) {
    return null;
  }

  for (let index = trackIndex; index < Math.min(lines.length, trackIndex + 70); index += 1) {
    const line = lines[index];
    const raceMatch = line.match(/^Race\s+(\d+)/i);
    if (!raceMatch || Number(raceMatch[1]) !== Number(raceNumber)) {
      continue;
    }

    for (let probe = index + 1; probe < Math.min(lines.length, index + 8); probe += 1) {
      const candidate = lines[probe];
      const candidateMatch = candidate.match(/^(.+?)\s+(\d+\s*-\s*\d+)$/);
      if (candidateMatch) {
        return {
          raceNumber: Number(raceMatch[1]),
          horseName: candidateMatch[1].trim(),
          quotedOdds: candidateMatch[2].replace(/\s+/g, "")
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

    const horseMatch = line.match(/#\d+\s+([A-Z][A-Z' -]+)/);
    if (horseMatch) {
      selections.push(horseMatch[1].trim());
    }
  }

  return [...new Set(selections)];
};

const computeBrisnetSignals = (horseNames, spotPlay, optixSelections) => {
  const signals = {};
  const normalizedSpot = spotPlay ? normalizeHorseName(spotPlay.horseName) : "";
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
    provider: "BRISNET",
    fetchedAt: new Date().toISOString(),
    spotPlay: null,
    optixSelections: [],
    signals: Object.fromEntries(cleanHorseNames.map((name) => [name, 50])),
    sources: []
  };

  if (!brisnetConfig || typeof brisnetConfig !== "object") {
    return result;
  }

  const { spotPlaysUrl, optixUrl, trackName, raceNumber } = brisnetConfig;
  const normalizedRaceNumber = Number(raceNumber);

  if (spotPlaysUrl) {
    const spotResponse = await fetch(spotPlaysUrl, { headers: DEFAULT_HEADERS });
    if (spotResponse.ok) {
      const spotHtml = await spotResponse.text();
      const lines = stripHtmlToLines(spotHtml);
      result.spotPlay = extractBrisnetSpotPlay(lines, trackName ?? "Oaklawn Park", normalizedRaceNumber);
      result.sources.push(spotPlaysUrl);
    }
  }

  if (optixUrl) {
    const optixResponse = await fetch(optixUrl, { headers: DEFAULT_HEADERS });
    if (optixResponse.ok) {
      const optixHtml = await optixResponse.text();
      const lines = stripHtmlToLines(optixHtml);
      result.optixSelections = extractBrisnetOptixSelections(lines, normalizedRaceNumber);
      result.sources.push(optixUrl);
    }
  }

  result.signals = computeBrisnetSignals(cleanHorseNames, result.spotPlay, result.optixSelections);
  return result;
};

export const getLiveOdds = async (raceConfig, horseNames) => {
  if (!Array.isArray(horseNames) || horseNames.length === 0) {
    return {
      provider: "BettingNews",
      url: buildBettingNewsRaceUrl(raceConfig),
      fetchedAt: new Date().toISOString(),
      oddsByHorse: {}
    };
  }

  const uniqueHorseNames = [...new Set(horseNames.map((name) => String(name).trim()).filter(Boolean))];
  return fetchBettingNewsOdds(raceConfig, uniqueHorseNames);
};

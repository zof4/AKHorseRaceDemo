const DEFAULT_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

const pad = (value) => String(value).padStart(2, '0');
const trackNameForCode = (trackCode) => {
  const code = String(trackCode || '').toUpperCase();
  if (code === 'OP') {
    return 'Oaklawn Park';
  }
  return null;
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

const isLabelLikeLine = (value) =>
  /^(Jockey|Trainer|Program|Race|Post|Weight|Owner|Silks|Odds|M\/L|ML|Age|Sex|Sire|Dam)\b/i.test(
    String(value ?? '')
  );

const isNoiseLine = (value) => {
  const line = String(value ?? '').trim();
  if (!line) {
    return true;
  }
  if (isLabelLikeLine(line)) {
    return true;
  }
  if (/^[0-9]+\s*\/\s*[0-9]+$/.test(line)) {
    return true;
  }
  if (/^\d+(\.\d+)?$/.test(line)) {
    return true;
  }
  return false;
};

const findFirstLikelyHorseName = (blockLines) => {
  for (let index = 0; index < blockLines.length; index += 1) {
    const line = String(blockLines[index] ?? '').trim();
    if (isNoiseLine(line)) {
      continue;
    }
    if (line.length >= 2) {
      return line;
    }
  }
  return '';
};

const buildHorseBlocks = (lines) => {
  const markers = [];
  for (let index = 0; index < lines.length; index += 1) {
    const postMatch = String(lines[index] ?? '').match(/Post:\s*(\d+)/i);
    if (!postMatch) {
      continue;
    }
    markers.push({
      startIndex: index,
      postPosition: Number(postMatch[1])
    });
  }

  return markers.map((marker, index) => {
    const endIndex = index + 1 < markers.length ? markers[index + 1].startIndex : lines.length;
    const blockLines = lines.slice(marker.startIndex, endIndex);
    return {
      postPosition: marker.postPosition,
      blockLines
    };
  });
};

const hashString = (value) => {
  let hash = 0;
  for (const char of String(value ?? '')) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }
  return hash;
};

const impliedProbability = (oddsText) => {
  const clean = String(oddsText ?? '').trim();
  const match = clean.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return 0.1;
  }
  const num = Number(match[1]);
  const den = Number(match[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) {
    return 0.1;
  }
  return den / (num + den);
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const ratingBundleFromOdds = (oddsText, name, index) => {
  const p = impliedProbability(oddsText);
  const base = 42 + p * 56;
  const noise = (hashString(`${name}-${index}`) % 7) - 3;
  const speed = clamp(base + noise + 5, 30, 99);
  const form = clamp(base + noise + 2, 30, 99);
  const classRating = clamp(base + noise + 1, 30, 99);
  const paceFit = clamp(base + (noise % 3), 30, 99);
  const distanceFit = clamp(base + (noise % 4), 30, 99);
  const connections = clamp(base + (noise % 5), 30, 99);
  const consistency = clamp(base - 3 + (noise % 4), 30, 99);
  const volatility = clamp(65 - base / 2 + Math.abs(noise * 2), 20, 80);
  const lateKick = clamp(base - 4 + (noise % 5), 30, 99);
  const improvingTrend = clamp(base - 2 + (noise % 5), 30, 99);
  const brisnetSignal = clamp(48 + p * 22 + noise, 35, 85);

  return {
    speed: Number(speed.toFixed(1)),
    form: Number(form.toFixed(1)),
    classRating: Number(classRating.toFixed(1)),
    paceFit: Number(paceFit.toFixed(1)),
    distanceFit: Number(distanceFit.toFixed(1)),
    connections: Number(connections.toFixed(1)),
    consistency: Number(consistency.toFixed(1)),
    volatility: Number(volatility.toFixed(1)),
    lateKick: Number(lateKick.toFixed(1)),
    improvingTrend: Number(improvingTrend.toFixed(1)),
    brisnetSignal: Number(brisnetSignal.toFixed(1))
  };
};

const buildEntriesUrl = ({ trackCode, year, month, day, raceNumber }) =>
  `https://mobile.equibase.com/html/entries${trackCode}${year}${pad(month)}${pad(day)}${pad(raceNumber)}.html`;

const toIsoDate = (dateKey) => {
  const match = String(dateKey ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
};

const parseRacePage = ({ html, raceNumber, trackCode, dateKey, url }) => {
  const lines = stripHtmlToLines(html);
  const parsedTrackLine =
    lines.find((line) => /(Oaklawn|Park)/i.test(line) && !/^Race\b/i.test(line)) ?? 'Oaklawn Park';
  const trackLine = trackNameForCode(trackCode) ?? parsedTrackLine;
  const classLine =
    lines.find((line) => /\b(Claiming|Allowance|Stakes|Maiden|Handicap)\b/i.test(line)) ?? 'Unknown Class';
  const distanceLine =
    lines.find((line) => /\b(Mile|Furlong|Yard)\b/i.test(line)) ?? 'Distance TBD';

  const horses = [];
  const horseBlocks = buildHorseBlocks(lines);
  for (const block of horseBlocks) {
    const blockText = block.blockLines.join(' ');
    const oddsMatch = blockText.match(/Odds:\s*([0-9./]+)/i);
    const odds = oddsMatch ? oddsMatch[1].trim() : '';
    const name = findFirstLikelyHorseName(block.blockLines);
    if (!name) {
      continue;
    }

    let jockey = null;
    let trainer = null;
    for (const rawLine of block.blockLines) {
      const candidate = String(rawLine ?? '').trim();
      const jockeyMatch = candidate.match(/^Jockey:\s*(.+)$/i);
      if (jockeyMatch) {
        jockey = jockeyMatch[1].trim();
      }
      const trainerMatch = candidate.match(/^Trainer:\s*(.+)$/i);
      if (trainerMatch) {
        trainer = trainerMatch[1].trim();
      }
    }

    horses.push({
      name,
      post_position: block.postPosition,
      jockey,
      trainer,
      morning_line_odds: odds || null
    });
  }

  if (horses.length < 3) {
    return null;
  }

  const [year, month, day] = dateKey.split('-').map((entry) => Number(entry));
  const monthName = new Date(year, month - 1, day).toLocaleString('en-US', { month: 'long' }).toLowerCase();

  return {
    name: `${trackLine} Race ${raceNumber}`,
    track: trackLine,
    race_number: raceNumber,
    distance: distanceLine,
    surface: null,
    class: classLine,
    post_time: `${dateKey}T00:00:00`,
    status: 'upcoming',
    source: 'api',
    takeout_pct: Number(process.env.DEFAULT_TAKEOUT_PCT ?? 0.22),
    external_id: `equibase-${trackCode}-${dateKey}-r${raceNumber}`,
    race_config_json: JSON.stringify({
      trackSlug: 'oaklawn-park',
      trackCode,
      year,
      month,
      day,
      raceNumber,
      refreshSeconds: 15
    }),
    brisnet_config_json: JSON.stringify({
      trackName: trackLine,
      raceNumber,
      spotPlaysUrl: `https://www.brisnet.com/racing/spot-plays/spot-plays-${monthName}-${day}-${year}/`,
      optixUrl: null
    }),
    sources_json: JSON.stringify([
      {
        title: `Equibase Entries ${trackCode} Race ${raceNumber}`,
        url,
        usedFor: 'Live race card import, horses, post positions, jockey and trainer data'
      }
    ]),
    horses: horses.map((horse, index) => {
      const ratings = ratingBundleFromOdds(horse.morning_line_odds, horse.name, index);
      return {
        name: horse.name,
        post_position: horse.post_position,
        jockey: horse.jockey,
        trainer: horse.trainer,
        morning_line_odds: horse.morning_line_odds,
        weight: null,
        age: null,
        sex: null,
        recent_form: JSON.stringify([]),
        speed_figures: JSON.stringify([ratings.speed]),
        jockey_win_pct: null,
        trainer_win_pct: null,
        class_rating: ratings.classRating,
        speed_rating: ratings.speed,
        form_rating: ratings.form,
        pace_fit_rating: ratings.paceFit,
        distance_fit_rating: ratings.distanceFit,
        connections_rating: ratings.connections,
        consistency_rating: ratings.consistency,
        volatility_rating: ratings.volatility,
        late_kick_rating: ratings.lateKick,
        improving_trend_rating: ratings.improvingTrend,
        brisnet_signal: ratings.brisnetSignal,
        scratched: 0
      };
    })
  };
};

export const importEquibaseRaces = async ({
  trackCode = 'OP',
  dates,
  raceNumbers = Array.from({ length: 12 }, (_, index) => index + 1)
}) => {
  const dateKeys = Array.isArray(dates) ? dates.map((entry) => String(entry)) : [];
  const validDates = dateKeys.map((entry) => toIsoDate(entry)).filter(Boolean);
  const importedPayloads = [];
  const diagnostics = [];

  for (const date of validDates) {
    const dateKey = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
    for (const raceNumberRaw of raceNumbers) {
      const raceNumber = Number(raceNumberRaw);
      if (!Number.isInteger(raceNumber) || raceNumber <= 0) {
        continue;
      }

      const url = buildEntriesUrl({
        trackCode,
        year: date.year,
        month: date.month,
        day: date.day,
        raceNumber
      });

      try {
        const response = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!response.ok) {
          diagnostics.push({ date: dateKey, raceNumber, url, status: response.status, ok: false });
          continue;
        }
        const html = await response.text();
        const payload = parseRacePage({ html, raceNumber, trackCode, dateKey, url });
        diagnostics.push({ date: dateKey, raceNumber, url, status: response.status, ok: true, parsed: Boolean(payload) });
        if (payload) {
          importedPayloads.push(payload);
        }
      } catch (error) {
        diagnostics.push({
          date: dateKey,
          raceNumber,
          url,
          status: null,
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  return {
    trackCode,
    dates: validDates.map((date) => `${date.year}-${pad(date.month)}-${pad(date.day)}`),
    importedPayloads,
    diagnostics
  };
};

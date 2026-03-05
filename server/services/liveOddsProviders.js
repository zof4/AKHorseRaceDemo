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

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeOdds = (odds) => odds.replace(/\s+/g, '');

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
    throw new Error(`BettingNews request failed with status ${response.status}`);
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

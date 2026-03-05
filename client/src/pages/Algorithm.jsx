import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { markAutoImportRan, shouldRunAutoImport } from '../lib/autoImportCache.js';
import BetPlacementModal from '../components/BetPlacementModal.jsx';

const asPercent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const asScore = (value) => Number(value || 0).toFixed(1);
const asPoints = (value) => Number(value || 0).toFixed(3);
const pad = (value) => String(value).padStart(2, '0');
const normalizeHorseName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeText = (value) => String(value || '').trim().toLowerCase();
const formatTimestamp = (value) => {
  if (!value) {
    return 'Not yet';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not yet';
  }
  return date.toLocaleString();
};

const formatTimeAgo = (value, nowMs) => {
  if (!value) {
    return 'Not yet';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not yet';
  }

  const seconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

const METRIC_LABELS = {
  speed: 'Speed',
  form: 'Form',
  class: 'Class',
  paceFit: 'Pace Fit',
  distanceFit: 'Distance Fit',
  connections: 'Connections',
  consistency: 'Consistency',
  lateKick: 'Late Kick',
  improvingTrend: 'Improving Trend',
  brisnetSignal: 'BRISNET Signal',
  volatility: 'Volatility'
};

const METRIC_MEANINGS = {
  speed: 'Raw pace/speed capability. Higher increases model win chance.',
  form: 'Recent condition and current cycle. Higher means stronger current form.',
  class: 'Quality of prior company. Higher suggests stronger competition history.',
  paceFit: 'How likely running style matches today pace setup.',
  distanceFit: 'How well this horse projects at today distance.',
  connections: 'Trainer/jockey quality composite signal.',
  consistency: 'Likelihood of repeating prior performance level.',
  lateKick: 'Closing strength in later fractions.',
  improvingTrend: 'Positive trajectory over recent starts.',
  brisnetSignal: 'External signal boost from BRISNET overlays.',
  volatility: 'Performance variance. Higher volatility reduces reliability.'
};

const dateKeyFor = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const extractPresetDateKey = (preset) => {
  const config = preset?.raceConfig;
  if (!config) {
    return null;
  }
  return `${config.year}-${pad(config.month)}-${pad(config.day)}`;
};

const extractRaceDateKey = (race) => {
  const externalId = String(race?.external_id ?? '');
  const match = externalId.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  if (race?.post_time) {
    const date = new Date(race.post_time);
    if (!Number.isNaN(date.getTime())) {
      return dateKeyFor(date);
    }
  }

  return null;
};

const riskToneClasses = {
  Low: 'bg-emerald-100 text-emerald-800',
  Mid: 'bg-amber-100 text-amber-900',
  'Mid-High': 'bg-orange-100 text-orange-900',
  High: 'bg-rose-100 text-rose-800'
};

const tierToneClasses = {
  'Sure Bet': 'border-emerald-200 bg-emerald-50',
  'Mid Bet': 'border-amber-200 bg-amber-50',
  'Long-Shot Bet': 'border-rose-200 bg-rose-50'
};
const AUTO_IMPORT_TTL_MS = 10 * 60 * 1000;

const STORAGE_KEYS = {
  lastRaceId: 'hrd:algorithm:lastRaceId',
  lastRaceExternalId: 'hrd:algorithm:lastRaceExternalId',
  dayMode: 'hrd:algorithm:dayMode'
};

const loadStoredDayMode = () => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEYS.dayMode);
    return value === 'today' || value === 'tomorrow' ? value : 'today';
  } catch {
    return 'today';
  }
};

const loadStoredRaceId = () => {
  try {
    const parsed = Number(window.localStorage.getItem(STORAGE_KEYS.lastRaceId));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const loadStoredRaceExternalId = () => {
  try {
    const value = String(window.localStorage.getItem(STORAGE_KEYS.lastRaceExternalId) ?? '').trim();
    return value || null;
  } catch {
    return null;
  }
};

function ProbabilityBars({ modelProbability, marketProbability }) {
  const modelWidth = Math.max(4, Math.min(100, Number(modelProbability || 0) * 100));
  const marketWidth = Math.max(4, Math.min(100, Number(marketProbability || 0) * 100));

  return (
    <div className="grid gap-1 text-[11px] text-stone-600">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span>Model</span>
          <span>{asPercent(modelProbability)}</span>
        </div>
        <div className="meter-track">
          <div className="meter-fill" style={{ width: `${modelWidth}%` }} />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span>Market</span>
          <span>{asPercent(marketProbability)}</span>
        </div>
        <div className="meter-track">
          <div className="h-full rounded-full bg-[#9f8f7c]" style={{ width: `${marketWidth}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function Algorithm() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [races, setRaces] = useState([]);
  const [race, setRace] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [bankroll, setBankroll] = useState(100);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [dayMode, setDayMode] = useState(loadStoredDayMode);
  const [loading, setLoading] = useState(true);
  const [raceSyncing, setRaceSyncing] = useState(false);
  const [refreshingMarket, setRefreshingMarket] = useState(false);
  const [brisnetIntel, setBrisnetIntel] = useState(null);
  const [scratchesIntel, setScratchesIntel] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Waiting for first refresh.');
  const [lastLiveUpdateAt, setLastLiveUpdateAt] = useState(null);
  const [lastRefreshAttemptAt, setLastRefreshAttemptAt] = useState(null);
  const [lastRefreshSuccessAt, setLastRefreshSuccessAt] = useState(null);
  const [lastRefreshSummary, setLastRefreshSummary] = useState(null);
  const [nextAutoRefreshAt, setNextAutoRefreshAt] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [selectedHorseName, setSelectedHorseName] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedJockeyName, setSelectedJockeyName] = useState('');
  const [jockeyInspectorOpen, setJockeyInspectorOpen] = useState(false);
  const [jockeyProfilesByName, setJockeyProfilesByName] = useState({});
  const [jockeyProfileLoadingKey, setJockeyProfileLoadingKey] = useState('');
  const [jockeyProfileError, setJockeyProfileError] = useState('');
  const [betModalOpen, setBetModalOpen] = useState(false);
  const [betDraft, setBetDraft] = useState(null);
  const [presetHistoryByExternalRaceId, setPresetHistoryByExternalRaceId] = useState({});
  const selectedRaceIdRef = useRef(0);
  const raceSyncRequestIdRef = useRef(0);
  const marketRefreshRequestIdRef = useRef(0);

  const selectedRaceId = Number(searchParams.get('raceId') || 0);
  const selectedRaceExternalId = String(searchParams.get('raceExternalId') || '').trim();

  const todayKey = useMemo(() => {
    const now = new Date();
    return dateKeyFor(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }, []);

  const tomorrowKey = useMemo(() => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dateKeyFor(tomorrow);
  }, []);

  const filteredRaces = useMemo(() => {
    const targetKey = dayMode === 'today' ? todayKey : tomorrowKey;
    const matches = races.filter((entry) => extractRaceDateKey(entry) === targetKey);
    return matches.length ? matches : races;
  }, [races, dayMode, todayKey, tomorrowKey]);

  const selectedRace = useMemo(() => {
    const byIdInFiltered = filteredRaces.find((entry) => entry.id === selectedRaceId);
    if (byIdInFiltered) {
      return byIdInFiltered;
    }

    if (selectedRaceExternalId) {
      const byExternalInFiltered = filteredRaces.find(
        (entry) => String(entry.external_id ?? '') === selectedRaceExternalId
      );
      if (byExternalInFiltered) {
        return byExternalInFiltered;
      }
    }

    const byIdInAll = races.find((entry) => entry.id === selectedRaceId);
    if (byIdInAll) {
      return byIdInAll;
    }

    if (selectedRaceExternalId) {
      const byExternalInAll = races.find((entry) => String(entry.external_id ?? '') === selectedRaceExternalId);
      if (byExternalInAll) {
        return byExternalInAll;
      }
    }

    return filteredRaces[0] ?? races[0] ?? null;
  }, [filteredRaces, races, selectedRaceId, selectedRaceExternalId]);

  useEffect(() => {
    selectedRaceIdRef.current = Number(selectedRace?.id ?? 0);
  }, [selectedRace?.id]);

  const totalHorseCount = Array.isArray(race?.horses) ? race.horses.length : 0;
  const activeHorseCount = Array.isArray(race?.horses)
    ? race.horses.filter((horse) => !Number(horse.scratched)).length
    : 0;

  const secondsUntilNextRefresh =
    autoRefresh && nextAutoRefreshAt
      ? Math.max(0, Math.ceil((nextAutoRefreshAt - nowMs) / 1000))
      : null;

  const rankedWithPosts = useMemo(() => {
    if (!race || !analysis?.ranked) {
      return [];
    }

    const postByHorseName = new Map(
      race.horses.map((horse) => [normalizeHorseName(horse.name), horse.post_position || '-'])
    );

    return analysis.ranked.map((runner) => ({
      ...runner,
      postPosition: postByHorseName.get(normalizeHorseName(runner.name)) ?? '-'
    }));
  }, [race, analysis]);

  const selectedRunner = useMemo(() => {
    if (!rankedWithPosts.length) {
      return null;
    }

    const byName = rankedWithPosts.find((runner) => normalizeHorseName(runner.name) === normalizeHorseName(selectedHorseName));
    return byName ?? rankedWithPosts[0];
  }, [rankedWithPosts, selectedHorseName]);

  const selectedRaceHorse = useMemo(() => {
    if (!race || !selectedRunner) {
      return null;
    }
    return race.horses.find((horse) => normalizeHorseName(horse.name) === normalizeHorseName(selectedRunner.name)) ?? null;
  }, [race, selectedRunner]);

  const selectedPresetHorse = useMemo(() => {
    if (!race || !selectedRunner) {
      return null;
    }
    const perRace = presetHistoryByExternalRaceId[String(race.external_id || '')];
    return perRace?.[normalizeHorseName(selectedRunner.name)] ?? null;
  }, [presetHistoryByExternalRaceId, race, selectedRunner]);

  const jockeyAnalysis = useMemo(() => {
    if (!race || !analysis?.ranked) {
      return [];
    }

    const runnerByName = new Map(
      analysis.ranked.map((runner) => [normalizeHorseName(runner.name), runner])
    );

    const grouped = new Map();
    for (const horse of race.horses || []) {
      if (Number(horse.scratched)) {
        continue;
      }

      const jockeyName = horse.jockey || 'Unknown Jockey';
      const runner = runnerByName.get(normalizeHorseName(horse.name));
      if (!runner) {
        continue;
      }

      if (!grouped.has(jockeyName)) {
        grouped.set(jockeyName, {
          jockey: jockeyName,
          rides: 0,
          modelProbabilityTotal: 0,
          edgeTotal: 0,
          topHorse: null,
          topHorseScore: -Infinity
        });
      }

      const row = grouped.get(jockeyName);
      row.rides += 1;
      row.modelProbabilityTotal += Number(runner.modelProbability || 0);
      row.edgeTotal += Number(runner.valueEdge || 0);
      if (Number(runner.score) > row.topHorseScore) {
        row.topHorseScore = Number(runner.score);
        row.topHorse = horse.name;
      }
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        avgModelProbability: row.rides ? row.modelProbabilityTotal / row.rides : 0,
        avgEdge: row.rides ? row.edgeTotal / row.rides : 0
      }))
      .sort((left, right) => right.avgModelProbability - left.avgModelProbability);
  }, [race, analysis]);

  const selectedJockey = useMemo(() => {
    if (!jockeyAnalysis.length) {
      return null;
    }

    return (
      jockeyAnalysis.find((row) => normalizeText(row.jockey) === normalizeText(selectedJockeyName)) ??
      jockeyAnalysis[0]
    );
  }, [jockeyAnalysis, selectedJockeyName]);

  const selectedJockeyKey = normalizeText(selectedJockey?.jockey);
  const selectedJockeyProfile = selectedJockeyKey ? jockeyProfilesByName[selectedJockeyKey] ?? null : null;
  const isLoadingSelectedJockeyProfile = Boolean(selectedJockeyKey) && jockeyProfileLoadingKey === selectedJockeyKey;

  const selectedJockeyRides = useMemo(() => {
    if (!race || !analysis?.ranked || !selectedJockey) {
      return [];
    }

    const runnerByHorseName = new Map(
      analysis.ranked.map((runner) => [normalizeHorseName(runner.name), runner])
    );

    return (race.horses || [])
      .filter((horse) => !Number(horse.scratched))
      .filter((horse) => normalizeText(horse.jockey || 'Unknown Jockey') === normalizeText(selectedJockey.jockey))
      .map((horse) => {
        const runner = runnerByHorseName.get(normalizeHorseName(horse.name));
        if (!runner) {
          return null;
        }
        return {
          horseId: horse.id,
          horseName: horse.name,
          postPosition: horse.post_position || '-',
          odds: runner.odds || horse.morning_line_odds || '-',
          score: runner.score,
          modelProbability: runner.modelProbability,
          marketProbability: runner.marketProbability,
          valueEdge: runner.valueEdge,
          fairOdds: runner.fairOdds?.text || 'N/A',
          marketFairOdds: runner.marketFairOdds?.text || 'N/A'
        };
      })
      .filter(Boolean)
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
  }, [race, analysis, selectedJockey]);

  const selectedContributionRows = useMemo(() => {
    if (!selectedRunner?.scoreBreakdown?.base?.components) {
      return [];
    }
    return [...selectedRunner.scoreBreakdown.base.components].sort(
      (left, right) => Math.abs(Number(right.contribution || 0)) - Math.abs(Number(left.contribution || 0))
    );
  }, [selectedRunner]);

  const selectedRunnerImpact = useMemo(() => {
    if (!selectedRunner || !analysis?.brisnetImpact?.horseComparisons) {
      return null;
    }
    return (
      analysis.brisnetImpact.horseComparisons.find(
        (entry) => normalizeHorseName(entry.name) === normalizeHorseName(selectedRunner.name)
      ) ?? null
    );
  }, [analysis, selectedRunner]);

  const brisnetSignalContribution = useMemo(() => {
    if (!selectedRunner?.scoreBreakdown?.base?.components) {
      return null;
    }
    return (
      selectedRunner.scoreBreakdown.base.components.find((component) => component.key === 'brisnetSignal') ?? null
    );
  }, [selectedRunner]);

  const loadRaces = async () => {
    const { races: rows } = await api.listRaces();
    setRaces(rows);
    return rows;
  };

  const loadRaceDetail = async (raceId) => {
    const { race: row } = await api.getRace(raceId);
    return row;
  };

  const runAnalysis = async (raceId, bankrollValue = bankroll) => {
    const {
      ranked,
      rankedWithoutBrisnet,
      brisnetImpact,
      undercoverWinner,
      topBets,
      counterBets,
      tierSuggestions,
      modelMeta
    } = await api.analyzeRace(
      raceId,
      bankrollValue
    );
    return {
      ranked,
      rankedWithoutBrisnet,
      brisnetImpact,
      undercoverWinner,
      topBets,
      counterBets,
      tierSuggestions,
      modelMeta
    };
  };

  const autoImportTodayTomorrow = async () => {
    const { presets } = await api.listRacePresets();
    const targetDateKeys = new Set([todayKey, tomorrowKey]);
    const dates = [todayKey, tomorrowKey];

    const presetHorseByRace = {};
    for (const preset of presets) {
      const horsesByName = {};
      for (const horse of preset.horses || []) {
        horsesByName[normalizeHorseName(horse.name)] = horse;
      }
      presetHorseByRace[preset.id] = horsesByName;
    }
    setPresetHistoryByExternalRaceId(presetHorseByRace);

    const importDecision = shouldRunAutoImport({
      scope: 'today-tomorrow',
      trackCode: 'OP',
      dates,
      ttlMs: AUTO_IMPORT_TTL_MS
    });

    if (!importDecision.run) {
      const ageMinutes = Math.max(0, Math.round((importDecision.ageMs ?? 0) / 60000));
      setStatus(`Using cached race import (${ageMinutes} minute${ageMinutes === 1 ? '' : 's'} old).`);
      return;
    }

    const presetIds = presets
      .filter((preset) => targetDateKeys.has(extractPresetDateKey(preset)))
      .map((preset) => preset.id);

    if (presetIds.length) {
      await api.importRacePresets({ presetIds });
    } else {
      await api.importRacePresets({});
    }

    try {
      await api.importEquibaseRaces({
        trackCode: 'OP',
        dates
      });
      markAutoImportRan({ signature: importDecision.signature });
    } catch (err) {
      setStatus(`Preset import completed; live Equibase import skipped (${err.message}).`);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError('');

      try {
        await autoImportTodayTomorrow();
        await loadRaces();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!races.length) {
      return;
    }

    const raceFromQuery =
      races.find((entry) => entry.id === selectedRaceId) ??
      (selectedRaceExternalId
        ? races.find((entry) => String(entry.external_id ?? '') === selectedRaceExternalId)
        : null);

    const syncSearchParamsToRace = (raceRow) => {
      if (!raceRow) {
        return;
      }

      const raceIdToken = String(raceRow.id);
      const raceExternalToken = String(raceRow.external_id ?? '').trim();
      const queryRaceId = selectedRaceId > 0 ? String(selectedRaceId) : '';
      const queryRaceExternal = selectedRaceExternalId;

      if (queryRaceId === raceIdToken && queryRaceExternal === raceExternalToken) {
        return;
      }

      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('raceId', raceIdToken);
          if (raceExternalToken) {
            next.set('raceExternalId', raceExternalToken);
          } else {
            next.delete('raceExternalId');
          }
          return next;
        },
        { replace: true }
      );
    };

    if (raceFromQuery) {
      const raceDateKey = extractRaceDateKey(raceFromQuery);
      if (raceDateKey === todayKey && dayMode !== 'today') {
        setDayMode('today');
      } else if (raceDateKey === tomorrowKey && dayMode !== 'tomorrow') {
        setDayMode('tomorrow');
      }
      syncSearchParamsToRace(raceFromQuery);
      return;
    }

    const restoredRaceExternalId = loadStoredRaceExternalId();
    const restoredRaceId = loadStoredRaceId();
    const restoredRace =
      (restoredRaceExternalId
        ? races.find((entry) => String(entry.external_id ?? '') === restoredRaceExternalId)
        : null) ??
      (restoredRaceId ? races.find((entry) => entry.id === restoredRaceId) : null);
    const fallback = restoredRace ?? filteredRaces[0] ?? races[0] ?? null;
    if (!fallback) {
      return;
    }

    const fallbackDateKey = extractRaceDateKey(fallback);
    if (fallbackDateKey === todayKey && dayMode !== 'today') {
      setDayMode('today');
    } else if (fallbackDateKey === tomorrowKey && dayMode !== 'tomorrow') {
      setDayMode('tomorrow');
    }

    syncSearchParamsToRace(fallback);
  }, [races, filteredRaces, selectedRaceId, selectedRaceExternalId, setSearchParams, dayMode, todayKey, tomorrowKey]);

  useEffect(() => {
    if (!selectedRace?.id) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.lastRaceId, String(selectedRace.id));
      const externalToken = String(selectedRace.external_id ?? '').trim();
      if (externalToken) {
        window.localStorage.setItem(STORAGE_KEYS.lastRaceExternalId, externalToken);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [selectedRace?.id, selectedRace?.external_id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.dayMode, dayMode);
    } catch {
      // Ignore storage failures.
    }
  }, [dayMode]);

  useEffect(() => {
    if (!selectedRace) {
      return;
    }

    const sync = async () => {
      const requestId = raceSyncRequestIdRef.current + 1;
      raceSyncRequestIdRef.current = requestId;
      const raceId = Number(selectedRace.id);

      setRaceSyncing(true);
      setError('');
      setStatus('Loading selected race...');
      setRace(null);
      setAnalysis(null);
      setBrisnetIntel(null);
      setScratchesIntel(null);
      setSelectedHorseName('');
      setSelectedJockeyName('');
      setInspectorOpen(false);
      setJockeyInspectorOpen(false);
      setBetModalOpen(false);
      try {
        const loadedRace = await loadRaceDetail(raceId);
        if (requestId !== raceSyncRequestIdRef.current || selectedRaceIdRef.current !== raceId) {
          return;
        }

        const nextAnalysis = await runAnalysis(raceId, bankroll);
        if (requestId !== raceSyncRequestIdRef.current || selectedRaceIdRef.current !== raceId) {
          return;
        }

        setRace(loadedRace);
        setAnalysis(nextAnalysis);
        setStatus('Race loaded.');
      } catch (err) {
        if (requestId !== raceSyncRequestIdRef.current || selectedRaceIdRef.current !== raceId) {
          return;
        }
        setError(err.message);
        setAnalysis(null);
        setStatus('Failed to load selected race.');
      } finally {
        if (requestId === raceSyncRequestIdRef.current) {
          setRaceSyncing(false);
        }
      }
    };

    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace?.id]);

  useEffect(() => {
    if (!rankedWithPosts.length) {
      return;
    }
    if (!selectedHorseName || !rankedWithPosts.some((runner) => normalizeHorseName(runner.name) === normalizeHorseName(selectedHorseName))) {
      setSelectedHorseName(rankedWithPosts[0].name);
    }
  }, [rankedWithPosts, selectedHorseName]);

  useEffect(() => {
    if (!jockeyAnalysis.length) {
      setSelectedJockeyName('');
      return;
    }

    if (!selectedJockeyName || !jockeyAnalysis.some((row) => normalizeText(row.jockey) === normalizeText(selectedJockeyName))) {
      setSelectedJockeyName(jockeyAnalysis[0].jockey);
    }
  }, [jockeyAnalysis, selectedJockeyName]);

  useEffect(() => {
    if (!autoRefresh || !selectedRace) {
      setNextAutoRefreshAt(null);
      return undefined;
    }

    setNextAutoRefreshAt(Date.now() + 15000);
    const timer = setInterval(() => {
      setNextAutoRefreshAt(Date.now() + 15000);
      refreshMarket();
    }, 15000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, selectedRace?.id, bankroll]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const modalOpen = inspectorOpen || jockeyInspectorOpen || betModalOpen;

  useEffect(() => {
    if (!modalOpen) {
      return undefined;
    }

    const { body, documentElement } = document;
    const bodyStyle = body.style;
    const htmlStyle = documentElement.style;
    const scrollY = window.scrollY;

    const previous = {
      bodyPosition: bodyStyle.position,
      bodyTop: bodyStyle.top,
      bodyWidth: bodyStyle.width,
      bodyOverflow: bodyStyle.overflow,
      htmlOverflow: htmlStyle.overflow
    };

    body.classList.add('modal-open');
    documentElement.classList.add('modal-open');
    bodyStyle.position = 'fixed';
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.width = '100%';
    bodyStyle.overflow = 'hidden';
    htmlStyle.overflow = 'hidden';

    return () => {
      body.classList.remove('modal-open');
      documentElement.classList.remove('modal-open');
      bodyStyle.position = previous.bodyPosition;
      bodyStyle.top = previous.bodyTop;
      bodyStyle.width = previous.bodyWidth;
      bodyStyle.overflow = previous.bodyOverflow;
      htmlStyle.overflow = previous.htmlOverflow;
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    };
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (betModalOpen) {
          setBetModalOpen(false);
          return;
        }
        if (inspectorOpen) {
          setInspectorOpen(false);
          return;
        }
        if (jockeyInspectorOpen) {
          setJockeyInspectorOpen(false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, betModalOpen, inspectorOpen, jockeyInspectorOpen]);

  useEffect(() => {
    if (!selectedRace?.id || raceSyncing || !race) {
      return;
    }

    const hasRaceConfig = race.race_config && typeof race.race_config === 'object';
    const hasBrisnetConfig = race.brisnet_config && typeof race.brisnet_config === 'object';

    if (!hasRaceConfig && !hasBrisnetConfig) {
      setBrisnetIntel(null);
      setStatus('This race has no live market or BRISNET source config.');
      return;
    }

    refreshMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace?.id, raceSyncing, race?.race_config, race?.brisnet_config]);

  const refreshMarket = async () => {
    if (!selectedRace || refreshingMarket || raceSyncing) {
      return;
    }

    const requestId = marketRefreshRequestIdRef.current + 1;
    marketRefreshRequestIdRef.current = requestId;
    const raceId = Number(selectedRace.id);

    setLastRefreshAttemptAt(new Date().toISOString());
    if (autoRefresh) {
      setNextAutoRefreshAt(Date.now() + 15000);
    }
    setRefreshingMarket(true);
    setError('');
    setStatus('Refreshing live odds and BRISNET signals...');

    try {
      const payload = await api.refreshRaceMarket(raceId, bankroll);
      const loadedRace = await loadRaceDetail(raceId);
      if (requestId !== marketRefreshRequestIdRef.current || selectedRaceIdRef.current !== raceId) {
        return;
      }

      setRace(loadedRace);
      setAnalysis(payload.analysis ?? null);
      setBrisnetIntel(payload.market?.brisnet ?? null);
      setScratchesIntel(payload.market?.scratches ?? null);
      setLastLiveUpdateAt(payload.fetchedAt || new Date().toISOString());
      setLastRefreshSuccessAt(payload.fetchedAt || new Date().toISOString());
      setLastRefreshSummary({
        odds: Number(payload.updated?.odds || 0),
        signals: Number(payload.updated?.signals || 0),
        scratches: Number(payload.updated?.scratches || 0),
        warnings: Array.isArray(payload.warnings) ? payload.warnings.length : 0
      });
      const warningText =
        Array.isArray(payload.warnings) && payload.warnings.length
          ? ` Warnings: ${payload.warnings.map((warning) => `${warning.provider}: ${warning.message}`).join(' | ')}`
          : '';
      setStatus(
        `Market refreshed: odds ${payload.updated.odds}, signals ${payload.updated.signals} at ${new Date(
          payload.fetchedAt
        ).toLocaleTimeString()}.${warningText}`
      );
    } catch (err) {
      if (requestId !== marketRefreshRequestIdRef.current || selectedRaceIdRef.current !== raceId) {
        return;
      }
      setError(err.message);
      setStatus('Refresh failed.');
    } finally {
      if (requestId === marketRefreshRequestIdRef.current) {
        setRefreshingMarket(false);
      }
    }
  };

  const onRaceChange = (event) => {
    const raceId = Number(event.target.value);
    const raceRow = filteredRaces.find((entry) => entry.id === raceId) ?? races.find((entry) => entry.id === raceId) ?? null;
    const externalToken = String(raceRow?.external_id ?? '').trim();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('raceId', String(raceId));
      if (externalToken) {
        next.set('raceExternalId', externalToken);
      } else {
        next.delete('raceExternalId');
      }
      return next;
    });
    setBrisnetIntel(null);
    setScratchesIntel(null);
    setLastLiveUpdateAt(null);
    setLastRefreshAttemptAt(null);
    setLastRefreshSuccessAt(null);
    setLastRefreshSummary(null);
  };

  const onRecalculate = async () => {
    if (!selectedRace) {
      return;
    }

    try {
      setError('');
      const raceId = Number(selectedRace.id);
      const nextAnalysis = await runAnalysis(raceId, bankroll);
      if (selectedRaceIdRef.current !== raceId) {
        return;
      }
      setAnalysis(nextAnalysis);
      setStatus('Analysis recalculated.');
    } catch (err) {
      setError(err.message);
    }
  };

  const openInspectorForHorse = (horseName) => {
    setSelectedHorseName(horseName);
    setInspectorOpen(true);
  };

  const openInspectorForJockey = (jockeyName) => {
    setSelectedJockeyName(jockeyName);
    setJockeyProfileError('');
    setJockeyInspectorOpen(true);
  };

  const requestJockeyProfile = async (jockeyName, { force = false } = {}) => {
    const cleanName = String(jockeyName ?? '').trim();
    if (!cleanName) {
      return;
    }

    const key = normalizeText(cleanName);
    if (!force && jockeyProfilesByName[key]) {
      return;
    }

    setJockeyProfileError('');
    setJockeyProfileLoadingKey(key);
    try {
      const { profile } = await api.getJockeyProfile(cleanName, { force });
      setJockeyProfilesByName((prev) => ({
        ...prev,
        [key]: profile
      }));
    } catch (err) {
      setJockeyProfileError(err.message);
    } finally {
      setJockeyProfileLoadingKey((prev) => (prev === key ? '' : prev));
    }
  };

  const openBetModal = (draft) => {
    setBetDraft(draft);
    setBetModalOpen(true);
  };

  const openBetModalFromTopBet = (bet) => {
    openBetModal({
      label: `Top Bet #${bet.rank}: ${bet.type}`,
      suggestedType: bet.type,
      suggestedTicket: bet.ticket,
      suggestedStake: bet.stake
    });
  };

  const openBetModalFromTierSuggestion = (entry) => {
    openBetModal({
      label: `${entry.tier} suggestion`,
      suggestedType: entry.tier,
      suggestedTicket: `${entry.horse.name} (${entry.strategy})`,
      focusHorseName: entry.horse.name
    });
  };

  const openBetModalFromHorseInspector = () => {
    if (!selectedRunner) {
      return;
    }
    setInspectorOpen(false);
    openBetModal({
      label: `Horse Inspector: ${selectedRunner.name}`,
      suggestedType: 'Horse Focus',
      suggestedTicket: `${selectedRunner.name} to Win`,
      focusHorseName: selectedRunner.name
    });
  };

  const openHorseInspectorFromJockey = (horseName) => {
    setJockeyInspectorOpen(false);
    setSelectedHorseName(horseName);
    setInspectorOpen(true);
  };

  useEffect(() => {
    if (!jockeyInspectorOpen || !selectedJockey?.jockey) {
      return;
    }
    requestJockeyProfile(selectedJockey.jockey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jockeyInspectorOpen, selectedJockey?.jockey]);

  const inspectorModal =
    inspectorOpen && selectedRunner
      ? createPortal(
          <div
            className="fixed inset-0 z-[2000] px-3 py-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:py-6"
            role="dialog"
            aria-modal="true"
            aria-label={`Horse inspector for ${selectedRunner.name}`}
          >
            <button
              type="button"
              className="absolute inset-0 bg-stone-950/55"
              aria-label="Close horse inspector"
              onClick={() => setInspectorOpen(false)}
            />

            <section
              className="relative mx-auto flex h-[min(92dvh,920px)] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-[#d9c8b1] bg-[var(--bg-surface)] shadow-[0_20px_65px_rgba(0,0,0,0.45)]"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-3 border-b border-[#e4d7c6] bg-[var(--bg-surface)] px-4 py-3 md:px-5">
                <div>
                  <p className="kicker">Horse Inspector</p>
                  <h3 className="text-base font-semibold">{selectedRunner.name}</h3>
                  <p className="text-xs text-stone-600">Full model math, BRISNET effect, and history context.</p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={openBetModalFromHorseInspector}>
                    Add To Bet Slip
                  </button>
                  <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setInspectorOpen(false)}>
                    Close
                  </button>
                </div>
              </header>

              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 pb-6 md:px-5 [touch-action:pan-y]"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="tile">
                    <p className="tile-title">Model Win %</p>
                    <p className="tile-value text-base">{asPercent(selectedRunner.modelProbability)}</p>
                  </div>
                  <div className="tile">
                    <p className="tile-title">Market Win %</p>
                    <p className="tile-value text-base">{asPercent(selectedRunner.marketProbability)}</p>
                  </div>
                  <div className="tile">
                    <p className="tile-title">Model Fair Odds</p>
                    <p className="tile-value text-base">{selectedRunner.fairOdds?.text || 'N/A'}</p>
                  </div>
                  <div className="tile">
                    <p className="tile-title">Value Edge</p>
                    <p
                      className={`tile-value text-base ${Number(selectedRunner.valueEdge) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {asPercent(selectedRunner.valueEdge)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="tile">
                    <p className="text-sm font-semibold text-stone-900">Score Contributions</p>
                    <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                      {selectedContributionRows.map((component) => (
                        <li key={component.key} className="flex items-center justify-between gap-2">
                          <span>
                            {METRIC_LABELS[component.key] || component.key}: {asScore(component.rating)} ×{' '}
                            {asScore(component.weight)}
                          </span>
                          <strong>{asPoints(component.contribution)}</strong>
                        </li>
                      ))}
                      <li className="mt-1 flex items-center justify-between gap-2 border-t border-stone-200 pt-1">
                        <span>
                          Volatility penalty ({asScore(selectedRunner.scoreBreakdown?.base?.volatilityRating)} ×{' '}
                          {asScore(analysis?.modelMeta?.volatilityPenaltyWeight)})
                        </span>
                        <strong>-{asPoints(selectedRunner.scoreBreakdown?.base?.volatilityPenalty)}</strong>
                      </li>
                    </ul>
                  </div>

                  <div className="tile">
                    <p className="text-sm font-semibold text-stone-900">Final Score Equation</p>
                    <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                      <li className="flex items-center justify-between gap-2">
                        <span>Base score</span>
                        <strong>{asPoints(selectedRunner.scoreBreakdown?.base?.baseScore)}</strong>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>Value lift (edge × 100 × {asScore(analysis?.modelMeta?.valueEdgeLiftWeight)})</span>
                        <strong>{asPoints(selectedRunner.scoreBreakdown?.valueLift)}</strong>
                      </li>
                      <li className="flex items-center justify-between gap-2">
                        <span>
                          Stability bonus ({asScore(selectedRunner.scoreBreakdown?.stability?.stabilityIndex)} ×{' '}
                          {asScore(analysis?.modelMeta?.stabilityBonusWeight)})
                        </span>
                        <strong>{asPoints(selectedRunner.scoreBreakdown?.stabilityBonus)}</strong>
                      </li>
                      <li className="mt-1 flex items-center justify-between gap-2 border-t border-stone-200 pt-1">
                        <span>Final score</span>
                        <strong>{asPoints(selectedRunner.scoreBreakdown?.finalScore)}</strong>
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="mt-3 tile">
                  <p className="text-sm font-semibold text-stone-900">BRISNET Effect For This Horse</p>
                  <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                    <li className="flex items-center justify-between gap-2">
                      <span>BRISNET rating input</span>
                      <strong>{asScore(selectedRunner.brisnetSignal)}</strong>
                    </li>
                    <li className="flex items-center justify-between gap-2">
                      <span>Weighted BRISNET contribution ({asScore(brisnetSignalContribution?.weight)})</span>
                      <strong>{asPoints(brisnetSignalContribution?.contribution)}</strong>
                    </li>
                    <li className="flex items-center justify-between gap-2">
                      <span>Score with BRISNET</span>
                      <strong>{asPoints(selectedRunnerImpact?.withBrisnet?.score ?? selectedRunner.score)}</strong>
                    </li>
                    <li className="flex items-center justify-between gap-2">
                      <span>Score without BRISNET (neutral signal=50)</span>
                      <strong>{asPoints(selectedRunnerImpact?.withoutBrisnet?.score)}</strong>
                    </li>
                    <li className="flex items-center justify-between gap-2">
                      <span>Score delta from BRISNET</span>
                      <strong
                        className={`${Number(selectedRunnerImpact?.scoreDelta) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                      >
                        {asPoints(selectedRunnerImpact?.scoreDelta)}
                      </strong>
                    </li>
                    <li className="flex items-center justify-between gap-2">
                      <span>Rank shift from BRISNET</span>
                      <strong
                        className={`${Number(selectedRunnerImpact?.rankDelta) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                      >
                        {Number(selectedRunnerImpact?.rankDelta) > 0 ? '+' : ''}
                        {selectedRunnerImpact?.rankDelta ?? 0}
                      </strong>
                    </li>
                  </ul>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="tile">
                    <p className="text-sm font-semibold text-stone-900">Historical Context</p>
                    <p className="mt-2 text-xs text-stone-700">
                      Narrative: {selectedPresetHorse?.history || 'No preset narrative available.'}
                    </p>
                    <p className="mt-2 text-xs text-stone-700">
                      Recent form array:{' '}
                      {Array.isArray(selectedRaceHorse?.recent_form) && selectedRaceHorse.recent_form.length
                        ? selectedRaceHorse.recent_form.join(', ')
                        : 'No stored recent form values.'}
                    </p>
                    <p className="mt-1 text-xs text-stone-700">
                      Speed figures:{' '}
                      {Array.isArray(selectedRaceHorse?.speed_figures) && selectedRaceHorse.speed_figures.length
                        ? selectedRaceHorse.speed_figures.join(', ')
                        : 'No stored speed figure history.'}
                    </p>
                  </div>

                  <div className="tile">
                    <p className="text-sm font-semibold text-stone-900">What Each Metric Means</p>
                    <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                      {Object.entries(METRIC_MEANINGS).map(([key, meaning]) => (
                        <li key={key}>
                          <strong>{METRIC_LABELS[key] || key}:</strong> {meaning}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </section>
          </div>,
          document.body
        )
      : null;

  const jockeyInspectorModal =
    jockeyInspectorOpen && selectedJockey
      ? createPortal(
          <div
            className="fixed inset-0 z-[2050] px-3 py-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:py-6"
            role="dialog"
            aria-modal="true"
            aria-label={`Jockey inspector for ${selectedJockey.jockey}`}
          >
            <button
              type="button"
              className="absolute inset-0 bg-stone-950/55"
              aria-label="Close jockey inspector"
              onClick={() => setJockeyInspectorOpen(false)}
            />

            <section
              className="relative mx-auto flex h-[min(92dvh,920px)] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-[#d9c8b1] bg-[var(--bg-surface)] shadow-[0_20px_65px_rgba(0,0,0,0.45)]"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-3 border-b border-[#e4d7c6] bg-[var(--bg-surface)] px-4 py-3 md:px-5">
                <div>
                  <p className="kicker">Jockey Inspector</p>
                  <h3 className="text-base font-semibold">{selectedJockey.jockey}</h3>
                  <p className="text-xs text-stone-600">
                    Ride-by-ride model impact for this race card. Tap a horse to open the horse inspector.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary px-3 py-1.5 text-xs"
                    type="button"
                    onClick={() => requestJockeyProfile(selectedJockey.jockey, { force: true })}
                    disabled={isLoadingSelectedJockeyProfile}
                  >
                    {isLoadingSelectedJockeyProfile ? 'Refreshing...' : 'Refresh Profile'}
                  </button>
                  <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setJockeyInspectorOpen(false)}>
                    Close
                  </button>
                </div>
              </header>

              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 pb-6 md:px-5 [touch-action:pan-y]"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="tile">
                    <p className="tile-title">Active Rides</p>
                    <p className="tile-value text-base">{selectedJockey.rides}</p>
                  </div>
                  <div className="tile">
                    <p className="tile-title">Avg Model Win %</p>
                    <p className="tile-value text-base">{asPercent(selectedJockey.avgModelProbability)}</p>
                  </div>
                  <div className="tile">
                    <p className="tile-title">Avg Edge</p>
                    <p className={`tile-value text-base ${Number(selectedJockey.avgEdge) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {asPercent(selectedJockey.avgEdge)}
                    </p>
                  </div>
                  <div className="tile">
                    <p className="tile-title">Top Mount</p>
                    <p className="tile-value text-sm">{selectedJockey.topHorse || 'N/A'}</p>
                  </div>
                </div>

                <div className="mt-3 tile">
                  <p className="text-sm font-semibold text-stone-900">Jockey History Snapshot (Local Data)</p>
                  <p className="mt-1 text-xs text-stone-600">
                    Loaded on-demand and cached for 5 minutes. Not part of auto market refresh.
                  </p>
                  {isLoadingSelectedJockeyProfile ? <p className="mt-2 text-xs text-stone-600">Loading jockey profile...</p> : null}
                  {jockeyProfileError ? <p className="mt-2 text-xs text-rose-700">{jockeyProfileError}</p> : null}
                  {selectedJockeyProfile ? (
                    <div className="mt-2 grid gap-3">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-[#dfcfbb] bg-[#fffaf3] p-2">
                          <p className="tile-title">Local Starts</p>
                          <p className="tile-value text-base">{selectedJockeyProfile.summary?.starts ?? 0}</p>
                        </div>
                        <div className="rounded-xl border border-[#dfcfbb] bg-[#fffaf3] p-2">
                          <p className="tile-title">Races Tracked</p>
                          <p className="tile-value text-base">{selectedJockeyProfile.summary?.races ?? 0}</p>
                        </div>
                        <div className="rounded-xl border border-[#dfcfbb] bg-[#fffaf3] p-2">
                          <p className="tile-title">Win Rate</p>
                          <p className="tile-value text-base">{asPercent(selectedJockeyProfile.summary?.winRate ?? 0)}</p>
                        </div>
                        <div className="rounded-xl border border-[#dfcfbb] bg-[#fffaf3] p-2">
                          <p className="tile-title">ITM Rate</p>
                          <p className="tile-value text-base">{asPercent(selectedJockeyProfile.summary?.itmRate ?? 0)}</p>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-[#dfcfbb] bg-[#fffaf3] p-3">
                          <p className="text-xs font-semibold text-stone-800">Top Trainer Partnerships</p>
                          {(selectedJockeyProfile.topTrainerPartnerships || []).length ? (
                            <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                              {selectedJockeyProfile.topTrainerPartnerships.map((entry) => (
                                <li key={`${selectedJockey.jockey}-${entry.trainer}`} className="flex items-center justify-between gap-2">
                                  <span>{entry.trainer}</span>
                                  <strong>{entry.starts} starts</strong>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-stone-600">No trainer partnership history stored yet.</p>
                          )}
                        </div>

                        <div className="rounded-xl border border-[#dfcfbb] bg-[#fffaf3] p-3">
                          <p className="text-xs font-semibold text-stone-800">Recent Mounts Across Imported Races</p>
                          {(selectedJockeyProfile.recentMounts || []).length ? (
                            <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                              {selectedJockeyProfile.recentMounts.slice(0, 6).map((mount) => (
                                <li key={`mount-${mount.race_id}-${mount.horse_id}`} className="flex items-start justify-between gap-2">
                                  <span>
                                    {mount.horse_name} • {mount.track} R{mount.race_number}
                                  </span>
                                  <strong>{mount.odds || '-'}</strong>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-stone-600">No historical mounts stored yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 tile">
                  <p className="text-sm font-semibold text-stone-900">Rides In This Race</p>
                  {selectedJockeyRides.length ? (
                    <div className="mt-2 grid gap-2">
                      {selectedJockeyRides.map((ride) => (
                        <div key={`${selectedJockey.jockey}-${ride.horseId}`} className="rounded-xl border border-[#dfcfbb] bg-[#fffaf3] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-stone-900">
                                {ride.horseName} (Post {ride.postPosition})
                              </p>
                              <p className="text-xs text-stone-600">
                                Odds {ride.odds} • Score {asScore(ride.score)} • Fair {ride.fairOdds}
                              </p>
                              <p className="text-xs text-stone-500">Market fair {ride.marketFairOdds}</p>
                            </div>
                            <button
                              className="btn-secondary px-3 py-1.5 text-xs"
                              type="button"
                              onClick={() => openHorseInspectorFromJockey(ride.horseName)}
                            >
                              Inspect Horse
                            </button>
                          </div>

                          <div className="mt-2">
                            <ProbabilityBars modelProbability={ride.modelProbability} marketProbability={ride.marketProbability} />
                          </div>

                          <p className="mt-2 text-xs">
                            <span className={Number(ride.valueEdge) >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                              Edge {asPercent(ride.valueEdge)}
                            </span>
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-stone-600">No active rides found for this jockey in the selected race.</p>
                  )}
                </div>
              </div>
            </section>
          </div>,
          document.body
        )
      : null;

  if (loading) {
    return <section className="panel">Loading algorithm workspace...</section>;
  }

  if (!races.length) {
    return (
      <section className="panel">
        <h2 className="page-title">Algorithm Systems</h2>
        <p className="mt-2 text-sm text-stone-600">No races are imported yet.</p>
      </section>
    );
  }

  return (
    <>
      <section className="grid gap-4">
      <article className="panel">
        <p className="kicker">Model Control</p>
        <h2 className="page-title mt-1">Algorithm Systems</h2>
        <p className="mt-1 text-sm text-stone-600">
          Presets plus live Equibase cards auto-import for {todayKey} and {tomorrowKey}. Tap any horse tile to inspect
          exact math and historical context.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="tile">
            <p className="tile-title">Imported Races</p>
            <p className="tile-value">{races.length}</p>
          </div>
          <div className="tile">
            <p className="tile-title">Filtered Day</p>
            <p className="tile-value text-base capitalize">{dayMode}</p>
          </div>
          <div className="tile">
            <p className="tile-title">Selected Race</p>
            <p className="tile-value text-base">{selectedRace?.race_number ? `#${selectedRace.race_number}` : '-'}</p>
          </div>
          <div className="tile">
            <p className="tile-title">Bankroll Sim</p>
            <p className="tile-value">${Number(bankroll || 0).toFixed(0)}</p>
          </div>
          <div className="tile">
            <p className="tile-title">Last Live Update</p>
            <p className="tile-value text-sm">{formatTimestamp(lastLiveUpdateAt)}</p>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr),minmax(0,1fr),auto,auto] lg:items-end">
          <label className="text-xs text-stone-600">
            Race Day
            <div className="mt-1 grid grid-cols-2 rounded-xl border border-[#d9c8b1] p-1">
              <button
                type="button"
                onClick={() => setDayMode('today')}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                  dayMode === 'today' ? 'accent-band text-white' : 'text-stone-700'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setDayMode('tomorrow')}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                  dayMode === 'tomorrow' ? 'accent-band text-white' : 'text-stone-700'
                }`}
              >
                Tomorrow
              </button>
            </div>
          </label>

          <label className="text-xs text-stone-600">
            Race
            <select className="input mt-1" value={selectedRace?.id ?? ''} onChange={onRaceChange}>
              {filteredRaces.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.track} #{entry.race_number || '-'})
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-stone-600">
            Bankroll ($)
            <input
              className="input mt-1"
              type="number"
              min="10"
              step="10"
              value={bankroll}
              onChange={(event) => setBankroll(Number(event.target.value) || 100)}
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-[#d9c8b1] px-3 py-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Auto refresh
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-secondary" type="button" onClick={refreshMarket} disabled={refreshingMarket}>
            {refreshingMarket ? 'Refreshing...' : 'Refresh Market'}
          </button>
          <button className="btn-primary" type="button" onClick={onRecalculate}>
            Recalculate
          </button>
          {selectedRace ? (
            <>
              <Link className="btn-secondary" to={`/races/${selectedRace.id}`}>
                View Card
              </Link>
              <Link className="btn-secondary" to={`/races/${selectedRace.id}/bet`}>
                Bet This Race
              </Link>
            </>
          ) : null}
        </div>

        <p className="mt-2 text-sm text-stone-600">{status}</p>
        <p className="mt-1 text-xs text-stone-500">
          Live refresh runs every 15 seconds when auto refresh is enabled. Last update: {formatTimestamp(lastLiveUpdateAt)}.
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Last attempt: {formatTimestamp(lastRefreshAttemptAt)} ({formatTimeAgo(lastRefreshAttemptAt, nowMs)}). Last success:{' '}
          {formatTimestamp(lastRefreshSuccessAt)} ({formatTimeAgo(lastRefreshSuccessAt, nowMs)}).
        </p>
        {autoRefresh && Number.isInteger(secondsUntilNextRefresh) ? (
          <p className="mt-1 text-xs text-stone-500">Next auto refresh in ~{secondsUntilNextRefresh}s.</p>
        ) : null}
        {lastRefreshSummary ? (
          <p className="mt-1 text-xs text-stone-500">
            Last payload changes: odds {lastRefreshSummary.odds}, signals {lastRefreshSummary.signals}, scratches{' '}
            {lastRefreshSummary.scratches}, warnings {lastRefreshSummary.warnings}.
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      </article>

      {race ? (
        <article className="panel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">{race.name}</h3>
              <p className="text-xs text-stone-600">
                {race.track} • Race {race.race_number || '-'} • {race.distance || 'Distance TBD'} •{' '}
                {race.class || 'Class TBD'}
              </p>
            </div>
            <span className={`status-chip status-${race.status}`}>{race.status}</span>
          </div>

          <p className="mt-2 text-xs text-stone-500">Tap a horse to open a full-screen inspector.</p>
          <p className="mt-1 text-xs text-stone-500">
            Model ranking shows active horses only: {activeHorseCount} of {totalHorseCount}.
          </p>
          {Array.isArray(race.horses) && race.horses.some((horse) => Number(horse.scratched)) ? (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              <p className="font-semibold">Scratched horses</p>
              <ul className="mt-1 grid gap-1">
                {race.horses
                  .filter((horse) => Number(horse.scratched))
                  .map((horse) => (
                    <li key={`scratched-${horse.id}`}>
                      {horse.name}
                      {horse.jockey ? ` • Jockey: ${horse.jockey}` : ''}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2">
            {rankedWithPosts.map((runner) => {
              const selected = normalizeHorseName(runner.name) === normalizeHorseName(selectedRunner?.name);
              return (
                <button
                  key={runner.name}
                  type="button"
                  className={`tile text-left transition ${selected ? 'ring-2 ring-[var(--accent-main)]' : 'hover:bg-[#fbf4ec]'}`}
                  onClick={() => openInspectorForHorse(runner.name)}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-stone-900">
                        #{runner.rank} {runner.name}
                      </p>
                      <p className="text-xs text-stone-600">
                        Post {runner.postPosition} • Odds {runner.odds || '-'} • Score {asScore(runner.score)}
                      </p>
                      <p className="text-xs text-stone-500">
                        Fair odds: {runner.fairOdds?.text || 'N/A'} • Market implied: {runner.marketFairOdds?.text || 'N/A'}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                        Number(runner.valueEdge) >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      Edge {asPercent(runner.valueEdge)}
                    </span>
                  </div>
                  <ProbabilityBars modelProbability={runner.modelProbability} marketProbability={runner.marketProbability} />
                </button>
              );
            })}
          </div>
        </article>
      ) : null}

      <article className="panel">
        <h3 className="text-base font-semibold">Jockey Analysis</h3>
        {jockeyAnalysis.length ? (
          <div className="mt-3 grid gap-2">
            {jockeyAnalysis.map((row) => (
              <button
                key={row.jockey}
                type="button"
                className="tile w-full text-left transition hover:bg-[#fbf4ec]"
                onClick={() => openInspectorForJockey(row.jockey)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900">{row.jockey}</p>
                    <p className="text-xs text-stone-600">
                      Rides: {row.rides} • Top mount: {row.topHorse || 'N/A'}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                      Number(row.avgEdge) >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    Avg edge {asPercent(row.avgEdge)}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-stone-600">
                    <span>Avg model win probability</span>
                    <span>{asPercent(row.avgModelProbability)}</span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{ width: `${Math.max(4, Math.min(100, Number(row.avgModelProbability || 0) * 100))}%` }}
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs font-semibold text-[var(--accent-main)]">Tap for jockey details</p>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-stone-600">
            No jockey data yet for this race import. Live Equibase import will populate jockey names where available.
          </p>
        )}
      </article>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="panel">
          <h3 className="text-base font-semibold">Top Five Bets</h3>
          <ul className="mt-3 grid gap-2 text-sm">
            {(analysis?.topBets || []).map((bet) => (
              <li key={`${bet.rank}-${bet.ticket}`}>
                <button type="button" className="tile w-full text-left transition hover:bg-[#fbf4ec]" onClick={() => openBetModalFromTopBet(bet)}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">
                      #{bet.rank} {bet.type}
                    </p>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                        riskToneClasses[bet.risk] || 'bg-stone-100 text-stone-700'
                      }`}
                    >
                      {bet.risk}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-stone-700">{bet.ticket}</p>
                  <p className="mt-1 text-xs text-stone-500">Stake: {bet.stake} • Tap to place</p>
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h3 className="text-base font-semibold">Undercover Winner</h3>
          {analysis?.undercoverWinner ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">{analysis.undercoverWinner.name}</p>
              <p className="mt-1 text-xs text-stone-700">
                Odds {analysis.undercoverWinner.odds || '-'} • Model edge {asPercent(analysis.undercoverWinner.valueEdge)}
              </p>
              <p className="mt-2 text-xs text-stone-600">
                Dark horse profile from value edge, late kick, and improving trend.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-stone-500">No sleeper available for the current field size.</p>
          )}

          <h4 className="mt-4 text-sm font-semibold text-stone-800">Algorithm vs Opposition Slips</h4>
          <div className="mt-2 grid gap-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Algorithm Slip</p>
              <ul className="mt-2 grid gap-1 text-sm">
                {(analysis?.topBets || []).slice(0, 3).map((bet) => (
                  <li key={`algo-${bet.rank}`}>
                    {bet.type}: {bet.ticket}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Opposition Slip</p>
              <ul className="mt-2 grid gap-1 text-sm">
                {(analysis?.counterBets || []).slice(0, 3).map((bet) => (
                  <li key={`counter-${bet.type}`}>
                    {bet.type}: {bet.ticket}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>
      </section>

      <article className="panel">
        <h3 className="text-base font-semibold">Three-Tier Suggestions</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {(analysis?.tierSuggestions || []).map((entry) => (
            <button
              key={entry.tier}
              type="button"
              className={`rounded-xl border p-3 text-left text-sm transition hover:bg-[#fbf4ec] ${tierToneClasses[entry.tier] || 'border-stone-200 bg-white'}`}
              onClick={() => openBetModalFromTierSuggestion(entry)}
            >
              <p className="font-semibold">{entry.tier}</p>
              <p className="mt-1">
                {entry.horse.name} ({entry.horse.odds || '-'})
              </p>
              <div className="mt-2 grid gap-1 text-xs text-stone-700">
                <p>Model: {asPercent(entry.horse.modelProbability)}</p>
                <p>Market: {asPercent(entry.horse.marketProbability)}</p>
                <p>Edge: {asPercent(entry.horse.valueEdge)}</p>
              </div>
              <p className="mt-2 text-xs text-stone-700">{entry.strategy}</p>
              <p className="mt-2 text-xs font-semibold text-[var(--accent-main)]">Tap to place</p>
            </button>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3 className="text-base font-semibold">BRISNET Impact Comparison</h3>
        {analysis?.brisnetImpact ? (
          <div className="mt-3 grid gap-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="tile">
                <p className="tile-title">Boosted Horses</p>
                <p className="tile-value text-base">{analysis.brisnetImpact.summary?.positiveScoreDeltaCount ?? 0}</p>
              </div>
              <div className="tile">
                <p className="tile-title">Reduced Horses</p>
                <p className="tile-value text-base">{analysis.brisnetImpact.summary?.negativeScoreDeltaCount ?? 0}</p>
              </div>
              <div className="tile">
                <p className="tile-title">Unchanged</p>
                <p className="tile-value text-base">{analysis.brisnetImpact.summary?.unchangedScoreDeltaCount ?? 0}</p>
              </div>
            </div>

            <div className="tile">
              <p className="text-sm font-semibold text-stone-900">Top Movers (With vs Without BRISNET)</p>
              <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                {(analysis.brisnetImpact.topMovers || []).map((entry) => (
                  <li key={`impact-${entry.name}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {entry.name} • Rank {entry.withBrisnet.rank} vs {entry.withoutBrisnet.rank}
                    </span>
                    <span
                      className={`font-semibold ${Number(entry.scoreDelta) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      Score delta {asPoints(entry.scoreDelta)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-stone-600">No BRISNET impact comparison available yet.</p>
        )}
      </article>

      <article className="panel">
        <h3 className="text-base font-semibold">Market Intelligence</h3>
        {brisnetIntel || scratchesIntel ? (
          <div className="mt-2 grid gap-2 text-sm text-stone-700">
            {brisnetIntel ? (
              <>
                <p>
                  Spot Play:{' '}
                  {brisnetIntel.spotPlay
                    ? `${brisnetIntel.spotPlay.horseName} (Race ${brisnetIntel.spotPlay.raceNumber}, quoted ${brisnetIntel.spotPlay.quotedOdds})`
                    : 'No spot play matched this selected race.'}
                </p>
                <p>
                  Optix Matches:{' '}
                  {Array.isArray(brisnetIntel.optixSelections) && brisnetIntel.optixSelections.length
                    ? brisnetIntel.optixSelections.join(', ')
                    : 'None returned for this race.'}
                </p>
                <p>
                  Field match quality: spot-play match{' '}
                  {brisnetIntel.diagnostics?.matching?.spotPlayMatchedFieldHorse ? 'yes' : 'no'} • Optix matched{' '}
                  {Number(brisnetIntel.diagnostics?.matching?.optixMatchedFieldCount || 0)}
                </p>
                {Array.isArray(brisnetIntel.diagnostics?.matching?.optixUrlRaceHints) &&
                brisnetIntel.diagnostics.matching.optixUrlRaceHints.length ? (
                  <p>
                    Optix URL race hints: {brisnetIntel.diagnostics.matching.optixUrlRaceHints.join(', ')}{' '}
                    {brisnetIntel.diagnostics.matching.optixUrlLooksMismatched ? '(mismatch with selected race)' : ''}
                  </p>
                ) : null}
                {Array.isArray(brisnetIntel.diagnostics?.matching?.unmatchedOptixSelections) &&
                brisnetIntel.diagnostics.matching.unmatchedOptixSelections.length ? (
                  <p>
                    Unmatched Optix selections: {brisnetIntel.diagnostics.matching.unmatchedOptixSelections.join(', ')}
                  </p>
                ) : null}
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-2 text-xs text-stone-700">
                  <p className="font-semibold">BRISNET diagnostics</p>
                  <p>
                    Spot Plays: {brisnetIntel.diagnostics?.requests?.spotPlays?.ok ? 'ok' : 'not ok'} (
                    {brisnetIntel.diagnostics?.requests?.spotPlays?.status ?? 'n/a'})
                  </p>
                  {brisnetIntel.diagnostics?.requests?.spotPlays?.preview ? (
                    <p>Spot preview: {brisnetIntel.diagnostics.requests.spotPlays.preview}</p>
                  ) : null}
                  <p>
                    Optix: {brisnetIntel.diagnostics?.requests?.optix?.ok ? 'ok' : 'not ok'} (
                    {brisnetIntel.diagnostics?.requests?.optix?.status ?? 'n/a'})
                  </p>
                  {brisnetIntel.diagnostics?.requests?.optix?.preview ? (
                    <p>Optix preview: {brisnetIntel.diagnostics.requests.optix.preview}</p>
                  ) : null}
                </div>
              </>
            ) : null}

            {scratchesIntel ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                <p className="font-semibold">Equibase scratches</p>
                <p>
                  Race {scratchesIntel.raceNumber || '-'} scratches:{' '}
                  {Array.isArray(scratchesIntel.scratchesForRace) && scratchesIntel.scratchesForRace.length
                    ? scratchesIntel.scratchesForRace.join(', ')
                    : 'none listed'}
                </p>
                <p>
                  Feed status: {scratchesIntel.diagnostics?.ok ? 'ok' : 'not ok'} (
                  {scratchesIntel.diagnostics?.status ?? 'n/a'})
                </p>
                {scratchesIntel.diagnostics?.updatedLine ? <p>{scratchesIntel.diagnostics.updatedLine}</p> : null}
                {scratchesIntel.diagnostics?.preview ? <p>Preview: {scratchesIntel.diagnostics.preview}</p> : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-stone-600">
            Waiting on live market payload. Use Refresh Market if you want to force an immediate update.
          </p>
        )}
      </article>

      <article className="panel">
        <h3 className="text-base font-semibold">Sources Used</h3>
        <ul className="mt-3 grid gap-3 text-sm">
          {(race?.sources || []).map((source) => (
            <li key={source.url} className="tile">
              <a
                className="font-semibold text-[var(--accent-main)] underline"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {source.title}
              </a>
              <p className="mt-1 text-xs text-stone-600">{source.usedFor}</p>
            </li>
          ))}
        </ul>
      </article>
      </section>
      {inspectorModal}
      {jockeyInspectorModal}
      <BetPlacementModal
        isOpen={betModalOpen}
        race={race}
        draft={betDraft}
        onClose={() => setBetModalOpen(false)}
        onBetPlaced={(result) => {
          setStatus(`Bet placed from algorithm modal. New balance: $${Number(result.user_balance || 0).toFixed(2)}.`);
        }}
      />
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import BetPlacementModal from '../components/BetPlacementModal.jsx';

const asPercent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const asScore = (value) => Number(value || 0).toFixed(1);
const asPoints = (value) => Number(value || 0).toFixed(3);
const pad = (value) => String(value).padStart(2, '0');
const normalizeHorseName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
  const [dayMode, setDayMode] = useState('today');
  const [loading, setLoading] = useState(true);
  const [refreshingMarket, setRefreshingMarket] = useState(false);
  const [brisnetIntel, setBrisnetIntel] = useState(null);
  const [scratchesIntel, setScratchesIntel] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Waiting for first refresh.');
  const [selectedHorseName, setSelectedHorseName] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [betModalOpen, setBetModalOpen] = useState(false);
  const [betDraft, setBetDraft] = useState(null);
  const [presetHistoryByExternalRaceId, setPresetHistoryByExternalRaceId] = useState({});
  const marketPrimedRaceIdsRef = useRef(new Set());

  const selectedRaceId = Number(searchParams.get('raceId') || 0);

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

  const selectedRace = useMemo(
    () => filteredRaces.find((entry) => entry.id === selectedRaceId) ?? filteredRaces[0] ?? null,
    [filteredRaces, selectedRaceId]
  );

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
    setRace(row);
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
    setAnalysis({
      ranked,
      rankedWithoutBrisnet,
      brisnetImpact,
      undercoverWinner,
      topBets,
      counterBets,
      tierSuggestions,
      modelMeta
    });
  };

  const autoImportTodayTomorrow = async () => {
    const { presets } = await api.listRacePresets();
    const targetDateKeys = new Set([todayKey, tomorrowKey]);

    const presetHorseByRace = {};
    for (const preset of presets) {
      const horsesByName = {};
      for (const horse of preset.horses || []) {
        horsesByName[normalizeHorseName(horse.name)] = horse;
      }
      presetHorseByRace[preset.id] = horsesByName;
    }
    setPresetHistoryByExternalRaceId(presetHorseByRace);

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
        dates: [todayKey, tomorrowKey]
      });
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
    if (!filteredRaces.length) {
      return;
    }

    if (!filteredRaces.some((entry) => entry.id === selectedRaceId)) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('raceId', String(filteredRaces[0].id));
        return next;
      });
    }
  }, [filteredRaces, selectedRaceId, setSearchParams]);

  useEffect(() => {
    if (!selectedRace) {
      return;
    }

    const sync = async () => {
      setError('');
      try {
        await loadRaceDetail(selectedRace.id);
        await runAnalysis(selectedRace.id, bankroll);
      } catch (err) {
        setError(err.message);
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
    if (!autoRefresh || !selectedRace) {
      return undefined;
    }

    const timer = setInterval(() => {
      refreshMarket();
    }, 15000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, selectedRace?.id, bankroll]);

  const modalOpen = inspectorOpen || betModalOpen;

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
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, betModalOpen, inspectorOpen]);

  useEffect(() => {
    if (!race?.id) {
      return;
    }

    if (marketPrimedRaceIdsRef.current.has(race.id)) {
      return;
    }

    const hasRaceConfig = race.race_config && typeof race.race_config === 'object';
    const hasBrisnetConfig = race.brisnet_config && typeof race.brisnet_config === 'object';

    if (!hasRaceConfig && !hasBrisnetConfig) {
      setBrisnetIntel(null);
      setStatus('This race has no live market or BRISNET source config.');
      marketPrimedRaceIdsRef.current.add(race.id);
      return;
    }

    marketPrimedRaceIdsRef.current.add(race.id);
    refreshMarket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race?.id]);

  const refreshMarket = async () => {
    if (!selectedRace || refreshingMarket) {
      return;
    }

    setRefreshingMarket(true);
    setError('');
    setStatus('Refreshing live odds and BRISNET signals...');

    try {
      const payload = await api.refreshRaceMarket(selectedRace.id, bankroll);
      await loadRaceDetail(selectedRace.id);
      setAnalysis(payload.analysis);
      setBrisnetIntel(payload.market?.brisnet ?? null);
      setScratchesIntel(payload.market?.scratches ?? null);
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
      setError(err.message);
      setStatus('Refresh failed.');
    } finally {
      setRefreshingMarket(false);
    }
  };

  const onRaceChange = (event) => {
    const raceId = Number(event.target.value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('raceId', String(raceId));
      return next;
    });
    setBrisnetIntel(null);
    setScratchesIntel(null);
  };

  const onRecalculate = async () => {
    if (!selectedRace) {
      return;
    }

    try {
      setError('');
      await runAnalysis(selectedRace.id, bankroll);
      setStatus('Analysis recalculated.');
    } catch (err) {
      setError(err.message);
    }
  };

  const openInspectorForHorse = (horseName) => {
    setSelectedHorseName(horseName);
    setInspectorOpen(true);
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
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
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
        <p className="mt-1 text-xs text-stone-500">Live refresh runs every 15 seconds when auto refresh is enabled.</p>
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
          {Array.isArray(race.horses) && race.horses.some((horse) => Number(horse.scratched)) ? (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
              <p className="font-semibold">Scratched horses</p>
              <p className="mt-1">
                {race.horses
                  .filter((horse) => Number(horse.scratched))
                  .map((horse) => horse.name)
                  .join(', ')}
              </p>
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
              <div key={row.jockey} className="tile">
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
              </div>
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

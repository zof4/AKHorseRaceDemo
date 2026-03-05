import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';

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
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [dayMode, setDayMode] = useState('today');
  const [loading, setLoading] = useState(true);
  const [refreshingMarket, setRefreshingMarket] = useState(false);
  const [brisnetIntel, setBrisnetIntel] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Waiting for first refresh.');
  const [selectedHorseName, setSelectedHorseName] = useState('');
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
      return;
    }

    await api.importRacePresets({});
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
    }, 60000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, selectedRace?.id, bankroll]);

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
      setStatus(
        `Market refreshed: odds ${payload.updated.odds}, signals ${payload.updated.signals} at ${new Date(
          payload.fetchedAt
        ).toLocaleTimeString()}.`
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
    <section className="grid gap-4">
      <article className="panel">
        <p className="kicker">Model Control</p>
        <h2 className="page-title mt-1">Algorithm Systems</h2>
        <p className="mt-1 text-sm text-stone-600">
          Race presets auto-import for {todayKey} and {tomorrowKey}. Tap any horse tile to inspect exact math and
          historical context.
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

          <p className="mt-2 text-xs text-stone-500">Tap a horse to inspect full scoring breakdown.</p>
          <div className="mt-3 grid gap-2">
            {rankedWithPosts.map((runner) => {
              const selected = normalizeHorseName(runner.name) === normalizeHorseName(selectedRunner?.name);
              return (
                <button
                  key={runner.name}
                  type="button"
                  className={`tile text-left transition ${selected ? 'ring-2 ring-[var(--accent-main)]' : 'hover:bg-[#fbf4ec]'}`}
                  onClick={() => setSelectedHorseName(runner.name)}
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

      {selectedRunner ? (
        <article className="panel">
          <h3 className="text-base font-semibold">Horse Inspector: {selectedRunner.name}</h3>
          <p className="mt-1 text-xs text-stone-600">
            This panel shows exactly how the algorithm scored this horse and how that becomes assigned fair odds.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
              <p className={`tile-value text-base ${Number(selectedRunner.valueEdge) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {asPercent(selectedRunner.valueEdge)}
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="tile">
              <p className="text-sm font-semibold text-stone-900">Score Contributions</p>
              <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                {selectedContributionRows.map((component) => (
                  <li key={component.key} className="flex items-center justify-between gap-2">
                    <span>
                      {METRIC_LABELS[component.key] || component.key}: {asScore(component.rating)} × {asScore(component.weight)}
                    </span>
                    <strong>{asPoints(component.contribution)}</strong>
                  </li>
                ))}
                <li className="mt-1 flex items-center justify-between gap-2 border-t border-stone-200 pt-1">
                  <span>Volatility penalty ({asScore(selectedRunner.scoreBreakdown?.base?.volatilityRating)} × {asScore(analysis?.modelMeta?.volatilityPenaltyWeight)})</span>
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
                  <span>Stability bonus ({asScore(selectedRunner.scoreBreakdown?.stability?.stabilityIndex)} × {asScore(analysis?.modelMeta?.stabilityBonusWeight)})</span>
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
                  className={`${
                    Number(selectedRunnerImpact?.scoreDelta) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {asPoints(selectedRunnerImpact?.scoreDelta)}
                </strong>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span>Rank shift from BRISNET</span>
                <strong
                  className={`${
                    Number(selectedRunnerImpact?.rankDelta) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {Number(selectedRunnerImpact?.rankDelta) > 0 ? '+' : ''}
                  {selectedRunnerImpact?.rankDelta ?? 0}
                </strong>
              </li>
            </ul>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="tile">
              <p className="text-sm font-semibold text-stone-900">Historical Context</p>
              <p className="mt-2 text-xs text-stone-700">
                Narrative: {selectedPresetHorse?.history || 'No preset narrative available.'}
              </p>
              <p className="mt-2 text-xs text-stone-700">
                Recent form array: {Array.isArray(selectedRaceHorse?.recent_form) && selectedRaceHorse.recent_form.length
                  ? selectedRaceHorse.recent_form.join(', ')
                  : 'No stored recent form values.'}
              </p>
              <p className="mt-1 text-xs text-stone-700">
                Speed figures: {Array.isArray(selectedRaceHorse?.speed_figures) && selectedRaceHorse.speed_figures.length
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
        </article>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="panel">
          <h3 className="text-base font-semibold">Top Five Bets</h3>
          <ul className="mt-3 grid gap-2 text-sm">
            {(analysis?.topBets || []).map((bet) => (
              <li key={`${bet.rank}-${bet.ticket}`} className="tile">
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
                <p className="mt-1 text-xs text-stone-500">Stake: {bet.stake}</p>
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
            <div
              key={entry.tier}
              className={`rounded-xl border p-3 text-sm ${tierToneClasses[entry.tier] || 'border-stone-200 bg-white'}`}
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
            </div>
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
        {brisnetIntel ? (
          <div className="mt-2 grid gap-2 text-sm text-stone-700">
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
            {Array.isArray(brisnetIntel.diagnostics?.matching?.unmatchedOptixSelections) &&
            brisnetIntel.diagnostics.matching.unmatchedOptixSelections.length ? (
              <p>
                Unmatched Optix selections: {brisnetIntel.diagnostics.matching.unmatchedOptixSelections.join(', ')}
              </p>
            ) : null}
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-2 text-xs text-stone-700">
              <p className="font-semibold">Fetch diagnostics</p>
              <p>
                Spot Plays: {brisnetIntel.diagnostics?.requests?.spotPlays?.ok ? 'ok' : 'not ok'} (
                {brisnetIntel.diagnostics?.requests?.spotPlays?.status ?? 'n/a'})
              </p>
              <p>
                Optix: {brisnetIntel.diagnostics?.requests?.optix?.ok ? 'ok' : 'not ok'} (
                {brisnetIntel.diagnostics?.requests?.optix?.status ?? 'n/a'})
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-stone-600">
            {race?.brisnet_config
              ? 'Waiting on BRISNET payload. Use Refresh Market if you want to force an immediate update.'
              : 'No BRISNET source configured for this race preset.'}
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
  );
}

export const raceMeta = {
  name: 'Oaklawn Park Race 6',
  date: 'Friday, March 6, 2026',
  distance: '1 1/16 Miles',
  class: 'Allowance',
  purse: '$131,000'
};

export const liveRaceConfig = {
  trackSlug: 'oaklawn-park',
  year: 2026,
  month: 3,
  day: 6,
  raceNumber: 6,
  refreshSeconds: 60
};

export const raceSources = [
  {
    title: 'BettingNews race page (Oaklawn R6, Mar 6, 2026)',
    url: 'https://horses.bettingnews.com/oaklawn-park/2026/3/6/6',
    usedFor: 'Race-level odds context and profile snapshots'
  },
  {
    title: 'OddsDigger Oaklawn race card (Mar 6, 2026)',
    url: 'https://oddsdigger.com/horse-racing/oaklawn-park-21165841',
    usedFor: 'Field confirmation and market snapshot'
  }
];

export const defaultHorses = [
  {
    name: 'Expect The Best',
    odds: '3/1',
    speed: 90,
    form: 86,
    class: 88,
    paceFit: 80,
    distanceFit: 84,
    connections: 83,
    consistency: 84,
    volatility: 36,
    lateKick: 70,
    improvingTrend: 80,
    brisnetSignal: 50,
    history: 'Strong profile horse in race-page metrics.'
  },
  {
    name: 'Morunning',
    odds: '7/2',
    speed: 88,
    form: 84,
    class: 86,
    paceFit: 72,
    distanceFit: 79,
    connections: 85,
    consistency: 82,
    volatility: 40,
    lateKick: 65,
    improvingTrend: 78,
    brisnetSignal: 50,
    history: 'Consistent profile with recent race-line evidence.'
  },
  {
    name: 'Carolo Rapido',
    odds: '9/2',
    speed: 86,
    form: 87,
    class: 85,
    paceFit: 77,
    distanceFit: 82,
    connections: 78,
    consistency: 80,
    volatility: 34,
    lateKick: 76,
    improvingTrend: 79,
    brisnetSignal: 50,
    history: 'Competitive profile and historical entry support.'
  }
];

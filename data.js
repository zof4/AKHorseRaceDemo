const baseSources = [
  {
    title: "BRISNET Spot Plays (March 5, 2026)",
    url: "https://www.brisnet.com/racing/spot-plays/spot-plays-march-5-2026/",
    usedFor: "Oaklawn race-specific selections (R3 and R7), horse names, and quoted morning-line prices"
  },
  {
    title: "BRISNET OptixPLOT (Oaklawn races 2 and 9, March 5)",
    url: "https://www.brisnet.com/racing/news/optixplot-for-oaklawn-race-2-9-march-5/",
    usedFor: "Supplemental BRISNET race intelligence and tactical notes"
  },
  {
    title: "BRISNET Oaklawn At A Glance",
    url: "https://www.brisnet.com/content/2026/01/oaklawn-park-at-a-glance-january-5-2026/",
    usedFor: "Track profile and pace/bias context"
  }
];

export const racePresets = [
  {
    id: "oaklawn-2026-03-05-r3",
    label: "Oaklawn Today (Mar 5) - Race 3",
    meta: {
      name: "Oaklawn Park Race 3",
      date: "Thursday, March 5, 2026",
      distance: "1 Mile",
      class: "Claiming",
      purse: "$30,000"
    },
    raceConfig: {
      trackSlug: "oaklawn-park",
      year: 2026,
      month: 3,
      day: 5,
      raceNumber: 3,
      refreshSeconds: 60
    },
    brisnetConfig: {
      trackName: "Oaklawn Park",
      raceNumber: 3,
      spotPlaysUrl: "https://www.brisnet.com/racing/spot-plays/spot-plays-march-5-2026/",
      optixUrl: "https://www.brisnet.com/racing/news/optixplot-for-oaklawn-race-2-9-march-5/"
    },
    sources: [
      ...baseSources,
      {
        title: "BettingNews Oaklawn R3 (Mar 5, 2026)",
        url: "https://horses.bettingnews.com/oaklawn-park/2026/3/5/3",
        usedFor: "Full race field, odds context, and profile stats"
      },
      {
        title: "Equibase horse-history snapshot (Right On Right On line)",
        url: "https://mobile.equibase.com/html/resultsOP2026011707.html",
        usedFor: "Historical race-line context for today field"
      }
    ],
    horses: [
      { name: "Rebelious", odds: "5/2", speed: 86, form: 84, class: 82, paceFit: 79, distanceFit: 81, connections: 78, consistency: 77, volatility: 42, lateKick: 68, improvingTrend: 74, brisnetSignal: 54, history: "Short-priced contender on race-day board." },
      { name: "Jacks Spring Break", odds: "19/1", speed: 70, form: 68, class: 69, paceFit: 72, distanceFit: 71, connections: 70, consistency: 62, volatility: 61, lateKick: 65, improvingTrend: 62, brisnetSignal: 46, history: "Long-shot profile with higher variance." },
      { name: "Right On Right On", odds: "7/1", speed: 78, form: 76, class: 77, paceFit: 81, distanceFit: 79, connections: 74, consistency: 72, volatility: 51, lateKick: 70, improvingTrend: 70, brisnetSignal: 52, history: "Middle-price horse with usable tactical pace." },
      { name: "Hawks Creek", odds: "3/1", speed: 85, form: 82, class: 83, paceFit: 83, distanceFit: 80, connections: 79, consistency: 78, volatility: 44, lateKick: 69, improvingTrend: 73, brisnetSignal: 53, history: "Near top of market with reliable profile stats." },
      { name: "Sound Of Victory", odds: "5/1", speed: 81, form: 80, class: 79, paceFit: 80, distanceFit: 78, connections: 76, consistency: 75, volatility: 45, lateKick: 74, improvingTrend: 77, brisnetSignal: 80, history: "BRISNET Spot Play horse for Oaklawn Race 3." },
      { name: "Frost Alert", odds: "7/1", speed: 77, form: 75, class: 76, paceFit: 78, distanceFit: 77, connections: 73, consistency: 71, volatility: 52, lateKick: 68, improvingTrend: 70, brisnetSignal: 50, history: "Market mid-tier with balanced profile." },
      { name: "Black White N Gold", odds: "11/1", speed: 73, form: 71, class: 72, paceFit: 76, distanceFit: 74, connections: 72, consistency: 67, volatility: 58, lateKick: 72, improvingTrend: 68, brisnetSignal: 48, history: "Live outsider; can hit underneath exotics." },
      { name: "Track Ranger", odds: "2/1", speed: 88, form: 85, class: 84, paceFit: 82, distanceFit: 82, connections: 80, consistency: 80, volatility: 39, lateKick: 66, improvingTrend: 75, brisnetSignal: 55, history: "One of the shortest market prices in this race." },
      { name: "Lea Me Be", odds: "29/1", speed: 66, form: 64, class: 65, paceFit: 70, distanceFit: 69, connections: 68, consistency: 58, volatility: 67, lateKick: 62, improvingTrend: 60, brisnetSignal: 43, history: "Deep long-shot; needs pace collapse." },
      { name: "Hard To Fathom", odds: "14/1", speed: 71, form: 70, class: 71, paceFit: 74, distanceFit: 72, connections: 69, consistency: 64, volatility: 59, lateKick: 67, improvingTrend: 65, brisnetSignal: 45, history: "Price horse with moderate upside." },
      { name: "Texas Holdem", odds: "19/1", speed: 69, form: 67, class: 68, paceFit: 71, distanceFit: 70, connections: 67, consistency: 61, volatility: 62, lateKick: 63, improvingTrend: 61, brisnetSignal: 44, history: "Outsider on current board." }
    ]
  },
  {
    id: "oaklawn-2026-03-05-r7",
    label: "Oaklawn Today (Mar 5) - Race 7",
    meta: {
      name: "Oaklawn Park Race 7",
      date: "Thursday, March 5, 2026",
      distance: "1 1/16 Miles",
      class: "Stakes",
      purse: "$70,000"
    },
    raceConfig: {
      trackSlug: "oaklawn-park",
      year: 2026,
      month: 3,
      day: 5,
      raceNumber: 7,
      refreshSeconds: 60
    },
    brisnetConfig: {
      trackName: "Oaklawn Park",
      raceNumber: 7,
      spotPlaysUrl: "https://www.brisnet.com/racing/spot-plays/spot-plays-march-5-2026/",
      optixUrl: "https://www.brisnet.com/racing/news/optixplot-for-oaklawn-race-2-9-march-5/"
    },
    sources: [
      ...baseSources,
      {
        title: "BettingNews Oaklawn R7 (Mar 5, 2026)",
        url: "https://horses.bettingnews.com/oaklawn-park/2026/3/5/7",
        usedFor: "Field and morning-line context for this stakes race"
      }
    ],
    horses: [
      { name: "Saudi Crown", odds: "4/5", speed: 94, form: 92, class: 93, paceFit: 90, distanceFit: 92, connections: 90, consistency: 90, volatility: 28, lateKick: 76, improvingTrend: 82, brisnetSignal: 57, history: "Strong market favorite and high-class profile." },
      { name: "Money Supply", odds: "14/1", speed: 76, form: 74, class: 75, paceFit: 77, distanceFit: 76, connections: 74, consistency: 69, volatility: 57, lateKick: 70, improvingTrend: 69, brisnetSignal: 46, history: "Price horse with upset path in pace meltdown." },
      { name: "American Law", odds: "9/1", speed: 79, form: 77, class: 80, paceFit: 79, distanceFit: 80, connections: 76, consistency: 72, volatility: 52, lateKick: 68, improvingTrend: 71, brisnetSignal: 49, history: "Mid-to-high price profile with usable class." },
      { name: "Cooke Creek", odds: "7/2", speed: 86, form: 84, class: 85, paceFit: 84, distanceFit: 83, connections: 81, consistency: 79, volatility: 41, lateKick: 74, improvingTrend: 78, brisnetSignal: 82, history: "BRISNET Spot Play horse for Oaklawn Race 7." },
      { name: "Bendoog", odds: "4/1", speed: 85, form: 83, class: 84, paceFit: 82, distanceFit: 82, connections: 80, consistency: 78, volatility: 44, lateKick: 72, improvingTrend: 75, brisnetSignal: 54, history: "Logical in exotics with competitive board price." },
      { name: "Runaway Again", odds: "9/1", speed: 78, form: 76, class: 78, paceFit: 79, distanceFit: 77, connections: 75, consistency: 71, volatility: 53, lateKick: 69, improvingTrend: 70, brisnetSignal: 48, history: "Needs race shape to outrun odds." },
      { name: "Forged Steel", odds: "19/1", speed: 70, form: 69, class: 72, paceFit: 73, distanceFit: 74, connections: 70, consistency: 64, volatility: 62, lateKick: 65, improvingTrend: 66, brisnetSignal: 43, history: "Long-shot saver candidate only." },
      { name: "Uncle Caesar", odds: "29/1", speed: 68, form: 67, class: 70, paceFit: 75, distanceFit: 73, connections: 69, consistency: 62, volatility: 66, lateKick: 63, improvingTrend: 64, brisnetSignal: 42, history: "Deep long-shot at current board price." },
      { name: "Winnemac Avenue", odds: "11/1", speed: 75, form: 73, class: 76, paceFit: 77, distanceFit: 75, connections: 73, consistency: 68, volatility: 56, lateKick: 67, improvingTrend: 68, brisnetSignal: 46, history: "Price horse with modest upside." },
      { name: "Gun Party", odds: "11/1", speed: 74, form: 72, class: 75, paceFit: 76, distanceFit: 74, connections: 72, consistency: 67, volatility: 57, lateKick: 66, improvingTrend: 67, brisnetSignal: 45, history: "Another outsider for deeper tickets." }
    ]
  },
  {
    id: "oaklawn-2026-03-06-r6",
    label: "Oaklawn Tomorrow (Mar 6) - Race 6",
    meta: {
      name: "Oaklawn Park Race 6",
      date: "Friday, March 6, 2026",
      distance: "1 1/16 Miles",
      class: "Allowance",
      purse: "$131,000"
    },
    raceConfig: {
      trackSlug: "oaklawn-park",
      year: 2026,
      month: 3,
      day: 6,
      raceNumber: 6,
      refreshSeconds: 60
    },
    brisnetConfig: {
      trackName: "Oaklawn Park",
      raceNumber: 6,
      spotPlaysUrl: "https://www.brisnet.com/racing/spot-plays/spot-plays-march-6-2026/",
      optixUrl: null
    },
    sources: [
      ...baseSources,
      {
        title: "BettingNews Oaklawn R6 (Mar 6, 2026)",
        url: "https://horses.bettingnews.com/oaklawn-park/2026/3/6/6",
        usedFor: "Race-level odds context, win/place/show profile snapshots, running-style tags"
      },
      {
        title: "OddsDigger Oaklawn race card (Mar 6, 2026)",
        url: "https://oddsdigger.com/horse-racing/oaklawn-park-21165841",
        usedFor: "March 6 field confirmation and market-price snapshot"
      }
    ],
    horses: [
      { name: "Expect The Best", odds: "3/1", speed: 90, form: 86, class: 88, paceFit: 80, distanceFit: 84, connections: 83, consistency: 84, volatility: 36, lateKick: 70, improvingTrend: 80, brisnetSignal: 50, history: "Strong profile horse in race-page metrics and covered in history snapshots." },
      { name: "Morunning", odds: "7/2", speed: 88, form: 84, class: 86, paceFit: 72, distanceFit: 79, connections: 85, consistency: 82, volatility: 40, lateKick: 65, improvingTrend: 78, brisnetSignal: 50, history: "Consistent profile with recent race-line evidence." },
      { name: "Carolo Rapido", odds: "9/2", speed: 86, form: 87, class: 85, paceFit: 77, distanceFit: 82, connections: 78, consistency: 80, volatility: 34, lateKick: 76, improvingTrend: 79, brisnetSignal: 50, history: "Competitive profile and historical entry support." },
      { name: "Black Powder", odds: "5/1", speed: 84, form: 82, class: 83, paceFit: 78, distanceFit: 80, connections: 82, consistency: 76, volatility: 39, lateKick: 74, improvingTrend: 75, brisnetSignal: 50, history: "Solid mid-pack odds and entry trail for prior starts." },
      { name: "Creative Minister", odds: "6/1", speed: 82, form: 76, class: 90, paceFit: 73, distanceFit: 86, connections: 79, consistency: 70, volatility: 48, lateKick: 72, improvingTrend: 68, brisnetSignal: 50, history: "Higher class ceiling and historical form references." },
      { name: "Uncle Caesar", odds: "8/1", speed: 80, form: 78, class: 80, paceFit: 88, distanceFit: 76, connections: 72, consistency: 68, volatility: 50, lateKick: 58, improvingTrend: 70, brisnetSignal: 50, history: "Past Oaklawn line helps anchor assumptions." },
      { name: "Pike Place", odds: "10/1", speed: 79, form: 77, class: 81, paceFit: 74, distanceFit: 80, connections: 80, consistency: 66, volatility: 52, lateKick: 67, improvingTrend: 69, brisnetSignal: 50, history: "History suggests long-shot upside at price." },
      { name: "Sara's Shaman", odds: "10/1", speed: 78, form: 74, class: 79, paceFit: 81, distanceFit: 75, connections: 71, consistency: 64, volatility: 53, lateKick: 60, improvingTrend: 66, brisnetSignal: 50, history: "Historical entries support underdog profile." }
    ]
  }
];

export const defaultRacePresetId = "oaklawn-2026-03-05-r3";

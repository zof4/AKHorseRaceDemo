const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizedMaybeText = (value) => {
  if (!isNonEmptyString(value)) {
    return null;
  }
  return value.trim();
};

const normalizedMaybeNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const validateCreateUserInput = (payload) => {
  const name = normalizedMaybeText(payload?.name);
  if (!name) {
    return { error: 'Name is required.' };
  }
  return { value: { name } };
};

export const validateCreateRaceInput = (payload) => {
  const name = normalizedMaybeText(payload?.name);
  const track = normalizedMaybeText(payload?.track);
  const horses = Array.isArray(payload?.horses) ? payload.horses : [];

  if (!name) {
    return { error: 'Race name is required.' };
  }

  if (!track) {
    return { error: 'Track is required.' };
  }

  if (horses.length < 2) {
    return { error: 'At least two horses are required.' };
  }

  const normalizedHorses = [];
  for (const [index, horse] of horses.entries()) {
    const horseName = normalizedMaybeText(horse?.name);
    if (!horseName) {
      return { error: `Horse #${index + 1} is missing a name.` };
    }

    normalizedHorses.push({
      name: horseName,
      post_position: normalizedMaybeNumber(horse?.post_position),
      jockey: normalizedMaybeText(horse?.jockey),
      trainer: normalizedMaybeText(horse?.trainer),
      morning_line_odds: normalizedMaybeText(horse?.morning_line_odds),
      weight: normalizedMaybeNumber(horse?.weight),
      age: normalizedMaybeNumber(horse?.age),
      sex: normalizedMaybeText(horse?.sex),
      recent_form: JSON.stringify(Array.isArray(horse?.recent_form) ? horse.recent_form : []),
      speed_figures: JSON.stringify(Array.isArray(horse?.speed_figures) ? horse.speed_figures : []),
      jockey_win_pct: normalizedMaybeNumber(horse?.jockey_win_pct),
      trainer_win_pct: normalizedMaybeNumber(horse?.trainer_win_pct),
      class_rating: normalizedMaybeNumber(horse?.class_rating),
      speed_rating: normalizedMaybeNumber(horse?.speed_rating ?? horse?.speed),
      form_rating: normalizedMaybeNumber(horse?.form_rating ?? horse?.form),
      pace_fit_rating: normalizedMaybeNumber(horse?.pace_fit_rating ?? horse?.paceFit),
      distance_fit_rating: normalizedMaybeNumber(horse?.distance_fit_rating ?? horse?.distanceFit),
      connections_rating: normalizedMaybeNumber(horse?.connections_rating ?? horse?.connections),
      consistency_rating: normalizedMaybeNumber(horse?.consistency_rating ?? horse?.consistency),
      volatility_rating: normalizedMaybeNumber(horse?.volatility_rating ?? horse?.volatility),
      late_kick_rating: normalizedMaybeNumber(horse?.late_kick_rating ?? horse?.lateKick),
      improving_trend_rating: normalizedMaybeNumber(
        horse?.improving_trend_rating ?? horse?.improvingTrend
      ),
      brisnet_signal: normalizedMaybeNumber(horse?.brisnet_signal ?? horse?.brisnetSignal),
      scratched: horse?.scratched ? 1 : 0
    });
  }

  return {
    value: {
      name,
      track,
      race_number: normalizedMaybeNumber(payload?.race_number),
      distance: normalizedMaybeText(payload?.distance),
      surface: normalizedMaybeText(payload?.surface),
      class: normalizedMaybeText(payload?.class),
      post_time: normalizedMaybeText(payload?.post_time),
      status: normalizedMaybeText(payload?.status) ?? 'upcoming',
      source: normalizedMaybeText(payload?.source) ?? 'manual',
      takeout_pct: normalizedMaybeNumber(payload?.takeout_pct),
      external_id: normalizedMaybeText(payload?.external_id),
      race_config_json: normalizedMaybeText(payload?.race_config_json),
      brisnet_config_json: normalizedMaybeText(payload?.brisnet_config_json),
      sources_json: normalizedMaybeText(payload?.sources_json),
      horses: normalizedHorses
    }
  };
};

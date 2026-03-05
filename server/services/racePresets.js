import { defaultRacePresetId, racePresets } from '../../data.js';

const pad = (value) => String(value).padStart(2, '0');

export const presetDateKey = (preset) => {
  const config = preset?.raceConfig;
  if (!config) {
    return null;
  }

  const year = Number(config.year);
  const month = Number(config.month);
  const day = Number(config.day);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return `${year}-${pad(month)}-${pad(day)}`;
};

export const todayAndTomorrowDateKeys = () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const format = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return new Set([format(today), format(tomorrow)]);
};

export const listRacePresets = () => racePresets;

export const listTodayTomorrowPresets = () => {
  const dateKeys = todayAndTomorrowDateKeys();
  return racePresets.filter((preset) => dateKeys.has(presetDateKey(preset)));
};

export const getPresetById = (presetId) => racePresets.find((preset) => preset.id === presetId) ?? null;

export const getDefaultPresetId = () => defaultRacePresetId;

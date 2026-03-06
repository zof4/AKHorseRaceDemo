const toJson = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorText = typeof body.error === 'string' ? body.error.trim() : '';
    const detailText = typeof body.detail === 'string' ? body.detail.trim() : '';
    if (errorText && detailText) {
      throw new Error(`${errorText}: ${detailText}`);
    }
    throw new Error(errorText || `Request failed (${response.status})`);
  }
  return body;
};

const noStore = { cache: 'no-store' };

export const api = {
  listUsers: async () => {
    const response = await fetch('/api/users', noStore);
    return toJson(response);
  },

  createUser: async (name) => {
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    return toJson(response);
  },

  getUser: async (userId) => {
    const response = await fetch(`/api/users/${userId}`, noStore);
    return toJson(response);
  },

  deleteUser: async (userId) => {
    const response = await fetch(`/api/users/${userId}`, {
      method: 'DELETE'
    });
    return toJson(response);
  },

  listRaces: async () => {
    const response = await fetch('/api/races', noStore);
    return toJson(response);
  },

  getRace: async (raceId) => {
    const response = await fetch(`/api/races/${raceId}`, noStore);
    return toJson(response);
  },

  getRaceOutcomeComparison: async (raceId, bankroll) => {
    const query = new URLSearchParams();
    if (bankroll) {
      query.set('bankroll', String(bankroll));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const response = await fetch(`/api/races/${raceId}/outcome-comparison${suffix}`, noStore);
    return toJson(response);
  },

  createRace: async (payload) => {
    const response = await fetch('/api/races', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return toJson(response);
  },

  updateRaceStatus: async (raceId, payload) => {
    const response = await fetch(`/api/races/${raceId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return toJson(response);
  },

  setRaceResults: async (raceId, payload) => {
    const response = await fetch(`/api/races/${raceId}/results`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return toJson(response);
  },

  refreshRaceResults: async (raceId) => {
    const response = await fetch(`/api/races/${raceId}/results/refresh`, {
      method: 'POST'
    });
    return toJson(response);
  },

  listRacePresets: async () => {
    const response = await fetch('/api/races/presets', noStore);
    return toJson(response);
  },

  importRacePresets: async (payload = {}) => {
    const response = await fetch('/api/races/import/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return toJson(response);
  },

  importEquibaseRaces: async (payload) => {
    const response = await fetch('/api/races/import/equibase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return toJson(response);
  },

  getPools: async (raceId) => {
    const response = await fetch(`/api/pools/${raceId}`, noStore);
    return toJson(response);
  },

  quoteBet: async (payload) => {
    const response = await fetch('/api/bets/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return toJson(response);
  },

  placeBet: async (payload) => {
    const response = await fetch('/api/bets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return toJson(response);
  },

  listBets: async ({ raceId, userId } = {}) => {
    const query = new URLSearchParams();
    if (raceId) {
      query.set('raceId', String(raceId));
    }
    if (userId) {
      query.set('userId', String(userId));
    }

    const suffix = query.toString() ? `?${query.toString()}` : '';
    const response = await fetch(`/api/bets${suffix}`, noStore);
    return toJson(response);
  },

  analyzeRace: async (raceId, bankroll) => {
    const query = new URLSearchParams();
    if (bankroll) {
      query.set('bankroll', String(bankroll));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const response = await fetch(`/api/algorithm/race/${raceId}/analyze${suffix}`, noStore);
    return toJson(response);
  },

  getJockeyProfile: async (name, { force = false } = {}) => {
    const query = new URLSearchParams();
    query.set('name', String(name ?? '').trim());
    if (force) {
      query.set('force', '1');
    }
    const response = await fetch(`/api/jockeys/profile?${query.toString()}`, noStore);
    return toJson(response);
  },

  refreshRaceMarket: async (raceId, bankroll) => {
    const response = await fetch(`/api/algorithm/race/${raceId}/refresh-market`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankroll })
    });
    return toJson(response);
  }
};

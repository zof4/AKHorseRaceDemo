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

export const api = {
  listUsers: async () => {
    const response = await fetch('/api/users');
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
    const response = await fetch(`/api/users/${userId}`);
    return toJson(response);
  },

  deleteUser: async (userId) => {
    const response = await fetch(`/api/users/${userId}`, {
      method: 'DELETE'
    });
    return toJson(response);
  },

  listRaces: async () => {
    const response = await fetch('/api/races');
    return toJson(response);
  },

  getRace: async (raceId) => {
    const response = await fetch(`/api/races/${raceId}`);
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

  listRacePresets: async () => {
    const response = await fetch('/api/races/presets');
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
    const response = await fetch(`/api/pools/${raceId}`);
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
    const response = await fetch(`/api/bets${suffix}`);
    return toJson(response);
  },

  analyzeRace: async (raceId, bankroll) => {
    const query = new URLSearchParams();
    if (bankroll) {
      query.set('bankroll', String(bankroll));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const response = await fetch(`/api/algorithm/race/${raceId}/analyze${suffix}`);
    return toJson(response);
  },

  getJockeyProfile: async (name, { force = false } = {}) => {
    const query = new URLSearchParams();
    query.set('name', String(name ?? '').trim());
    if (force) {
      query.set('force', '1');
    }
    const response = await fetch(`/api/jockeys/profile?${query.toString()}`);
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

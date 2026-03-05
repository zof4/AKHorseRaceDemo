const toJson = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
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
  }
};

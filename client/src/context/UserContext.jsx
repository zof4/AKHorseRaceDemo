import { createContext, useContext, useMemo, useState } from 'react';

const UserContext = createContext(null);
const STORAGE_KEY = 'horse-race-demo:user';

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export function UserProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(readStoredUser);

  const setUser = (next) => {
    setCurrentUser(next);
    if (next) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
  };

  const value = useMemo(() => ({ currentUser, setUser }), [currentUser]);
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export const useUser = () => {
  const value = useContext(UserContext);
  if (!value) {
    throw new Error('useUser must be used within UserProvider');
  }
  return value;
};

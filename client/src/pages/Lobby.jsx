import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useUser } from '../context/UserContext.jsx';

export default function Lobby() {
  const [users, setUsers] = useState([]);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { currentUser, setUser } = useUser();

  const totalBankroll = useMemo(
    () => users.reduce((acc, user) => acc + Number(user.balance || 0), 0),
    [users]
  );

  const loadUsers = async () => {
    try {
      const { users: nextUsers } = await api.listUsers();
      setUsers(nextUsers);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const onSubmit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError('');

    try {
      const { user } = await api.createUser(name);
      setUser(user);
      setName('');
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="grid gap-4">
      <article className="panel">
        <h2 className="text-lg font-semibold">Player Setup</h2>
        <p className="mt-1 text-sm text-stone-600">Join the room with your player name and starting bankroll.</p>
        <form className="mt-4 grid gap-3" onSubmit={onSubmit}>
          <input
            className="input"
            placeholder="Player name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
          />
          <button className="btn-primary" type="submit" disabled={pending || !name.trim()}>
            {pending ? 'Joining...' : 'Join Room'}
          </button>
        </form>
        {currentUser ? (
          <p className="mt-3 text-sm text-emerald-700">
            Active player: <strong>{currentUser.name}</strong> (${Number(currentUser.balance).toFixed(2)})
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      </article>

      <article className="panel">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Players</h3>
          <p className="text-xs text-stone-500">Total bankroll: ${totalBankroll.toFixed(2)}</p>
        </div>
        <ul className="mt-3 grid gap-2">
          {users.length ? (
            users.map((user) => (
              <li key={user.id} className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{user.name}</span>
                  <strong>${Number(user.balance).toFixed(2)}</strong>
                </div>
              </li>
            ))
          ) : (
            <li className="text-sm text-stone-500">No players yet.</li>
          )}
        </ul>
      </article>
    </section>
  );
}

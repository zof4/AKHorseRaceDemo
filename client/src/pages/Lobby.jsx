import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useUser } from '../context/UserContext.jsx';
import socket from '../socket.js';

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function Lobby() {
  const [users, setUsers] = useState([]);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [actionUserId, setActionUserId] = useState(null);
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
    const onUserJoined = () => {
      loadUsers();
    };
    const onUserRemoved = ({ userId } = {}) => {
      if (Number(userId) === Number(currentUser?.id)) {
        setUser(null);
      }
      loadUsers();
    };
    socket.on('user_joined', onUserJoined);
    socket.on('user_removed', onUserRemoved);
    return () => {
      socket.off('user_joined', onUserJoined);
      socket.off('user_removed', onUserRemoved);
    };
  }, [currentUser?.id, setUser]);

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

  const onActivateUser = async (user) => {
    setError('');
    setActionUserId(user.id);

    try {
      const { user: latest } = await api.getUser(user.id);
      setUser(latest);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionUserId(null);
    }
  };

  const onDeleteUser = async (user) => {
    const confirmed = window.confirm(
      `Remove "${user.name}"? This also removes their bets because this is a local demo database.`
    );
    if (!confirmed) {
      return;
    }

    setError('');
    setActionUserId(user.id);

    try {
      await api.deleteUser(user.id);
      if (Number(currentUser?.id) === Number(user.id)) {
        setUser(null);
      }
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionUserId(null);
    }
  };

  return (
    <section className="grid gap-4">
      <article className="panel">
        <p className="kicker">Session Setup</p>
        <h2 className="page-title mt-1">Player Lobby</h2>
        <p className="mt-1 text-sm text-stone-600">Join once, then place bets across any imported race card.</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="tile">
            <p className="tile-title">Players</p>
            <p className="tile-value">{users.length}</p>
          </div>
          <div className="tile">
            <p className="tile-title">Total Bankroll</p>
            <p className="tile-value">{formatMoney(totalBankroll)}</p>
          </div>
          <div className="tile">
            <p className="tile-title">Active Player</p>
            <p className="tile-value text-base">{currentUser?.name || 'Not joined'}</p>
          </div>
        </div>

        <form className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr),auto] sm:items-end" onSubmit={onSubmit}>
          <label className="text-xs text-stone-600">
            Player name
            <input
              className="input mt-1"
              placeholder="Player name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
            />
          </label>
          <button className="btn-primary h-10" type="submit" disabled={pending || !name.trim()}>
            {pending ? 'Joining...' : 'Join Room'}
          </button>
        </form>
        <p className="mt-2 text-xs text-stone-500">
          Existing players can be resumed below with <strong>Use Player</strong>.
        </p>

        {currentUser ? (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Active player: <strong>{currentUser.name}</strong> ({formatMoney(currentUser.balance)})
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="btn-secondary" to="/races">
            Open Races
          </Link>
          <Link className="btn-secondary" to="/live">
            Open Live Bets
          </Link>
        </div>
      </article>

      <article className="panel">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Players In Room</h3>
          <p className="text-xs text-stone-500">Total bankroll: {formatMoney(totalBankroll)}</p>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {users.length ? (
            users.map((user) => (
              <li key={user.id} className="tile">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{user.name}</span>
                  <strong>{formatMoney(user.balance)}</strong>
                </div>
                <p className="mt-1 text-xs text-stone-500">User #{user.id}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn-secondary px-3 py-1.5 text-xs"
                    type="button"
                    onClick={() => onActivateUser(user)}
                    disabled={actionUserId === user.id}
                  >
                    {actionUserId === user.id ? 'Working...' : 'Use Player'}
                  </button>
                  <button
                    className="rounded-xl border border-rose-700 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                    type="button"
                    onClick={() => onDeleteUser(user)}
                    disabled={actionUserId === user.id}
                  >
                    Remove
                  </button>
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

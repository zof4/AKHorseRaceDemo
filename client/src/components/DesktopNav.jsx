import { NavLink } from 'react-router-dom';
import { useUser } from '../context/UserContext.jsx';

const links = [
  { to: '/lobby', label: 'Lobby', subtitle: 'Players and bankroll' },
  { to: '/races', label: 'Races', subtitle: 'Cards and pools' },
  { to: '/live', label: 'Live Bets', subtitle: 'Tickets and feed' },
  { to: '/algorithm', label: 'Algorithm', subtitle: 'Model and strategy' }
];

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function DesktopNav() {
  const { currentUser } = useUser();

  return (
    <aside className="desktop-sidebar">
      <div className="sticky top-6 grid gap-4">
        <section className="panel">
          <p className="kicker">HorseRace Demo</p>
          <h1 className="page-title mt-1 text-[1.35rem] leading-tight">Betting Control Room</h1>
          <p className="mt-2 text-sm text-stone-600">Desktop workspace with race, market, and algorithm views.</p>
        </section>

        <nav className="panel p-2">
          <ul className="grid gap-1">
            {links.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={({ isActive }) =>
                    `block rounded-xl px-3 py-2 transition ${
                      isActive ? 'accent-band text-white' : 'text-stone-700 hover:bg-stone-100'
                    }`
                  }
                >
                  <p className="text-sm font-semibold">{link.label}</p>
                  <p className="text-xs opacity-80">{link.subtitle}</p>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <section className="panel">
          <p className="tile-title">Active Player</p>
          {currentUser ? (
            <>
              <p className="tile-value text-base">{currentUser.name}</p>
              <p className="mt-1 text-sm text-emerald-700">{formatMoney(currentUser.balance)}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-stone-500">Join from Lobby to place bets.</p>
          )}
        </section>
      </div>
    </aside>
  );
}

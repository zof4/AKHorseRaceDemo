import { NavLink } from 'react-router-dom';

const links = [
  { to: '/lobby', label: 'Lobby' },
  { to: '/races', label: 'Races' },
  { to: '/live', label: 'Live' },
  { to: '/algorithm', label: 'Algorithm' }
];

export default function BottomNav() {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 border-t border-stone-300 bg-white/95">
      <ul className="mx-auto grid w-full max-w-3xl grid-cols-4 gap-1 px-2 pt-2">
        {links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                `block rounded-md px-2 py-2 text-center text-xs font-semibold ${
                  isActive ? 'bg-amber-800 text-white' : 'text-stone-700 hover:bg-stone-100'
                }`
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

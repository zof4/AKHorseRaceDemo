import { useUser } from '../context/UserContext.jsx';

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function Header() {
  const { currentUser } = useUser();

  return (
    <header className="border-b border-[#dfcfba] bg-white/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 lg:px-6">
        <div>
          <p className="kicker">HorseRace Demo</p>
          <h1 className="text-xl font-semibold text-stone-900 lg:text-2xl">Local Betting Room</h1>
        </div>
        <div className="hidden rounded-xl border border-[#dcc8b0] bg-[#fffaf3] px-3 py-2 text-right sm:block">
          <p className="text-xs text-stone-600">Active Player</p>
          {currentUser ? (
            <p className="text-sm font-semibold text-stone-900">
              {currentUser.name} <span className="text-emerald-700">{formatMoney(currentUser.balance)}</span>
            </p>
          ) : (
            <p className="text-sm text-stone-500">Not joined</p>
          )}
        </div>
      </div>
    </header>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';
import Header from './components/Header.jsx';
import BottomNav from './components/BottomNav.jsx';
import Lobby from './pages/Lobby.jsx';
import RaceList from './pages/RaceList.jsx';
import ManualRaceEntry from './pages/ManualRaceEntry.jsx';
import Algorithm from './pages/Algorithm.jsx';
import LiveBets from './pages/LiveBets.jsx';
import RaceDetail from './pages/RaceDetail.jsx';
import PlaceBet from './pages/PlaceBet.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4">
        <Routes>
          <Route path="/" element={<Navigate to="/lobby" replace />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/races" element={<RaceList />} />
          <Route path="/races/new" element={<ManualRaceEntry />} />
          <Route path="/races/:raceId" element={<RaceDetail />} />
          <Route path="/races/:raceId/bet" element={<PlaceBet />} />
          <Route path="/live" element={<LiveBets />} />
          <Route path="/algorithm" element={<Algorithm />} />
          <Route path="*" element={<Navigate to="/lobby" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}

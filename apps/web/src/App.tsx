import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { AdminPage } from './features/auth/AdminPage';
import { ScoringPage } from './features/scoring/ScoringPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<main>
          <h1>Arrowcast</h1>
          <p>Welkom bij Arrowcast.</p>
          <Link to="/admin">Naar het beheerportal</Link>
        </main>} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/scoring/:competitionId/:laneId/:grantId" element={<ScoringPage />} />
        <Route path="*" element={<main>
          <h1>Pagina niet gevonden</h1>
          <Link to="/">Naar de startpagina</Link>
        </main>} />
      </Routes>
    </BrowserRouter>
  );
}

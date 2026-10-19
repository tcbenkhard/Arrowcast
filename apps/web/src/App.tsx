import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { AdminPage } from './features/auth/AdminPage';

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
        <Route path="*" element={<main>
          <h1>Pagina niet gevonden</h1>
          <Link to="/">Naar de startpagina</Link>
        </main>} />
      </Routes>
    </BrowserRouter>
  );
}

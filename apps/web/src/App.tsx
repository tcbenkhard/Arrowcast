import { t, useLanguage } from './i18n';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { AdminPage } from './features/auth/AdminPage';
import { ScoringPage } from './features/scoring/ScoringPage';
import { LanguageSelect } from './components/LanguageSelect';

export function App() {
  useLanguage();
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <main>
              <LanguageSelect />
              <h1>{t('App.arrowcast')}</h1>
              <p>{t('App.welkom_bij_arrowcast')}</p>
              <Link to="/admin">{t('App.naar_het_beheerportal')}</Link>
            </main>
          }
        />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/scoring/:competitionId/:laneId/:grantId" element={<ScoringPage />} />
        <Route
          path="*"
          element={
            <main>
              <LanguageSelect />
              <h1>{t('App.pagina_niet_gevonden')}</h1>
              <Link to="/">{t('App.naar_de_startpagina')}</Link>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

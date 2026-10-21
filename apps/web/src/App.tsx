import { t, useLanguage } from './i18n';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { AdminPage } from './features/auth/AdminPage';
import { ScoringPage } from './features/scoring/ScoringPage';
import { LanguageSelect } from './components/LanguageSelect';
import { ArrowCastLogo } from './components/ArrowCastLogo';

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
              <h1>
                <ArrowCastLogo />
              </h1>
              <p>{t('App.welkom_bij_arrowcast')}</p>
              <Link to="/admin">{t('App.naar_het_beheerportal')}</Link>
            </main>
          }
        />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route
          path="/scores"
          element={
            <main>
              <LanguageSelect />
              <h1>{t('PublicScores.title')}</h1>
              <p>{t('PublicScores.scan')}</p>
            </main>
          }
        />
        <Route path="/scores/:competitionId/:laneId/:grantId" element={<ScoringPage />} />
        <Route path="/scoring/:competitionId/:laneId/:grantId" element={<LegacyScoringRedirect />} />
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

function LegacyScoringRedirect() {
  const { competitionId, laneId, grantId } = useParams();
  const location = useLocation();
  return (
    <Navigate
      replace
      to={{ pathname: `/scores/${competitionId}/${laneId}/${grantId}`, search: location.search, hash: location.hash }}
    />
  );
}

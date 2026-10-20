import { t } from './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error(t("main.reactroot_ontbreekt"));
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

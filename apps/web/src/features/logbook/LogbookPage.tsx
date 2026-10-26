import type { LogbookHistoryEntry, LogbookSummary } from '@arrowcast/contracts';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { getLanguage, message, t } from '../../i18n';
import { managementRequest, requireJson } from '../../lib/http';
import { getArrowcastHostname } from '../settings/hostnameStorage';
import { LogbookHistory } from './LogbookHistory';

export function LogbookPage({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const [rows, setRows] = useState<LogbookSummary[]>([]);
  const [selected, setSelected] = useState<LogbookSummary | null>(null);
  const [history, setHistory] = useState<LogbookHistoryEntry[] | null>(null);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [qr, setQr] = useState<{ image: string; url: string; hotspot: boolean } | null>(null);
  const [qrError, setQrError] = useState('');
  const [qrExpanded, setQrExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void managementRequest('/api/v1/admin/logbook', token, {
      signal: controller.signal,
      onUnauthorized: () => onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in')),
    })
      .then(requireJson<LogbookSummary[]>)
      .then((result) => {
        if (!controller.signal.aborted) setRows(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t('logbook.loadError'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, onUnauthorized]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setHistory(null);
    setHistoryError('');
    void managementRequest(`/api/v1/admin/logbook/${encodeURIComponent(selected.participantId)}`, token, {
      signal: controller.signal,
      onUnauthorized: () => onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in')),
    })
      .then(requireJson<LogbookHistoryEntry[]>)
      .then((result) => {
        if (!controller.signal.aborted) setHistory(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHistoryError(t('logbook.loadError'));
      });
    return () => controller.abort();
  }, [selected, token, onUnauthorized]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const origin = await requireJson<{ origin: string | null; hotspot?: boolean }>(
          await managementRequest('/api/v1/admin/scoring-origin', token, {
            signal: controller.signal,
            onUnauthorized: () => onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in')),
          }),
        );
        const url = new URL('/scores/logbook', origin.origin || getArrowcastHostname());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        const image = await QRCode.toDataURL(url.href, { width: 480, margin: 4 });
        if (!controller.signal.aborted) {
          setQr({ image, url: url.href, hotspot: origin.hotspot === true });
          setQrError('');
        }
      } catch {
        if (!controller.signal.aborted) {
          setQr(null);
          setQrError(t('PublicAccess.unavailable'));
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 4000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, onUnauthorized]);

  async function downloadLogbook() {
    if (exporting) return;
    setExporting(true);
    setError('');
    try {
      const response = await managementRequest(`/api/v1/admin/logbook/export?language=${getLanguage()}`, token);
      if (response.status === 401) {
        onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in'));
        return;
      }
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'scorelogboek.xls';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(t('logbook.exportError'));
    } finally {
      setExporting(false);
    }
  }

  const number = (value: number) => value.toLocaleString(getLanguage(), { maximumFractionDigits: 2 });
  return (
    <>
      <section className="panel">
        <div className="section-header">
          <h2>{t('logbook.title')}</h2>
          <button
            className="secondary"
            disabled={loading || exporting || rows.length === 0}
            onClick={() => void downloadLogbook()}
          >
            {t('logbook.export')}
          </button>
        </div>
        <p>{t('logbook.overviewHelp')}</p>
        <p className="muted">{t('logbook.averageHelp')}</p>
        {error && (
          <p className="error" role="alert">
            {message(error)}
          </p>
        )}
        {loading ? (
          <p role="status">{t('logbook.loading')}</p>
        ) : rows.length === 0 ? (
          <p>{t('logbook.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('logbook.name')}</th>
                  <th>{t('logbook.averageScore')}</th>
                  <th>{t('logbook.averageArrow')}</th>
                  <th>{t('logbook.highest')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.participantId}>
                    <td>
                      <button className="range-edit-button" onClick={() => setSelected(row)}>
                        {row.name}
                      </button>
                    </td>
                    <td>{number(row.averageScore)}</td>
                    <td>{number(row.averagePerArrow)}</td>
                    <td>{row.highestScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <section className="panel">
          <div className="section-header">
            <h2>{selected.name}</h2>
            <button className="secondary" onClick={() => setSelected(null)}>
              {t('logbook.close')}
            </button>
          </div>
          {historyError ? (
            <p className="error" role="alert">
              {message(historyError)}
            </p>
          ) : history ? (
            <LogbookHistory entries={history} />
          ) : (
            <p role="status">{t('logbook.loading')}</p>
          )}
        </section>
      )}
      <section className="panel collapsible-panel lane-qr-panel logbook-qr-panel" aria-labelledby="logbook-qr-title">
        <div className="section-header collapsible-panel-header qr-controls">
          <h2 id="logbook-qr-title">{t('logbook.qrTitle')}</h2>
          <button
            type="button"
            className="panel-toggle"
            aria-label={`${t('logbook.qrTitle')} ${t(qrExpanded ? 'CompetitionDetailPage.collapse' : 'CompetitionDetailPage.expand')}`}
            aria-expanded={qrExpanded}
            aria-controls="logbook-qr-content"
            onClick={() => setQrExpanded((value) => !value)}
          >
            <svg className="panel-caret" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
        </div>
        <div id="logbook-qr-content" className="collapsible-panel-content" hidden={!qrExpanded}>
          <p>{t('logbook.qrHelp')}</p>
          {qrError && (
            <p className="error" role="alert">
              {message(qrError)}
            </p>
          )}
          {qr && (
            <article className="lane-qr-card">
              <h3>{t('logbook.title')}</h3>
              <img src={qr.image} alt={t('logbook.qrTitle')} width={240} height={240} />
              <p>{t('logbook.intro')}</p>
              {qr.hotspot && <p>{t('PublicAccess.hotspotJoin')}</p>}
              <a href={qr.url} target="_blank" rel="noreferrer">
                {qr.url}
              </a>
              <button className="secondary qr-controls" onClick={() => window.print()}>
                {t('logbook.printQr')}
              </button>
            </article>
          )}
        </div>
      </section>
    </>
  );
}

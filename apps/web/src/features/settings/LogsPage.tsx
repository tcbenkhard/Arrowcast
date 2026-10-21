import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { managementRequest } from '../../lib/http';

const sources = ['frontend', 'backend', 'updates'] as const;

export function LogsPage({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const [source, setSource] = useState<(typeof sources)[number]>('frontend');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const output = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (paused) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await managementRequest(`/api/v1/admin/logs/${source}`, token, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onUnauthorized(t('AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in'));
          return;
        }
        if (!response.ok) throw new Error();
        const result = (await response.json()) as { text: string };
        if (controller.signal.aborted) return;
        setText(result.text);
        setError('');
      } catch {
        if (!controller.signal.aborted) setError(t('Logs.unavailable'));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void refresh(), 2000);
        }
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [source, token, onUnauthorized, paused]);

  useEffect(() => {
    if (follow && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [text, follow]);

  return (
    <section className="panel logs-page" aria-labelledby="logs-heading">
      <h2 id="logs-heading">{t('Logs.title')}</h2>
      <div className="log-tabs" role="tablist" aria-label={t('Logs.title')}>
        {sources.map((item, index) => (
          <button
            key={item}
            id={`log-tab-${item}`}
            role="tab"
            aria-selected={source === item}
            aria-controls="log-output"
            tabIndex={source === item ? 0 : -1}
            className={source === item ? '' : 'secondary'}
            onClick={() => {
              if (item === source) return;
              setSource(item);
              setText('');
              setError('');
              setLoading(true);
              setPaused(false);
            }}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % sources.length
                  : event.key === 'ArrowLeft'
                    ? (index + sources.length - 1) % sources.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? sources.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              const tab = document.getElementById(`log-tab-${sources[next]}`);
              tab?.focus();
              tab?.click();
            }}
          >
            {t(`Logs.${item}`)}
          </button>
        ))}
      </div>
      <p>{t(source === 'frontend' ? 'Logs.frontendHint' : 'Logs.hint')}</p>
      <div className="log-controls">
        <button className="secondary" onClick={() => setPaused((value) => !value)}>
          {t(paused ? 'Logs.resume' : 'Logs.pause')}
        </button>
        <label className="log-follow">
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
          {t('Logs.follow')}
        </label>
        <span role="status">{t(paused ? 'Logs.paused' : 'Logs.live')}</span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <pre
        ref={output}
        id="log-output"
        className="log-output"
        role="tabpanel"
        aria-labelledby={`log-tab-${source}`}
        aria-busy={loading}
        tabIndex={0}
      >
        {text || t(loading ? 'Logs.loading' : 'Logs.empty')}
      </pre>
    </section>
  );
}

import { t, message, getLanguage } from '../../i18n';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { LaneQrCode } from '@arrowcast/contracts';
import { getArrowcastHostname } from '../settings/hostnameStorage';

export function LaneScoringCodes({ competitionId, name, status, codes, onCodesChange, token, onUnauthorized }: {
  competitionId: string; name: string; status: string; codes: LaneQrCode[];
  onCodesChange: (codes: LaneQrCode[]) => void; token: string; onUnauthorized: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hasCodes, setHasCodes] = useState(codes.length > 0);
  const [loaded, setLoaded] = useState(codes.length > 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const siteUrl = getArrowcastHostname();
  const [images, setImages] = useState<{ code: LaneQrCode; url: string; image: string }[]>([]);
  const [qrError, setQrError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (codes.length) { setHasCodes(true); setLoaded(true); return; }
    let cancelled = false;
    void fetch(`/api/v1/admin/competitions/${competitionId}/scoring-codes`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    }).then(async (response) => {
      if (response.status === 401) { onUnauthorized(t("AdminPage.je_sessie_is_verlopen_log_opnieuw_in")); return; }
      if (!response.ok) throw new Error(t("LaneScoringCodes.could_not_load_qr_code_status"));
      let grants = await response.json() as LaneQrCode[];
      if (!cancelled && grants.some((grant) => typeof grant.path !== 'string')) {
        const restored = await fetch(`/api/v1/admin/competitions/${competitionId}/scoring-codes/restore`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        });
        if (restored.status === 401) { onUnauthorized(t("AdminPage.je_sessie_is_verlopen_log_opnieuw_in")); return; }
        if (!restored.ok) throw new Error(t("LaneScoringCodes.could_not_restore_qr_codes"));
        const refreshed = await fetch(`/api/v1/admin/competitions/${competitionId}/scoring-codes`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
        });
        if (refreshed.status === 401) { onUnauthorized(t("AdminPage.je_sessie_is_verlopen_log_opnieuw_in")); return; }
        if (!refreshed.ok) throw new Error(t("LaneScoringCodes.could_not_load_qr_codes"));
        grants = await refreshed.json() as LaneQrCode[];
      }
      if (!cancelled) {
        const available = grants.filter((grant) => typeof grant.path === 'string');
        if (available.length) onCodesChange(available);
      }
      if (!cancelled) { setHasCodes(grants.length > 0); setLoaded(true); setError(''); }
    }).catch(() => { if (!cancelled) setError(t("LaneScoringCodes.could_not_load_qr_code_status_try_again")); });
    return () => { cancelled = true; };
  }, [competitionId, token, onUnauthorized, codes, retry, onCodesChange]);
  useEffect(() => {
    let cancelled = false; setImages([]); setQrError('');
    void (async () => {
      try {
        const base = new URL(siteUrl);
        if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error(t("LaneScoringCodes.enter_an_http_or_https_website_address"));
        const results = await Promise.all(codes.map(async (code) => {
          const url = new URL(code.path, base.origin).href;
          return { code, url, image: await QRCode.toDataURL(url, { width: 480, margin: 4, errorCorrectionLevel: 'M' }) };
        }));
        if (!cancelled) setImages(results);
      } catch { if (!cancelled) setQrError(t("LaneScoringCodes.enter_a_valid_website_address_to_create_the_qr")); }
    })();
    return () => { cancelled = true; };
  }, [codes, siteUrl]);
  async function generate() {
    if (pending || !loaded) return;
    if (hasCodes && !window.confirm(t("LaneScoringCodes.replace_all_lane_qr_codes_previous_codes_and_their"))) return;
    setPending(true); setError('');
    try {
      const response = await fetch(`/api/v1/admin/competitions/${competitionId}/scoring-codes`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) { onUnauthorized(t("AdminPage.je_sessie_is_verlopen_log_opnieuw_in")); return; }
      if (!response.ok) throw new Error(t("LaneScoringCodes.could_not_generate_qr_codes"));
      onCodesChange(await response.json() as LaneQrCode[]); setHasCodes(true);
    } catch { setError(t("LaneScoringCodes.could_not_retrieve_new_qr_codes_check_your_connection")); }
    finally { setPending(false); }
  }
  return <section className="panel collapsible-panel lane-qr-panel" aria-labelledby="lane-qr-title">
    <div className="section-header collapsible-panel-header qr-controls">
      <h3 id="lane-qr-title">{t("LaneScoringCodes.lane_scoring_qr_codes")}</h3>
      <button type="button" className="panel-toggle" aria-label={t("LaneScoringCodes.lane_scoring_qr_codes_242", { p0: expanded ? t("CompetitionDetailPage.collapse") : t("CompetitionDetailPage.expand") })}
        aria-expanded={expanded} aria-controls="lane-qr-content" onClick={() => setExpanded((value) => !value)}>
        <svg className="panel-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
    </div>
    <div id="lane-qr-content" className="collapsible-panel-content" hidden={!expanded}>
    <div className="section-header qr-controls"><p className="muted">{t("LaneScoringCodes.anyone_with_a_code_can_enter_scores_for_that")}</p>
      {(status === 'Check-in' || status === 'Active') && <button disabled={pending || !loaded} onClick={() => { void generate(); }}>
        {hasCodes ? t("LaneScoringCodes.generate_replacement_qr_codes") : t("LaneScoringCodes.generate_qr_codes")}
      </button>}
    </div>
    {error && <div className="qr-controls"><p className="error" role="alert">{message(error)}</p>
      {!loaded && <button onClick={() => setRetry((value) => value + 1)}>{t("CompetitionDetailPage.try_again")}</button>}</div>}
    {codes.length > 0 && <>
      <div className="qr-controls">
        <p className="muted">{t("LaneScoringCodes.set_the_scoring_website_address_in_settings_under_arrowcast")}</p>
        <button className="secondary" disabled={images.length !== codes.length || !!qrError} onClick={() => window.print()}>{t("LaneScoringCodes.print_lane_qr_codes")}</button>
        {qrError && <p className="error" role="alert">{message(qrError)}</p>}
      </div>
      <div className="lane-qr-grid">{images.map(({ code, url, image }) => <article className="lane-qr-card" key={code.grantId}>
        <h3>{name}</h3><h4>{t("CompetitionDetailPage.lane")} {code.laneNumber}</h4>
        <img src={image} alt={t("LaneScoringCodes.scoring_qr_code_for_lane", { p0: code.laneNumber })} width={240} height={240} />
        <p>{t("LaneScoringCodes.scan_to_enter_scores")}</p>
        <a className="qr-controls" href={url} target="_blank" rel="noreferrer">{t('scoring.openLane', { number: code.laneNumber })}</a>
        <p className="muted">{t('scoring.validUntil', { date: new Date(code.expiresAt).toLocaleString(getLanguage()) })}</p>
      </article>)}</div>
    </>}
    </div>
  </section>;
}

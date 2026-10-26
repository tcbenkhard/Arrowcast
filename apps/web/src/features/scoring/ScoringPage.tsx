import { ScoreKeypad } from './ScoreKeypad';
import { ScoreSheet } from './ScoreSheet';
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { LanguageSelect } from '../../components/LanguageSelect';
import { message, t } from '../../i18n';
import { useScoringLane } from './useScoringLane';

export function ScoringPage() {
  const { competitionId, laneId, grantId } = useParams();
  return (
    <ScoringLane
      key={`${competitionId}/${laneId}/${grantId}`}
      competitionId={competitionId!}
      laneId={laneId!}
      grantId={grantId!}
    />
  );
}

function ScoringLane({ competitionId, laneId, grantId }: { competitionId: string; laneId: string; grantId: string }) {
  const {
    context,
    arrows,
    arrowIndex,
    setArrowIndex,
    selection,
    scrollAfterSave,
    busy,
    error,
    waitingForStart,
    conflict,
    retryable,
    notice,
    correcting,
    locked,
    disabled,
    roundBlocked,
    entryDisabled,
    save,
    reload,
    retryRequest,
    chooseRound,
  } = useScoringLane(competitionId, laneId, grantId);
  const activeParticipantHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (scrollAfterSave > 0) activeParticipantHeading.current?.scrollIntoView({ block: 'start' });
  }, [scrollAfterSave]);
  return (
    <main className="scoring-page">
      {!context && !error && (
        <div className="panel">
          <p role="status">{t('ScoringPage.opening_lane_scores')}</p>
        </div>
      )}
      {error && (
        <div className="panel scoring-message">
          <p className={waitingForStart ? undefined : 'error'} role={waitingForStart ? 'status' : 'alert'}>
            {message(error)}
          </p>
          {retryable && (
            <button disabled={busy} onClick={retryRequest}>
              {t('ScoringPage.retry')}
            </button>
          )}
          {conflict && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                void reload();
              }}
            >
              {t('ScoringPage.reload_latest_scores')}
            </button>
          )}
        </div>
      )}
      {context && (
        <>
          {locked && (
            <div className="panel scoring-message">
              <p role="status">{t('ScoringPage.score_entry_is_paused')}</p>
            </div>
          )}
          {context.completed ? (
            <section className="panel">
              <h2>{t('ScoringPage.lane_scoring_complete')}</h2>
              <p>
                {context.participants.length
                  ? t('ScoringPage.all_participants_have_completed_every_round')
                  : t('ScoringPage.no_participants_are_assigned_to_this_lane')}
              </p>
            </section>
          ) : null}
          {context.participants.length > 0 && (
            <div className="scoring-participants" role="group" aria-label={t('ScoringPage.lane_participants')}>
              {context.participants.map((participant) => {
                const active = selection?.participantId === participant.id;
                const headingId = active ? 'current-archer' : `participant-heading-${participant.id}`;
                const panelId = `participant-scores-${participant.id}`;
                return (
                  <section
                    key={participant.id}
                    className={`panel scoring-participant${active ? ' active' : ''}`}
                    aria-labelledby={headingId}
                  >
                    <h2 id={headingId} ref={active ? activeParticipantHeading : undefined}>
                      <button
                        type="button"
                        className="scoring-participant-toggle"
                        aria-expanded={active}
                        aria-controls={panelId}
                        disabled={disabled}
                        onClick={() => {
                          if (!active)
                            chooseRound({
                              participantId: participant.id,
                              roundNumber: Math.min(
                                selection?.roundNumber ?? context.currentRoundNumber,
                                context.currentRoundNumber,
                              ),
                            });
                        }}
                      >
                        <span>
                          {context.lane.number}
                          {participant.targetLetter} · {participant.name}
                        </span>
                        <span aria-hidden="true">{active ? '−' : '+'}</span>
                      </button>
                    </h2>
                    <div id={panelId} hidden={!active}>
                      {active && (
                        <div className="score-entry" aria-busy={busy}>
                          <p>
                            {t('scoring.roundProgress', {
                              round: selection.roundNumber,
                              rounds: context.competition.numberOfRounds,
                              arrows: context.competition.arrowsPerRound,
                            })}
                          </p>
                          {roundBlocked && (
                            <p className="scoring-message" role="alert">
                              {t('scoring.roundBlocked', {
                                round: selection.roundNumber,
                                current: context.currentRoundNumber,
                              })}
                            </p>
                          )}
                          <ScoreKeypad
                            arrows={arrows}
                            arrowIndex={arrowIndex}
                            setArrowIndex={setArrowIndex}
                            disabled={entryDisabled}
                            onChange={(values) => save(values, false)}
                          />
                          <button
                            className="scoring-save"
                            disabled={entryDisabled || arrows.some((value) => value === null)}
                            onClick={() => save(arrows, true)}
                          >
                            {correcting ? t('ScoringPage.save_correction') : t('ScoringPage.save')}
                          </button>
                          <ScoreSheet
                            rounds={context.rounds.filter((round) => round.participantId === participant.id)}
                            numberOfRounds={context.competition.numberOfRounds}
                            arrowsPerRound={context.competition.arrowsPerRound}
                            currentRoundNumber={context.currentRoundNumber}
                            selectedRound={selection.roundNumber}
                            disabled={disabled}
                            onSelectRound={(roundNumber) => chooseRound({ participantId: participant.id, roundNumber })}
                          />
                          <p className="scoring-notice visually-hidden" role="status" aria-live="polite">
                            {message(notice)}
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
      <footer className="scoring-footer">
        <LanguageSelect flags />
      </footer>
    </main>
  );
}

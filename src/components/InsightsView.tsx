import React from 'react';
import { useWeeklyInsights } from '../hooks/useWeeklyInsights';
import { ApiError, type NetworkError, type WeeklyReport, type WeeklyStory } from '../lib/api';
import {
  LIMITATION_LABEL,
  comparisonLines,
  dayCells,
  formatWait,
  formatWeekRange,
  statCards,
  weekProgress,
} from '../lib/insights';

interface InsightsViewProps {
  onOpenLogModal: (prompt?: string) => void;
  onNavigateToCoach: () => void;
}

function requestIdOf(error: ApiError | NetworkError | null): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}

const RequestId: React.FC<{ error: ApiError | NetworkError | null }> = ({ error }) =>
  requestIdOf(error) ? (
    <p className="text-[10px] text-[#bda99f] font-mono break-all">Request {requestIdOf(error)}</p>
  ) : null;

const primaryButton =
  'px-5 py-2.5 rounded-full bg-[#9f4118] hover:bg-[#ff8a5b] text-white text-xs font-bold shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed';

type Insights = ReturnType<typeof useWeeklyInsights>;

/**
 * This week, from `GET /api/insights/weekly`, and its story, from
 * `POST /api/insights/weekly/story` when the person asks for it.
 *
 * Every figure, comparison, pattern and limitation on this page is the backend's. The
 * page formats them; it does not compute one of its own, and a section the backend
 * reports as `no_data` says so instead of showing a zero. The story is rendered as the
 * server returned it — its caveats included — and nothing here rewrites or adds to it.
 */
export const InsightsView: React.FC<InsightsViewProps> = ({ onOpenLogModal }) => {
  const insights = useWeeklyInsights();
  // The story arrives with the report it was written from; show those figures beside it.
  const report = insights.story?.report ?? insights.report;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-[#9f4118] uppercase tracking-wider">
            <span>Weekly Synthesis</span>
            {report && (
              <>
                <span>•</span>
                <span className="text-[#56423b] font-medium">{formatWeekRange(report.period)}</span>
              </>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1e1b17] tracking-tight mt-1">Mindful Insights</h1>
        </div>
        {report && (
          <div className="flex items-center gap-2 text-xs text-[#8a726a] self-start sm:self-center">
            <span className="w-2 h-2 rounded-full bg-[#2b6952]" />
            <span>{weekProgress(report.period)}</span>
          </div>
        )}
      </div>

      {insights.status === 'loading' && !report && (
        <div role="status" className="bg-white rounded-3xl p-10 border border-[#eee7e1] shadow-xs text-center">
          <p className="text-xs text-[#bda99f] font-medium">Gathering your week…</p>
        </div>
      )}

      {insights.status === 'error' && (
        <div className="bg-white rounded-3xl p-6 border border-[#ffdbce] shadow-xs space-y-2">
          <p className="text-sm font-bold text-[#1e1b17]">
            {report ? 'Could not refresh your week.' : 'Could not load your week.'}
          </p>
          <p className="text-xs text-[#56423b]">{insights.error?.message}</p>
          <RequestId error={insights.error} />
          <button
            type="button"
            onClick={insights.retry}
            className="px-4 py-1.5 rounded-full bg-[#ff8a5b] text-white text-xs font-bold hover:bg-[#f5763f] transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {report && <WeekBody report={report} insights={insights} onOpenLogModal={onOpenLogModal} />}

      {/* Reassurance Footer */}
      <div className="text-center py-4 text-xs text-[#8a726a]">
        AURA respects your pace. No guilt, no penalty rings, just mindful companionship.
      </div>
    </div>
  );
};

const WeekBody: React.FC<{
  report: WeeklyReport;
  insights: Insights;
  onOpenLogModal: (prompt?: string) => void;
}> = ({ report, insights, onOpenLogModal }) => {
  const story = insights.story?.status === 'ready' ? insights.story.story : null;
  const insufficient =
    report.coverage.status === 'insufficient_data' || insights.story?.status === 'insufficient_data';
  const comparisons = comparisonLines(report.comparison);

  return (
    <>
      {/* The story, or the backend's reason there is none */}
      <div className="bg-gradient-to-br from-[#faf2ec] via-white to-[#ffdbce]/25 rounded-3xl p-6 sm:p-8 border border-[#eee7e1] shadow-[0_12px_36px_-8px_rgba(45,42,38,0.06)] space-y-5">
        {insufficient ? (
          <NotEnoughData report={report} onOpenLogModal={onOpenLogModal} />
        ) : insights.story?.status === 'disabled' ? (
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-[#1e1b17]">Weekly story is off</h2>
            <p className="text-sm text-[#56423b]">
              AI insights are turned off in your settings, so no story was written. Your week's figures are below.
            </p>
          </div>
        ) : story ? (
          <StoryCard story={story} />
        ) : (
          <StoryRequest insights={insights} />
        )}
      </div>

      {/* YOUR WEEK · Here's what happened */}
      <div className="space-y-4">
        <h2 className="text-xl font-extrabold text-[#1e1b17]">YOUR WEEK · Here's what happened</h2>

        <div className="bg-white rounded-3xl p-5 border border-[#eee7e1] shadow-xs space-y-3">
          <p className="text-xs font-bold text-[#8a726a]">
            Logged on {report.coverage.daysTracked} of {report.coverage.daysElapsed}{' '}
            {report.coverage.daysElapsed === 1 ? 'day' : 'days'} so far
          </p>
          <ol className="grid grid-cols-7 gap-1.5">
            {dayCells(report).map((day) => (
              <li
                key={day.localDate}
                aria-label={`${day.weekday}: ${
                  day.state === 'logged' ? 'logged' : day.state === 'upcoming' ? 'not yet' : 'nothing logged'
                }`}
                className={`rounded-xl py-2 text-center text-[11px] font-bold border ${
                  day.state === 'logged'
                    ? 'bg-[#adedd0]/50 text-[#0b513b] border-[#adedd0]'
                    : day.state === 'not_logged'
                      ? 'bg-[#faf2ec] text-[#8a726a] border-[#eee7e1]'
                      : 'bg-white text-[#bda99f] border-dashed border-[#eee7e1]'
                }`}
              >
                {day.weekday}
              </li>
            ))}
          </ol>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statCards(report).map((card) => (
            <section
              key={card.label}
              aria-label={card.label}
              className="p-5 rounded-3xl bg-white border border-[#eee7e1] shadow-xs flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#8a726a]">{card.label}</span>
                <span className="text-xl">{card.icon}</span>
              </div>
              <div className="mt-4">
                <div
                  className={
                    card.value === null
                      ? 'text-base font-bold text-[#bda99f]'
                      : 'text-2xl sm:text-3xl font-black text-[#1e1b17]'
                  }
                >
                  {card.value ?? 'No data'}
                </div>
                <span className="text-[11px] text-[#56423b] font-semibold">{card.detail}</span>
              </div>
            </section>
          ))}
        </div>

        {comparisons.length > 0 && (
          <div className="bg-white rounded-3xl p-5 border border-[#eee7e1] shadow-xs space-y-1.5">
            <h3 className="text-sm font-bold text-[#1e1b17]">Compared with last week</h3>
            <ul className="space-y-1">
              {comparisons.map((line) => (
                <li key={line} className="text-xs text-[#56423b]">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Patterns the backend found, until a story narrates them with their caveats */}
        {!story && report.patterns.status === 'available' && report.patterns.items.length > 0 && (
          <div className="bg-white rounded-3xl p-5 border border-[#eee7e1] shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-[#1e1b17]">Patterns found</h3>
            <ul className="space-y-2">
              {report.patterns.items.map((pattern) => (
                <li key={pattern.id} className="text-xs text-[#56423b] space-y-0.5">
                  <p className="font-bold text-[#1e1b17]">
                    {pattern.objectLabel ? `${pattern.subjectLabel} · ${pattern.objectLabel}` : pattern.subjectLabel}
                  </p>
                  <p className="text-[#8a726a]">{pattern.caveat}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Suggestions — only the ones the story carried */}
      {story && story.suggestions.length > 0 && (
        <div className="bg-gradient-to-r from-[#faf2ec] via-white to-[#faf2ec] rounded-3xl p-6 sm:p-8 border border-[#eee7e1] shadow-xs space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#9f4118]">Forward Horizon</span>
              <h2 className="text-xl font-bold text-[#1e1b17] mt-0.5">For next week</h2>
            </div>
            <span className="px-3 py-1 bg-[#adedd0] text-[#306d56] rounded-full text-xs font-bold">Suggested by AURA</span>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {story.suggestions.map((suggestion) => (
              <li
                key={suggestion.text}
                className="p-4 bg-[#fff8f3] rounded-2xl border border-[#ffdbce]/60 text-xs text-[#56423b]"
              >
                {suggestion.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.dataQuality.limitations.length > 0 && (
        <div className="p-5 rounded-3xl bg-white border border-[#eee7e1] space-y-2">
          <h3 className="text-sm font-bold text-[#1e1b17]">About this week's data</h3>
          <ul className="space-y-1">
            {report.dataQuality.limitations.map((code) => (
              <li key={code} className="text-xs text-[#56423b]">
                {LIMITATION_LABEL[code]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
};

/**
 * The cold start. The backend decided this week has too little logged to describe; the
 * page says how much it has — the backend's own counts — and names no threshold the
 * backend did not send.
 */
const NotEnoughData: React.FC<{ report: WeeklyReport; onOpenLogModal: (prompt?: string) => void }> = ({
  report,
  onOpenLogModal,
}) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2">
      <span className="text-xl">🌱</span>
      <h2 className="text-xl font-bold text-[#1e1b17]">Not enough data yet</h2>
    </div>
    <p className="text-sm text-[#56423b]">
      So far this week, something was logged on {report.coverage.daysTracked} of {report.coverage.daysElapsed}{' '}
      {report.coverage.daysElapsed === 1 ? 'day' : 'days'}. That is not enough for AURA to describe the week
      honestly, so there is no story yet. The figures below are what has been logged.
    </p>
    <button type="button" onClick={() => onOpenLogModal()} className={primaryButton}>
      + Log a moment
    </button>
  </div>
);

/** The explicit request for a story — the only way one is ever asked for. */
const StoryRequest: React.FC<{ insights: Insights }> = ({ insights }) => {
  const { storyStatus, storyError } = insights;
  const wait = storyError instanceof ApiError ? formatWait(storyError.retryAfterSeconds) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xl">👀</span>
        <h2 className="text-xl font-bold text-[#1e1b17]">Your week's story</h2>
      </div>
      <p className="text-sm text-[#56423b]">
        AURA can write a short story of this week from the figures below. It is written only when you ask, and
        only a few can be written each day.
      </p>
      {storyStatus === 'error' && (
        <div className="p-3 rounded-2xl bg-white border border-[#ffdbce] space-y-1">
          <p className="text-xs text-[#56423b]">The story could not be written. {storyError?.message}</p>
          {wait && <p className="text-[11px] text-[#8a726a]">You can ask again in about {wait}.</p>}
          <RequestId error={storyError} />
        </div>
      )}
      <button
        type="button"
        onClick={insights.generateStory}
        disabled={storyStatus === 'generating'}
        className={primaryButton}
      >
        {storyStatus === 'generating'
          ? 'Writing your story…'
          : storyStatus === 'error'
            ? 'Try again'
            : "Write my week's story"}
      </button>
    </div>
  );
};

/** The story exactly as the server returned it. Nothing is reworded, and nothing is added. */
const StoryCard: React.FC<{ story: WeeklyStory }> = ({ story }) => (
  <article className="space-y-5">
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">👀</span>
        <h2 className="text-xl font-bold text-[#1e1b17]">{story.headline}</h2>
      </div>
      <span className="px-3 py-1 rounded-full bg-[#ffdbce] text-[#7f2b01] text-xs font-bold flex-shrink-0">
        Written by AURA
      </span>
    </div>

    <p className="text-base sm:text-lg text-[#1e1b17] font-medium leading-relaxed">{story.summary.text}</p>

    {story.highlights.length > 0 && (
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {story.highlights.map((highlight) => (
          <li
            key={highlight.text}
            className="bg-white p-4 rounded-2xl border border-[#eee7e1] shadow-xs text-xs text-[#56423b]"
          >
            {highlight.text}
          </li>
        ))}
      </ul>
    )}

    {story.patterns.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-[#1e1b17]">Patterns</h3>
        <ul className="space-y-2">
          {story.patterns.map((pattern) => (
            <li key={pattern.patternId} className="bg-white p-4 rounded-2xl border border-[#eee7e1] space-y-1">
              <p className="text-xs text-[#1e1b17]">{pattern.statement}</p>
              <p className="text-[11px] text-[#8a726a]">{pattern.caveat}</p>
            </li>
          ))}
        </ul>
      </div>
    )}

    {story.interpretations.map((interpretation) => (
      <div
        key={interpretation.text}
        className="p-3.5 rounded-2xl bg-[#adedd0]/30 border border-[#adedd0] flex items-start gap-2.5"
      >
        <span className="text-base mt-0.5">💬</span>
        <p className="text-xs text-[#0b513b] leading-relaxed">{interpretation.text}</p>
      </div>
    ))}

    {story.caveats.length > 0 && (
      <ul className="space-y-1">
        {story.caveats.map((caveat) => (
          <li key={caveat.text} className="text-[11px] text-[#8a726a]">
            {caveat.text}
          </li>
        ))}
      </ul>
    )}
  </article>
);

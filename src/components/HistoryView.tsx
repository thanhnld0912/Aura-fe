import React from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useEventHistory } from '../hooks/useEventHistory';
import { ApiError, type NetworkError } from '../lib/api';
import { groupByDay } from '../lib/history';

interface HistoryViewProps {
  onOpenLogModal: (prompt?: string) => void;
}

function requestIdOf(error: ApiError | NetworkError | null): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}

/**
 * Everything logged, newest first, from `GET /api/events`.
 *
 * Every entry is a server event. The prototype's range toggle and type chips are gone
 * with its fixtures: they filtered a hard-coded list, and applying them to only the pages
 * loaded so far would hide older matches rather than find them. The per-entry
 * "reflection" is gone too — nothing writes one.
 */
export const HistoryView: React.FC<HistoryViewProps> = ({ onOpenLogModal }) => {
  const { user } = useAuth();
  const history = useEventHistory();
  const days = groupByDay(history.events, user?.timezone);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-bold text-[#9f4118] uppercase tracking-wider">
          <span>Rhythm Archive</span>
          <span>•</span>
          <span className="text-[#56423b] font-medium">Memory Journal</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1e1b17] tracking-tight mt-1">History</h1>
      </div>

      {history.status === 'loading' && (
        <div role="status" className="bg-white rounded-3xl p-10 border border-[#eee7e1] shadow-xs text-center">
          <p className="text-xs text-[#bda99f] font-medium">Loading your history…</p>
        </div>
      )}

      {history.status === 'error' && (
        <div className="bg-white rounded-3xl p-6 border border-[#ffdbce] shadow-xs space-y-2">
          <p className="text-sm font-bold text-[#1e1b17]">Could not load your history.</p>
          <p className="text-xs text-[#56423b]">{history.error?.message}</p>
          {requestIdOf(history.error) && (
            <p className="text-[10px] text-[#bda99f] font-mono break-all">Request {requestIdOf(history.error)}</p>
          )}
          <button
            type="button"
            onClick={history.retry}
            className="px-4 py-1.5 rounded-full bg-[#ff8a5b] text-white text-xs font-bold hover:bg-[#f5763f] transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {history.status === 'success' && days.length === 0 && (
        <div className="bg-white rounded-3xl p-10 border border-[#eee7e1] shadow-xs text-center space-y-1">
          <p className="text-sm font-bold text-[#1e1b17]">No activity yet</p>
          <p className="text-xs text-[#8a726a]">What you log will be kept here, day by day.</p>
        </div>
      )}

      {/* Timeline Days */}
      {days.length > 0 && (
        <div className="space-y-6">
          {days.map((day, index) => (
            <section
              key={`${day.localDate}-${index}`}
              aria-label={day.heading}
              className="bg-white rounded-3xl p-6 border border-[#eee7e1] shadow-xs space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#eee7e1]">
                <h2 className="text-base font-bold text-[#1e1b17]">{day.heading}</h2>
                <span className="text-xs text-[#2b6952] font-semibold">
                  {day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>

              <ul className="space-y-4">
                {day.entries.map((entry) => (
                  <li key={entry.id} className="p-4 rounded-2xl bg-[#faf2ec]/60 border border-[#eee7e1] space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#9f4118]">{entry.time}</span>
                        <h3 className="text-sm font-bold text-[#1e1b17]">{entry.title}</h3>
                      </div>
                      {entry.duration && (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white text-[#2b6952] border border-[#eee7e1]">
                          {entry.duration}
                        </span>
                      )}
                    </div>
                    {entry.note && <p className="text-xs text-[#56423b] leading-relaxed">{entry.note}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Pagination */}
      {history.status === 'success' && history.hasMore && (
        <div className="flex flex-col items-center gap-2">
          {history.moreError && (
            <div className="w-full px-4 py-2.5 rounded-2xl bg-white border border-[#ffdbce] text-xs text-[#56423b]">
              Older entries could not be loaded. {history.moreError.message}
              {requestIdOf(history.moreError) && (
                <span className="text-[10px] text-[#bda99f] font-mono ml-1">Request {requestIdOf(history.moreError)}</span>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={history.loadMore}
            disabled={history.loadingMore}
            className="px-5 py-2 rounded-full bg-[#faf2ec] text-[#9f4118] text-xs font-bold border border-[#eee7e1] hover:bg-[#eee7e1] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {history.loadingMore ? 'Loading…' : history.moreError ? 'Try again' : 'Load more'}
          </button>
        </div>
      )}

      {history.status === 'success' && !history.hasMore && days.length > 0 && (
        <p className="text-center text-[11px] text-[#bda99f] font-medium">That's everything so far.</p>
      )}

      {/* Bottom log invitation */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-[#faf2ec] via-white to-[#faf2ec] border border-[#eee7e1] text-center space-y-2">
        <h3 className="text-base font-bold text-[#1e1b17]">Something to add?</h3>
        <p className="text-xs text-[#56423b]">
          Every moment logged without guilt builds self-compassion over time.
        </p>
        <button
          onClick={() => onOpenLogModal()}
          className="mt-2 px-5 py-2 rounded-full bg-[#9f4118] text-white text-xs font-bold hover:bg-[#ff8a5b] transition-colors"
        >
          + Log a moment
        </button>
      </div>
    </div>
  );
};

import React from 'react';
import { ApiError } from '../../lib/api';
import { describeFailure } from './failure';
import type { RequestError } from './state';

/** A failed request, inline — never a silent fallback to invented data. */
export const ErrorAlert: React.FC<{ error: RequestError; onDismiss: () => void }> = ({ error, onDismiss }) => (
  <div role="alert" className="mb-6 rounded-2xl border border-[#ffdad6] bg-[#ffdad6]/30 p-4 space-y-2">
    <div className="flex items-start gap-2.5">
      <span className="material-symbols-outlined text-[#93000a] text-[20px]">error</span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-[#93000a]">{describeFailure(error)}</p>
        {error instanceof ApiError && error.details && (
          <ul className="text-xs text-[#93000a]/90 mt-1 space-y-0.5">
            {error.details.map((detail) => (
              <li key={`${detail.path}-${detail.issue}`}>
                {detail.path}: {detail.issue}
              </li>
            ))}
          </ul>
        )}
        {error instanceof ApiError && error.requestId && (
          <p className="text-[10px] text-[#93000a]/70 mt-1 font-mono break-all">Request {error.requestId}</p>
        )}
      </div>
    </div>
    <button
      type="button"
      onClick={onDismiss}
      className="px-4 py-1.5 rounded-full bg-[#9f4118] text-white text-xs font-bold hover:bg-[#ff8a5b] transition-colors"
    >
      Back to editing
    </button>
  </div>
);

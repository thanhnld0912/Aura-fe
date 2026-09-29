import React, { useState } from 'react';
import { useCoachChat, type CoachMessage } from '../hooks/useCoachChat';
import { ApiError, type AgentChatResponse, type NetworkError } from '../lib/api';
import { AGENT_MESSAGE_MAX_LENGTH, describeChatFailure, sectionKindLabel } from '../lib/coach';
import { ASSETS } from '../data/initialData';

/**
 * Talk with AURA.
 *
 * Every assistant word on this screen came from `POST /api/agent/chat` in this session.
 * There is no opening greeting, no example exchange, no canned reply and no timer
 * pretending to think: the previous version of this file had all four, and they were
 * indistinguishable from a working integration right up until someone read the network
 * tab.
 *
 * What is rendered is what the contract returns, in the shape it returns it. The four
 * reply kinds — `answer`, `boundary`, `support`, `disabled` — all arrive as a 200 and
 * are all shown as the assistant speaking, because that is what they are. This
 * component adds no interpretation to any of them, and in particular does not decorate
 * `support`: that text is the backend's crisis reply, written by people, and making it
 * louder or softer here would be this app forming its own opinion about a person's
 * safety.
 *
 * Timestamps are absent on purpose. The server sends none, the conversation lasts as
 * long as the screen does, and a clock reading invented next to a reply would be the
 * same class of fiction as the canned replies that used to live here.
 */

const bubbleBase = 'max-w-[80%] rounded-2xl p-4 text-xs sm:text-sm leading-relaxed';

/** The provenance line: the server's own audit list of what it read, verbatim. */
const UsedContext: React.FC<{ used: string[] }> = ({ used }) =>
  used.length === 0 ? null : (
    <p className="mt-3 pt-2 border-t border-[#eee7e1] text-[10px] text-[#8a726a]">
      Based on{' '}
      <span className="font-mono text-[#56423b]">{used.join(', ')}</span>
    </p>
  );

/** One reply, field by field. Nothing is reworded and nothing is added. */
const ReplyBody: React.FC<{ reply: AgentChatResponse }> = ({ reply }) => (
  <>
    <p className="whitespace-pre-wrap">{reply.answer.text}</p>

    {reply.sections.map((section, index) => (
      <div key={index} className="mt-3 pt-3 border-t border-[#eee7e1] space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="font-bold text-[#1e1b17]">{section.title}</h3>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8a726a]">
            {sectionKindLabel(section.kind)}
          </span>
        </div>
        <p className="whitespace-pre-wrap">{section.text}</p>
      </div>
    ))}

    {reply.suggestions.length > 0 && (
      <ul className="mt-3 space-y-1.5">
        {reply.suggestions.map((suggestion, index) => (
          <li
            key={index}
            className="px-3 py-1.5 rounded-2xl bg-white text-[#0b513b] text-xs font-semibold border border-[#adedd0]"
          >
            🌿 {suggestion.text}
          </li>
        ))}
      </ul>
    )}

    {reply.caveats.length > 0 && (
      <ul className="mt-3 space-y-1">
        {reply.caveats.map((caveat, index) => (
          <li key={index} className="text-[11px] text-[#8a726a] leading-relaxed">
            {caveat.text}
          </li>
        ))}
      </ul>
    )}

    <UsedContext used={reply.usedContext} />
  </>
);

const Bubble: React.FC<{ message: CoachMessage }> = ({ message }) => (
  <div className={`flex items-start gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
    {message.role === 'assistant' ? (
      <div className="w-9 h-9 rounded-full bg-[#ffdbce] text-[#7f2b01] flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-xs">
        ✨
      </div>
    ) : (
      <img
        alt="You"
        src={ASSETS.thanhAvatar}
        className="w-9 h-9 rounded-full object-cover ring-2 ring-[#ffdbce] flex-shrink-0"
      />
    )}
    <div
      className={
        message.role === 'user'
          ? `${bubbleBase} bg-[#9f4118] text-white rounded-tr-none`
          : `${bubbleBase} bg-[#faf2ec] text-[#1e1b17] rounded-tl-none border border-[#eee7e1]`
      }
    >
      {message.role === 'user' ? (
        <p className="whitespace-pre-wrap">{message.text}</p>
      ) : (
        <ReplyBody reply={message.reply} />
      )}
    </div>
  </div>
);

/** A failed send: what went wrong, when it can be tried again, and the id to quote. */
const SendFailure: React.FC<{
  error: ApiError | NetworkError;
  onRetry: () => void;
}> = ({ error, onRetry }) => {
  const failure = describeChatFailure(error);

  return (
    <div role="alert" className="p-3 rounded-2xl bg-white border border-[#ffdbce] space-y-1.5 ml-12">
      <p className="text-xs text-[#56423b]">{failure.message}</p>
      {failure.wait && (
        <p className="text-[11px] text-[#8a726a]">You can try again in about {failure.wait}.</p>
      )}
      {failure.requestId && (
        <p className="text-[10px] text-[#bda99f] font-mono break-all">Request {failure.requestId}</p>
      )}
      {failure.retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 px-3 py-1.5 rounded-full bg-[#ff8a5b] hover:bg-[#f5763f] text-white text-xs font-bold transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
};

/**
 * Before the first message. Guidance, not a fabricated opening line: it says what this
 * assistant can be asked about, which is the same scope the backend enforces.
 */
const EmptyState: React.FC = () => (
  <div className="h-full flex flex-col items-center justify-center text-center px-6">
    <div className="w-12 h-12 rounded-full bg-[#ffdbce] text-[#7f2b01] flex items-center justify-center text-lg shadow-xs">
      ✨
    </div>
    <p className="mt-3 text-sm font-bold text-[#1e1b17]">Ask AURA about your rhythm</p>
    <p className="mt-1 text-xs text-[#8a726a] leading-relaxed max-w-xs">
      Your meals, your plan, your week, your check-ins. Each message is answered on its own —
      this conversation is not saved.
    </p>
  </div>
);

const quickPrompts = [
  'How did my meals go today?',
  'What does my week look like so far?',
  'How am I doing against my plan?',
  'What have my check-ins been like?',
];

export const AICoachView: React.FC = () => {
  const chat = useCoachChat();
  const [inputVal, setInputVal] = useState('');

  const sending = chat.status === 'sending';

  const submit = (text: string): void => {
    if (!chat.canSend(text)) return;
    chat.send(text);
    setInputVal('');
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-[#9f4118] uppercase tracking-wider">
            <span>Mindful AI Companion</span>
            <span>•</span>
            <span className="text-[#56423b] font-medium">Safe Reflection</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1e1b17] tracking-tight mt-1">
            Talk with AURA
          </h1>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#e6deff] text-[#1b0062] text-xs font-bold self-start sm:self-center">
          <span>✨</span>
          <span>Zero Guilt · Gentle Coaching</span>
        </div>
      </div>

      {/* Quick Prompt Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => submit(prompt)}
            disabled={sending}
            className="px-3.5 py-1.5 rounded-full bg-white hover:bg-[#ffdbce] text-xs font-semibold text-[#1e1b17] border border-[#eee7e1] transition-all flex-shrink-0 shadow-xs active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Chat Container */}
      <div className="bg-white rounded-3xl p-6 border border-[#eee7e1] shadow-xs flex flex-col h-[500px]">
        {/* Messages scroll area */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {chat.messages.length === 0 && chat.status !== 'sending' ? (
            <EmptyState />
          ) : (
            chat.messages.map((message) => <Bubble key={message.id} message={message} />)
          )}

          {/* Driven by the request itself: it is on screen exactly while the POST is open. */}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-[#8a726a] pl-12">
              <span className="w-2 h-2 rounded-full bg-[#ff8a5b] animate-pulse" />
              <span>AURA is reflecting gently...</span>
            </div>
          )}

          {chat.status === 'error' && chat.error && (
            <SendFailure error={chat.error} onRetry={chat.retry} />
          )}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(inputVal);
          }}
          className="pt-4 border-t border-[#eee7e1] flex items-center gap-2"
        >
          <input
            type="text"
            aria-label="Message AURA"
            placeholder="Ask AURA about your meals, your plan or your week..."
            value={inputVal}
            maxLength={AGENT_MESSAGE_MAX_LENGTH}
            disabled={sending}
            onChange={(event) => setInputVal(event.target.value)}
            className="flex-1 bg-[#faf2ec] px-4 py-2.5 rounded-full text-xs sm:text-sm text-[#1e1b17] placeholder:text-[#8a726a] focus:outline-none border border-transparent focus:border-[#ff8a5b] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!chat.canSend(inputVal)}
            className="px-5 py-2.5 rounded-full bg-[#9f4118] hover:bg-[#ff8a5b] text-white text-xs font-bold transition-all flex items-center gap-1 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>{sending ? 'Sending…' : 'Send'}</span>
            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
          </button>
        </form>
      </div>
    </div>
  );
};

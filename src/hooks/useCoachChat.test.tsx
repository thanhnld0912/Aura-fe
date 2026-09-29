import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState, AuthStatus } from '../auth/AuthProvider';
import { answerReply, boundaryReply, errorEnvelope, supportReply } from '../test/coach';
import { useCoachChat } from './useCoachChat';

/**
 * The Coach hook through a probe component, with the real API client underneath — so
 * every request asserted here is what `apiRequest` actually sends.
 */

const authState = vi.hoisted(() => ({
  current: { status: 'signed-in' as AuthStatus, userId: 'user-1' as string | null },
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: (): AuthState =>
    ({
      status: authState.current.status,
      user: authState.current.userId ? { id: authState.current.userId } : null,
    }) as unknown as AuthState,
}));

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({ auth: {} }),
  getAccessToken: async () => 'a.supabase.jwt',
}));

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const fetchMock = vi.fn();
let answerChat: () => Promise<Response>;

beforeEach(() => {
  authState.current = { status: 'signed-in', userId: 'user-1' };
  answerChat = async () => json(200, answerReply());
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/agent/chat')) return answerChat();
    throw new Error(`unexpected request ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const chatCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/agent/chat'));
const bodyOf = (call: unknown[]): unknown => JSON.parse((call[1] as RequestInit).body as string);

const Probe: React.FC<{ text?: string }> = ({ text = 'How did today go?' }) => {
  const chat = useCoachChat();
  return (
    <div>
      <span data-testid="status">{chat.status}</span>
      <span data-testid="pending">{chat.pending ?? 'none'}</span>
      <span data-testid="error">{chat.error ? `${chat.error.name}:${chat.error.message}` : ''}</span>
      <span data-testid="count">{chat.messages.length}</span>
      <span data-testid="transcript">
        {chat.messages
          .map((message) => (message.role === 'user' ? `u:${message.text}` : `a:${message.reply.kind}`))
          .join('|')}
      </span>
      <button type="button" onClick={() => chat.send(text)}>
        Send
      </button>
      <button
        type="button"
        onClick={() => {
          chat.send(text);
          chat.send(text);
        }}
      >
        Send twice
      </button>
      <button type="button" onClick={chat.retry}>
        Retry
      </button>
    </div>
  );
};

describe('before anything is sent', () => {
  it('starts empty and sends nothing on mount', async () => {
    render(<Probe />);

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
    // A mount must never cost a model run.
    await waitFor(() => expect(chatCalls()).toHaveLength(0));
  });

  it('sends nothing on mount under StrictMode either', async () => {
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(chatCalls()).toHaveLength(0);
  });
});

describe('sending a message', () => {
  it('posts exactly the contract body and nothing else', async () => {
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    const [url, init] = chatCalls()[0] as [string, RequestInit];

    expect(url).toBe('http://localhost:3001/api/agent/chat');
    expect(init.method).toBe('POST');
    // Strict schema server-side: a conversation id or a history array would be a 400.
    expect(bodyOf(chatCalls()[0])).toEqual({ message: 'How did today go?' });
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer a.supabase.jwt');
  });

  it('appends the user message, then the assistant reply, in that order', async () => {
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(screen.getByTestId('transcript')).toHaveTextContent('u:How did today go?|a:answer');
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
  });

  it('is pending only while the request is open', async () => {
    let release: (() => void) | undefined;
    answerChat = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(json(200, answerReply()));
      });

    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('sending'));
    // The user's line is already visible; the assistant's is not invented ahead of it.
    expect(screen.getByTestId('transcript')).toHaveTextContent('u:How did today go?');
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    release?.();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('trims the message before sending it', async () => {
    render(<Probe text="   spaced out   " />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    expect(bodyOf(chatCalls()[0])).toEqual({ message: 'spaced out' });
  });

  it('refuses an empty message rather than spending a 400 on it', async () => {
    render(<Probe text="   " />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(chatCalls()).toHaveLength(0);
  });

  it('refuses a message past the 2000-character cap', async () => {
    render(<Probe text={'a'.repeat(2001)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(chatCalls()).toHaveLength(0);
  });
});

describe('not sending the same message twice', () => {
  it('collapses two calls in the same frame into one request', async () => {
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send twice' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(chatCalls()).toHaveLength(1);
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('ignores a second send while the first is still open', async () => {
    let release: (() => void) | undefined;
    answerChat = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(json(200, answerReply()));
      });

    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('sending'));

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(chatCalls()).toHaveLength(1);

    release?.();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(chatCalls()).toHaveLength(1);
  });

  it('sends once under StrictMode', async () => {
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(chatCalls()).toHaveLength(1);
  });
});

describe('the four reply kinds are answers, not failures', () => {
  it('renders a support reply as an ordinary assistant turn', async () => {
    answerChat = async () => json(200, supportReply());
    render(<Probe text="I feel hopeless" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(screen.getByTestId('transcript')).toHaveTextContent('a:support');
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('renders a boundary reply as an ordinary assistant turn', async () => {
    answerChat = async () => json(200, boundaryReply());
    render(<Probe text="write me a poem" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('transcript')).toHaveTextContent('a:boundary'));
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });
});

describe('when a send fails', () => {
  const failWith = (status: number, code: string, headers: Record<string, string> = {}) => {
    answerChat = async () => json(status, errorEnvelope(code, `failed with ${status}`), headers);
  };

  it('keeps the user message, keeps it pending, and does not append a reply', async () => {
    failWith(503, 'PROVIDER_UNAVAILABLE');
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('transcript')).toHaveTextContent('u:How did today go?');
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('pending')).toHaveTextContent('How did today go?');
  });

  it('retries the pending message without adding a second copy of it', async () => {
    failWith(503, 'PROVIDER_UNAVAILABLE');
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));

    answerChat = async () => json(200, answerReply());
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(chatCalls()).toHaveLength(2);
    expect(bodyOf(chatCalls()[1])).toEqual({ message: 'How did today go?' });
    // One user line, one reply — not two user lines.
    expect(screen.getByTestId('transcript')).toHaveTextContent('u:How did today go?|a:answer');
  });

  it('does nothing on retry when there is nothing pending', async () => {
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('idle'));
    expect(chatCalls()).toHaveLength(0);
  });

  it('never retries on its own', async () => {
    failWith(502, 'PROVIDER_ERROR');
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chatCalls()).toHaveLength(1);
  });

  it('surfaces a 429 with its Retry-After and keeps the conversation', async () => {
    answerChat = async () => json(200, answerReply());
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));

    failWith(429, 'RATE_LIMITED', { 'Retry-After': '120' });
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    // The earlier exchange is untouched; the new user line is kept too.
    expect(screen.getByTestId('transcript')).toHaveTextContent(
      'u:How did today go?|a:answer|u:How did today go?',
    );
  });

  it('reports a 401 as an ordinary failure and leaves the session alone', async () => {
    failWith(401, 'UNAUTHENTICATED');
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('ApiError');
    // Still signed in as far as this hook is concerned: it owns no session state.
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  it('reports a network failure', async () => {
    answerChat = async () => {
      throw new TypeError('Failed to fetch');
    };
    render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('NetworkError'));
    expect(screen.getByTestId('pending')).toHaveTextContent('How did today go?');
  });
});

describe('whose conversation it is', () => {
  it('clears the transcript when a different person signs in', async () => {
    const { rerender } = render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));

    authState.current = { status: 'signed-in', userId: 'user-2' };
    rerender(<Probe />);

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
  });

  it('clears the transcript on sign-out', async () => {
    const { rerender } = render(<Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));

    authState.current = { status: 'signed-out', userId: null };
    rerender(<Probe />);

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
  });
});

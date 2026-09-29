import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/AuthProvider';
import { answerReply, boundaryReply, disabledReply, errorEnvelope, supportReply } from '../test/coach';
import { AICoachView } from './AICoachView';

/**
 * The Coach screen renders the backend's reply and nothing else: no opening greeting, no
 * example exchange, no canned answer, no invented clock — and no assistant turn at all
 * until a real response has arrived.
 */

vi.mock('../auth/AuthProvider', () => ({
  useAuth: (): AuthState =>
    ({ status: 'signed-in', user: { id: 'user-1' } }) as unknown as AuthState,
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
const input = () => screen.getByRole('textbox', { name: 'Message AURA' });
const sendButton = () => screen.getByRole('button', { name: /Send/ });

describe('the empty screen', () => {
  it('opens with guidance and no conversation', async () => {
    render(<AICoachView />);

    expect(screen.getByText('Ask AURA about your rhythm')).toBeInTheDocument();
    expect(screen.getByText(/this conversation is not saved/i)).toBeInTheDocument();
    await waitFor(() => expect(chatCalls()).toHaveLength(0));
  });

  it('carries none of the prototype conversation', () => {
    render(<AICoachView />);

    // The three fixtures the old file shipped with.
    expect(screen.queryByText(/I am your mindful companion AURA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/I felt a bit guilty/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/true health craftsmanship/i)).not.toBeInTheDocument();
  });

  it('disables Send until something is typed', async () => {
    render(<AICoachView />);

    expect(sendButton()).toBeDisabled();
    await userEvent.type(input(), 'hello');
    expect(sendButton()).toBeEnabled();
  });
});

describe('sending', () => {
  it('shows the question, then the answer the server actually returned', async () => {
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    expect(await screen.findByText('How did today go?')).toBeInTheDocument();
    expect(
      await screen.findByText(/You logged lunch and dinner today/),
    ).toBeInTheDocument();
  });

  it('clears the input on a successful send', async () => {
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    await waitFor(() => expect(input()).toHaveValue(''));
  });

  it('renders sections, suggestions, caveats and the provenance line', async () => {
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    expect(await screen.findByText('Meals')).toBeInTheDocument();
    expect(screen.getByText('A gentler evening')).toBeInTheDocument();
    // The three section kinds stay distinguishable.
    expect(screen.getByText('From your data')).toBeInTheDocument();
    expect(screen.getByText('A possible reading')).toBeInTheDocument();
    expect(screen.getByText(/A vegetable at lunch/)).toBeInTheDocument();
    expect(screen.getByText(/not a cause/)).toBeInTheDocument();
    expect(screen.getByText('meals:today, events:today')).toBeInTheDocument();
  });

  it('shows the loading state only while the request is open', async () => {
    let release: (() => void) | undefined;
    answerChat = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(json(200, answerReply()));
      });

    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    expect(await screen.findByText(/AURA is reflecting gently/)).toBeInTheDocument();
    // No assistant text before the response — the whole point.
    expect(screen.queryByText(/You logged lunch and dinner/)).not.toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(input()).toBeDisabled();

    release?.();
    await waitFor(() =>
      expect(screen.queryByText(/AURA is reflecting gently/)).not.toBeInTheDocument(),
    );
  });

  it('sends one request when the button is double-clicked', async () => {
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.dblClick(sendButton());

    await waitFor(() => expect(screen.getByText(/You logged lunch/)).toBeInTheDocument());
    expect(chatCalls()).toHaveLength(1);
  });

  it('sends a quick prompt as an ordinary message', async () => {
    render(<AICoachView />);
    await userEvent.click(screen.getByRole('button', { name: 'How did my meals go today?' }));

    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    const body = JSON.parse((chatCalls()[0][1] as RequestInit).body as string) as { message: string };
    expect(body).toEqual({ message: 'How did my meals go today?' });
  });

  it('shows no timestamp anywhere, because the server sends none', async () => {
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    await screen.findByText(/You logged lunch/);
    expect(screen.queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  });
});

describe('the reply kinds the backend can send', () => {
  it('shows a support reply verbatim, with nothing added to it', async () => {
    answerChat = async () => json(200, supportReply());
    render(<AICoachView />);
    await userEvent.type(input(), 'I feel hopeless');
    await userEvent.click(sendButton());

    expect(await screen.findByText(supportReply().answer.text)).toBeInTheDocument();
    // Not dressed up as an error, and not given a warning banner this app invented.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a boundary reply as an ordinary turn', async () => {
    answerChat = async () => json(200, boundaryReply());
    render(<AICoachView />);
    await userEvent.type(input(), 'write me a poem');
    await userEvent.click(sendButton());

    expect(await screen.findByText(/I focus on health, nutrition/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("shows the disabled reply and points at the person's own settings", async () => {
    answerChat = async () => json(200, disabledReply());
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    expect(await screen.findByText(/AI features are turned off in your settings/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('when a send fails', () => {
  const failWith = (status: number, code: string, message: string, headers: Record<string, string> = {}) => {
    answerChat = async () => json(status, errorEnvelope(code, message), headers);
  };

  it('keeps the question on screen and offers a retry', async () => {
    failWith(503, 'PROVIDER_UNAVAILABLE', 'The assistant is not available right now');
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The AI service is temporarily unavailable.',
    );
    expect(screen.getByText('How did today go?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('resends on retry without duplicating the question', async () => {
    failWith(503, 'PROVIDER_UNAVAILABLE', 'down');
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());
    await screen.findByRole('alert');

    answerChat = async () => json(200, answerReply());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText(/You logged lunch/)).toBeInTheDocument());
    expect(chatCalls()).toHaveLength(2);
    expect(screen.getAllByText('How did today go?')).toHaveLength(1);
  });

  it('shows the wait and the request id on a 429, and does not retry by itself', async () => {
    answerChat = async () =>
      json(429, errorEnvelope('RATE_LIMITED', 'Too many requests', 'req-9'), {
        'Retry-After': '300',
      });
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You have reached the chat limit for now.');
    expect(alert).toHaveTextContent('about 5 min');
    expect(alert).toHaveTextContent('Request req-9');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chatCalls()).toHaveLength(1);
  });

  it('offers no retry on a 502, which the backend says would fail the same way', async () => {
    failWith(502, 'PROVIDER_ERROR', 'The AI provider could not complete this request');
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The AI service could not complete this request.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('never replaces a failure with an assistant message', async () => {
    failWith(502, 'PROVIDER_ERROR', 'provider refused');
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    await screen.findByRole('alert');
    expect(screen.queryByText(/You logged lunch/)).not.toBeInTheDocument();
    expect(screen.queryByText(/consistency is not about doing 100%/i)).not.toBeInTheDocument();
  });

  it('explains a 401 without offering a retry', async () => {
    failWith(401, 'UNAUTHENTICATED', 'Missing or invalid token');
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('lets the next message be sent after a failure', async () => {
    failWith(503, 'PROVIDER_UNAVAILABLE', 'down');
    render(<AICoachView />);
    await userEvent.type(input(), 'How did today go?');
    await userEvent.click(sendButton());
    await screen.findByRole('alert');

    answerChat = async () => json(200, answerReply());
    await userEvent.type(input(), 'And my week?');
    await userEvent.click(sendButton());

    await waitFor(() => expect(screen.getByText(/You logged lunch/)).toBeInTheDocument());
    expect(screen.getByText('And my week?')).toBeInTheDocument();
  });
});

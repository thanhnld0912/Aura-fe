import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

/**
 * Configuration is the frontend's only real security surface: everything here is
 * compiled into a bundle anyone can read. These tests are about the mistakes that
 * would still *work* — the ones nothing else would catch.
 */

const anonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.not-a-real-signature'; // gitleaks:allow
// role: "service_role" — the key that bypasses Row Level Security.
const serviceRoleKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.not-a-real-signature'; // gitleaks:allow

const valid = {
  VITE_SUPABASE_URL: 'https://testproject.supabase.co',
  VITE_SUPABASE_ANON_KEY: anonKey,
  VITE_API_BASE_URL: 'http://localhost:3001/api',
};

describe('readConfig', () => {
  it('accepts a well-formed environment', () => {
    expect(readConfig(valid)).toEqual({
      supabaseUrl: 'https://testproject.supabase.co',
      supabaseAnonKey: anonKey,
      apiBaseUrl: 'http://localhost:3001/api',
    });
  });

  it('trims a trailing slash so paths do not double up', () => {
    const config = readConfig({ ...valid, VITE_API_BASE_URL: 'http://localhost:3001/api/' });
    expect(config.apiBaseUrl).toBe('http://localhost:3001/api');
  });

  it('defaults the API base URL to the local backend', () => {
    const { VITE_API_BASE_URL: _omitted, ...withoutApi } = valid;
    expect(readConfig(withoutApi).apiBaseUrl).toBe('http://localhost:3001/api');
  });

  /**
   * The one that matters. A service role key in the browser is every user's data
   * handed to every visitor, and it would work perfectly in development.
   */
  it('refuses a service role key', () => {
    expect(() => readConfig({ ...valid, VITE_SUPABASE_ANON_KEY: serviceRoleKey })).toThrow(
      /service role key/i,
    );
  });

  it('refuses a secret key and a personal access token', () => {
    expect(() =>
      readConfig({ ...valid, VITE_SUPABASE_ANON_KEY: 'sb_secret_abcdefghijklmnop' }),
    ).toThrow(/secret key/i);

    expect(() =>
      readConfig({ ...valid, VITE_SUPABASE_ANON_KEY: 'sbp_0123456789abcdef0123456789abcdef' }), // gitleaks:allow
    ).toThrow(/Personal Access Token/i);
  });

  it('refuses a service path in place of the project root', () => {
    for (const url of [
      'https://testproject.supabase.co/rest/v1',
      'https://testproject.supabase.co/auth/v1',
    ]) {
      expect(() => readConfig({ ...valid, VITE_SUPABASE_URL: url })).toThrow(/project root/i);
    }
  });

  it('names every missing variable at once rather than one per run', () => {
    let message = '';
    try {
      readConfig({});
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('VITE_SUPABASE_URL');
    expect(message).toContain('VITE_SUPABASE_ANON_KEY');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('CLIENT config', () => {
  let originalProcessEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalProcessEnv = process.env;
    process.env = { ...originalProcessEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalProcessEnv;
  });

  it('uses default values when env vars are missing', async () => {
    delete process.env.PUBLIC_CLIENT_NAME;
    delete process.env.PUBLIC_CLIENT_SLUG;
    delete process.env.PUBLIC_CLIENT_WHATSAPP;

    const { CLIENT, CLIENT_MENU_PATH, CLIENT_WA_NUMBER } = await import('./client');
    expect(CLIENT.restaurantName).toBe('Restaurante Demo');
    expect(CLIENT.slug).toBe('restaurante-demo');
    expect(CLIENT.whatsapp).toBe('+573005551234');
    expect(CLIENT_MENU_PATH).toBe('/restaurante-demo/menu');
    expect(CLIENT_WA_NUMBER).toBe('573005551234');
  });

  it('reads from env vars successfully', async () => {
    process.env.PUBLIC_CLIENT_NAME = 'Custom Name';
    process.env.PUBLIC_CLIENT_SLUG = 'custom-slug-123';
    process.env.PUBLIC_CLIENT_WHATSAPP = '+1234567890';

    const { CLIENT, CLIENT_MENU_PATH, CLIENT_WA_NUMBER } = await import('./client');
    expect(CLIENT.restaurantName).toBe('Custom Name');
    expect(CLIENT.slug).toBe('custom-slug-123');
    expect(CLIENT.whatsapp).toBe('+1234567890');
    expect(CLIENT_MENU_PATH).toBe('/custom-slug-123/menu');
    expect(CLIENT_WA_NUMBER).toBe('1234567890');
  });

  it('throws on invalid slug', async () => {
    process.env.PUBLIC_CLIENT_SLUG = 'Invalid Slug!';
    await expect(import('./client')).rejects.toThrow(/Invalid slug/);

    vi.resetModules();
    process.env.PUBLIC_CLIENT_SLUG = 'a'; // too short
    await expect(import('./client')).rejects.toThrow(/Invalid slug/);
  });

  it('throws on invalid whatsapp format', async () => {
    process.env.PUBLIC_CLIENT_SLUG = 'valid-slug';

    process.env.PUBLIC_CLIENT_WHATSAPP = '1234567890'; // missing +
    await expect(import('./client')).rejects.toThrow(/Invalid whatsapp/);

    vi.resetModules();
    process.env.PUBLIC_CLIENT_WHATSAPP = '+123abc456'; // has letters
    await expect(import('./client')).rejects.toThrow(/Invalid whatsapp/);
  });
});

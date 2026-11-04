import { test } from 'e2e';
import { expect } from 'e2e';

test('control room shows chats, model calls and the shop', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('heading', { name: 'Mesa Muse' })).toBeVisible();
  await expect(screen.getByText('Live', { exact: true })).toBeVisible();

  // Model pipeline: every model family that ran is shown, failures included.
  const steps = screen.getByRole('list').filter({ hasText: 'segment “orange drink bottle”' });
  await expect(steps).toContainText(/SAM 3\.1/);
  await expect(steps).toContainText('2 objects cut out');
  await expect(steps).toContainText(/muse voice transcribe/i);
  await expect(steps).toContainText('Failed: sample failure');

  // Shop: live, catalog with prices, order.
  await expect(screen.getByRole('heading', { name: /Sample Stall/ })).toBeVisible();
  await expect(screen.getByText('K45', { exact: true })).toBeVisible();
  await expect(screen.getByText('K90', { exact: true }).first()).toBeVisible();
  await expect(screen.getByText('Test Buyer', { exact: false })).toBeVisible();
});

test('operator switches between conversations', async ({ app, agent, screen }) => {
  await app.open('/');
  await agent.act('open the WhatsApp conversation with the shop owner, Sample Stall');
  await expect(screen.getByRole('tab', { name: /Sample Stall/ })).toHaveAttribute('aria-selected', 'true');
  await expect(screen.getByText('Voice note', { exact: true })).toBeVisible();
  await agent.assert('the open conversation shows a reply with the buttons "That is right" and "Say it again"');
});

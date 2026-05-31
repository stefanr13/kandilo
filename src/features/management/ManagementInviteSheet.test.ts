import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ManagementInviteSheet from './ManagementInviteSheet';

function renderInviteSheet(allowAdminInvites: boolean): string {
  return renderToStaticMarkup(createElement(ManagementInviteSheet, {
    isOpen: true,
    saving: false,
    allowAdminInvites,
    error: '',
    notice: '',
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    language: 'English',
  }));
}

describe('ManagementInviteSheet', () => {
  it('guides priests to use Treasurer for parish financial receipt access', () => {
    const html = renderInviteSheet(true);

    expect(html).toContain('Use Treasurer for parish financial administrators who need receipt access.');
    expect(html).toContain('Admin cannot manage tax receipts.');
  });

  it('hides receipt role guidance when the sender cannot assign elevated roles', () => {
    const html = renderInviteSheet(false);

    expect(html).not.toContain('Use Treasurer for parish financial administrators who need receipt access.');
  });
});

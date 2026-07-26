import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import App from '@/App';

describe('App 404 routing', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/missing-route');
  });

  it('renders the not found page for unmatched public routes', async () => {
    render(<App />);

    expect(await screen.findByText('404 - Page not found', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('This route is off the map')).toBeInTheDocument();
  });
});


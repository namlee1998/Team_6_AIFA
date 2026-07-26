import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@/i18n';
import { NotFoundPage } from '../index';

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderNotFound(initialEntries = ['/missing']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <NotFoundPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('NotFoundPage', () => {
  it('renders the 404 content', () => {
    renderNotFound();

    expect(screen.getByText('404 - Page not found')).toBeInTheDocument();
    expect(screen.getByText('This route is off the map')).toBeInTheDocument();
  });

  it('sends users to the dashboard from the primary action', () => {
    renderNotFound();

    fireEvent.click(screen.getByRole('button', { name: /go to app/i }));

    expect(screen.getByTestId('location')).toHaveTextContent('/sdlc');
  });
});

import { ArrowLeft, Compass, LayoutDashboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface NotFoundPageProps {
  mode?: 'screen' | 'panel';
}

export function NotFoundPage({ mode = 'screen' }: NotFoundPageProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const primaryPath = '/sdlc';
  const PrimaryIcon = LayoutDashboard;

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-background px-6 py-10 text-on-surface',
        mode === 'screen' ? 'min-h-screen' : 'h-full min-h-[420px]',
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(14,165,233,0.14),transparent_34%),radial-gradient(circle_at_70%_70%,rgba(34,197,94,0.10),transparent_32%)]" />

      <section className="relative z-10 flex w-full max-w-2xl flex-col items-center text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-outline-variant/30 bg-surface-container-low text-primary shadow-xl shadow-primary/10">
          <Compass className="h-8 w-8" aria-hidden="true" />
        </div>

        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">
          {t('notFound.eyebrow')}
        </p>
        <h1 className="font-headline text-4xl font-extrabold leading-tight text-on-surface sm:text-5xl">
          {t('notFound.title')}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-on-surface-variant sm:text-base">
          {t('notFound.description')}
        </p>

        <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={() => navigate(primaryPath)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-lg shadow-primary/20 transition-transform hover:scale-[1.02] active:scale-[0.98] sm:w-auto"
          >
            <PrimaryIcon className="h-4 w-4" aria-hidden="true" />
            {t('notFound.goToApp')}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-low px-5 py-3 text-sm font-bold text-on-surface transition-colors hover:bg-surface-container sm:w-auto"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('notFound.goBack')}
          </button>
        </div>
      </section>
    </div>
  );
}

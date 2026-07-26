import React, { Component, ErrorInfo, ReactNode } from 'react';
import i18n from 'i18next';
import { AlertOctagon, RotateCcw, Home, Terminal } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/sdlc';
  };

  public render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV;

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background text-on-surface selection:bg-rose-500/30">
          {/* Decorative background grid and glowing circles */}
          <div
            className="absolute inset-0 bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-40"
            style={{
              backgroundImage:
                'linear-gradient(to right, var(--color-outline-variant) 1px, transparent 1px), linear-gradient(to bottom, var(--color-outline-variant) 1px, transparent 1px)',
            }}
          />
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-rose-500/10 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute bottom-1/4 left-1/4 w-[300px] h-[300px] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />

          {/* Error card */}
          <div className="relative w-full max-w-2xl backdrop-blur-xl bg-surface-container-lowest/60 border border-outline-variant rounded-2xl shadow-2xl overflow-hidden p-8 md:p-10 flex flex-col items-center text-center">
            {/* Header Icon */}
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center mb-6 text-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.1)]">
              <AlertOctagon className="w-8 h-8 animate-pulse" />
            </div>

            {/* Error Message */}
            <h1 className="text-2xl md:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-rose-400 via-orange-400 to-amber-300 mb-4 font-headline">
              {i18n.t('errorBoundary.title')}
            </h1>
            <p className="text-on-surface-variant max-w-md text-sm md:text-base mb-8">
              {i18n.t('errorBoundary.description')}
            </p>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-4 w-full justify-center mb-8">
              <button
                onClick={this.handleReload}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 font-bold transition-all shadow-lg shadow-rose-950/30 hover:scale-[1.02] active:scale-[0.98]"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{i18n.t('errorBoundary.reload')}</span>
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-surface border border-outline-variant hover:bg-surface-container font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Home className="w-4 h-4 text-on-surface-variant" />
                <span>{i18n.t('errorBoundary.goDashboard')}</span>
              </button>
            </div>

            {/* Tech details (Dev-only / Collapsible) */}
            {this.state.error && (
              <div className="w-full text-left bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
                <details className="group">
                  <summary className="flex items-center justify-between px-4 py-3 bg-surface-container/50 cursor-pointer select-none text-on-surface-variant hover:text-on-surface transition-colors text-xs font-semibold">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5 text-blue-400" />
                      <span>{i18n.t('errorBoundary.technicalLog')}</span>
                    </div>
                    <span className="text-[10px] bg-surface-container-high px-2 py-0.5 rounded text-on-surface-variant group-open:hidden">
                      {i18n.t('errorBoundary.show')}
                    </span>
                    <span className="text-[10px] bg-surface-container-high px-2 py-0.5 rounded text-on-surface-variant hidden group-open:inline">
                      {i18n.t('errorBoundary.hide')}
                    </span>
                  </summary>
                  <div className="p-4 text-xs font-mono text-error border-t border-outline-variant/60 overflow-x-auto max-h-60 leading-relaxed bg-surface-container-lowest/40">
                    <p className="font-bold text-error mb-2">
                      {this.state.error.toString()}
                    </p>
                    {isDev && this.state.errorInfo?.componentStack && (
                      <pre className="text-on-surface-variant/60 whitespace-pre text-[10px] mt-2">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    )}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

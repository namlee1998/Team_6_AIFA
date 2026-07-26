import React from 'react';
import { useTheme } from '@/theme';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

export function AppTopBar() {
  const { resolvedMode, toggleMode } = useTheme();

  return (
    <header className="h-10 shrink-0 z-40 border-b border-outline-variant bg-surface-container-lowest/80 backdrop-blur-md flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <span className="font-headline font-bold text-sm text-on-surface tracking-tight">AIFA</span>
      </div>



      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <button
          onClick={toggleMode}
          title="Toggle theme"
          className="w-7 h-7 rounded border border-outline-variant bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors"
        >
          <span className="material-symbols-outlined text-sm">
            {resolvedMode === 'dark' ? 'dark_mode' : 'light_mode'}
          </span>
        </button>
      </div>
    </header>
  );
}

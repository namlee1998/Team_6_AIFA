import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function FeatureRequestProjectDialog({
  projects,
  onCancel,
  onSelect,
}: {
  projects: Array<{ id: string; name: string; role?: string }>;
  onCancel: () => void;
  onSelect: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
            <span>🚀</span>
            <span>{t('layout.newFeatureRequest', 'New Feature Request')}</span>
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-on-surface-variant hover:text-on-surface transition-colors p-1 rounded-lg hover:bg-surface-variant/40"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <p className="text-xs text-on-surface-variant mb-4">
          {t('layout.chooseProjectFirst', 'Please choose a project to request a feature for:')}
        </p>

        {/* Search Input */}
        <div className="relative mb-4 shrink-0">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-base">
            search
          </span>
          <input
            type="text"
            placeholder={t('layout.searchPlaceholder', 'Search...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-surface-container border border-outline-variant/40 rounded-xl text-xs focus:outline-none focus:border-primary/50 text-on-surface"
          />
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1 min-h-[150px]">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-on-surface-variant/60 font-medium">
              {t('layout.noProjects', 'No projects found')}
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-outline-variant/30 bg-surface-container-low hover:bg-surface-variant hover:border-primary/30 transition-all text-left group"
              >
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                    {p.name}
                  </span>
                </div>
                {p.role && (
                  <span className="shrink-0 rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-wider bg-surface-container-highest text-on-surface-variant border-outline-variant/30">
                    {p.role}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="mt-5 pt-3 border-t border-outline-variant/20 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-surface-container-high border border-outline-variant text-on-surface hover:bg-surface-variant transition-colors"
          >
            {t('layout.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

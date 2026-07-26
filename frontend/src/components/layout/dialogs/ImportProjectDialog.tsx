import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

// AIFA v2.1 §4: a project is created with a Repository URL only. Local folder
// upload has been removed from the workflow entry path — the workflow always
// starts by cloning the Git URL through POST /run-architecture-agent.
export function ImportProjectDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string, url: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [projectName, setProjectName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateRepoUrl = (urlStr: string): string => {
    const v = urlStr.trim();
    if (!v) return 'Repository URL is required';
    const isHttp = /^https?:\/\/.+\/.+/i.test(v);
    const isGit = /^git:\/\/.+\/.+/i.test(v);
    const isSsh = /^ssh:\/\/.+\/.+/i.test(v);
    const isScp = /^[A-Za-z0-9_.-]+@[^:]+:[^/].*\/[^/]+\.git$/.test(v);
    if (!isHttp && !isGit && !isSsh && !isScp) {
      return 'Please enter a valid Git URL (https://, git://, ssh://, or git@host:owner/repo.git)';
    }
    return '';
  };

  const handleSubmit = async () => {
    const name = projectName.trim();
    if (!name) {
      setError('Project name is required');
      return;
    }
    const urlErr = validateRepoUrl(repoUrl);
    if (urlErr) {
      setError(urlErr);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name, repoUrl.trim());
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        t('layout.createProjectFailed');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded border border-outline-variant bg-surface-container-lowest shadow-2xl p-5">
        <h4 className="text-sm font-semibold text-on-surface mb-3">{t('layout.createProjectTitle')}</h4>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] text-on-surface-variant mb-1 font-label-mono uppercase tracking-wider">
              Project Name
            </label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancel();
                if (e.key === 'Enter') void handleSubmit();
              }}
              className="w-full rounded border border-outline-variant px-3 py-2 text-xs bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/40 focus:border-secondary outline-none transition-colors"
              placeholder="Enter project name..."
            />
          </div>
          <div>
            <label className="block text-[11px] text-on-surface-variant mb-1 font-label-mono uppercase tracking-wider">
              Repository URL
            </label>
            <input
              autoFocus
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancel();
                if (e.key === 'Enter') void handleSubmit();
              }}
              className="w-full rounded border border-outline-variant px-3 py-2 text-xs bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/40 focus:border-secondary outline-none transition-colors"
              placeholder="https://github.com/owner/repo.git"
            />
            <p className="text-[9px] text-on-surface-variant/60 mt-1.5 leading-normal">
              The workflow starts from this Git Repository URL.
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-1.5 rounded text-xs font-semibold bg-surface-container-high border border-outline-variant text-on-surface hover:bg-surface-variant disabled:opacity-50 transition-colors"
          >
            {t('layout.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !projectName.trim() || !repoUrl.trim()}
            className="flex-1 rounded bg-primary px-4 py-2 text-xs font-semibold text-on-primary hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-[0_0_10px_rgba(99,102,241,0.2)]"
          >
            {submitting ? t('layout.creating') : t('layout.createProjectBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

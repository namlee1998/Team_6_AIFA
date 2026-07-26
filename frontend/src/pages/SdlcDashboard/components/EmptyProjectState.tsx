import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, CheckCircle2, PlusCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';

export default function EmptyProjectState() {
  const { t } = useTranslation();
  const setCreateProjectDialogOpen = useAppStore((s) => s.setCreateProjectDialogOpen);

  return (
    <div className="sdlc-empty-state">
      <motion.div 
        className="sdlc-empty-content"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="sdlc-empty-icon-wrap">
          <Bot size={48} className="sdlc-empty-icon" />
        </div>
        <h2>{t('emptyProject.welcome')}</h2>
        <p>
          {t('emptyProject.desc')}
        </p>
        <div className="mt-5 grid gap-2 text-left">
          {[
            t('emptyProject.step1'),
            t('emptyProject.step2'),
            t('emptyProject.step3'),
            t('emptyProject.step4'),
          ].map((step) => (
            <div key={step} className="flex items-center gap-2 text-sm text-on-surface-variant">
              <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
              <span>{step}</span>
            </div>
          ))}
        </div>
        <button 
          className="sdlc-empty-hint mt-5 hover:bg-emerald-500/20 transition-colors cursor-pointer"
          onClick={() => setCreateProjectDialogOpen(true)}
        >
          <PlusCircle size={16} /> <span>{t('emptyProject.btnCreate')}</span>
        </button>
      </motion.div>
    </div>
  );
}

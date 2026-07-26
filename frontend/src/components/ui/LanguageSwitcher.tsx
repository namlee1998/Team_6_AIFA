import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown, Check } from 'lucide-react';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLang = i18n.language?.startsWith('en') ? 'en' : 'vi';

  const languages = [
    { code: 'en', label: 'English', short: 'EN' },
    { code: 'vi', label: 'Tiếng Việt', short: 'VI' },
  ];

  const handleLanguageChange = (code: string) => {
    void i18n.changeLanguage(code);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeLang = languages.find((l) => l.code === currentLang) || languages[0];

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors text-xs font-semibold"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <Globe className="w-3.5 h-3.5" />
        <span>{activeLang.short}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-32 rounded border border-outline-variant bg-surface-container-lowest shadow-xl z-50 py-1 backdrop-blur-md bg-opacity-95">
          {languages.map((lang) => {
            const isSelected = lang.code === currentLang;
            return (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-surface-variant ${
                  isSelected ? 'text-primary font-bold bg-primary/5' : 'text-on-surface-variant'
                }`}
              >
                <span>{lang.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

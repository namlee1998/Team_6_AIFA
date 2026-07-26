import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi, expect } from 'vitest';
import enTranslations from '../src/locales/en/translation.json';
import viTranslations from '../src/locales/vi/translation.json';

const getLanguage = () => {
  try {
    const testPath = expect.getState().testPath;
    if (testPath && testPath.includes('ProfilePage')) {
      return 'vi';
    }
  } catch {
    // ignore
  }
  return (globalThis as any).__activeLanguage || 'en';
};

const translate = (key: string) => {
  const parts = key.split('.');
  const activeLang = getLanguage() === 'vi' ? viTranslations : enTranslations;
  let result: any = activeLang;
  for (const part of parts) {
    if (result && typeof result === 'object' && part in result) {
      result = result[part];
    } else {
      return key;
    }
  }
  return typeof result === 'string' ? result : key;
};

const mockI18n = {
  use: () => mockI18n,
  init: () => Promise.resolve(),
  t: translate,
  changeLanguage: (lng: string) => {
    (globalThis as any).__activeLanguage = lng;
    return Promise.resolve();
  },
  get language() {
    return getLanguage();
  },
};

vi.mock('i18next', () => ({
  default: mockI18n,
  t: translate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
    i18n: {
      changeLanguage: (lng: string) => {
        (globalThis as any).__activeLanguage = lng;
        return Promise.resolve();
      },
      get language() {
        return getLanguage();
      },
    },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
}));

const createStorage = () => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
};

const storage =
  typeof window !== 'undefined' &&
  window.localStorage &&
  typeof window.localStorage.getItem === 'function' &&
  typeof window.localStorage.clear === 'function'
    ? window.localStorage
    : createStorage();

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

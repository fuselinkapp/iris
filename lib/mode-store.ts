'use client';

import { useSyncExternalStore } from 'react';

export type Mode = 'focus' | 'triage' | 'grandma';

const STORAGE_KEY = 'iris.mode';
const DEFAULT_MODE: Mode = 'focus';

const isMode = (value: unknown): value is Mode =>
  value === 'focus' || value === 'triage' || value === 'grandma';

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getMode(): Mode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isMode(stored) ? stored : DEFAULT_MODE;
}

export function setMode(next: Mode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, next);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useMode(): Mode {
  return useSyncExternalStore(subscribe, getMode, () => DEFAULT_MODE);
}

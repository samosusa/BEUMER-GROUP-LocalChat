import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemePreference = 'dark' | 'light' | 'system';

/**
 * Client-only state: things the local service has no opinion about.
 *
 * Server state lives in React Query and is never duplicated here. The split is the rule
 * that keeps the app from growing two sources of truth for the same document list.
 */
interface UiState {
  theme: ThemePreference;
  sidebarCollapsed: boolean;

  setTheme(theme: ThemePreference): void;
  toggleSidebar(): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: 'localchat.ui',
      // Transient state must not survive a restart; only real preferences persist.
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);

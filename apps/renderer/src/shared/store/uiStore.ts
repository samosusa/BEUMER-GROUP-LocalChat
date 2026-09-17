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
  // Independent of sidebarCollapsed: the settings screen has its own left-hand section nav
  // (Model & hardware / Benchmarks), collapsible the same way and for the same reason - more
  // room for the charts and tables beside it - but toggled and remembered separately, since
  // collapsing one is not a statement about wanting the other collapsed too.
  settingsNavCollapsed: boolean;

  setTheme(theme: ThemePreference): void;
  toggleSidebar(): void;
  toggleSettingsNav(): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      settingsNavCollapsed: false,

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      toggleSettingsNav: () =>
        set((state) => ({ settingsNavCollapsed: !state.settingsNavCollapsed })),
    }),
    {
      name: 'localchat.ui',
      // Transient state must not survive a restart; only real preferences persist.
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        settingsNavCollapsed: state.settingsNavCollapsed,
      }),
    },
  ),
);

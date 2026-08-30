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
  /** The context widget's expanded panel. One at a time, app-wide. */
  contextPanelOpen: boolean;
  /** Undo buffer for a document removed from context, cleared on the next action. */
  lastRemovedAttachment: { chatId: string; documentId: string; title: string } | null;

  setTheme(theme: ThemePreference): void;
  toggleSidebar(): void;
  setContextPanelOpen(open: boolean): void;
  rememberRemoval(entry: NonNullable<UiState['lastRemovedAttachment']>): void;
  clearRemoval(): void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      contextPanelOpen: false,
      lastRemovedAttachment: null,

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setContextPanelOpen: (contextPanelOpen) => set({ contextPanelOpen }),
      rememberRemoval: (lastRemovedAttachment) => set({ lastRemovedAttachment }),
      clearRemoval: () => set({ lastRemovedAttachment: null }),
    }),
    {
      name: 'localchat.ui',
      // Transient state must not survive a restart; only real preferences persist.
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);

import { createHashRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { ChatPage } from '@/features/chat/ChatPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { GeneralDocumentsPage } from '@/features/projects/GeneralDocumentsPage';
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage';
import { HistoryPage } from '@/features/history/HistoryPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { QuickAskPage } from '@/features/quick-ask/QuickAskPage';
import { ErrorScreen } from './ErrorScreen';

/**
 * Hash routing, because the packaged app is served from a custom protocol with no server to
 * rewrite deep links. It costs nothing here and removes a whole class of blank-window bugs.
 */
export const router = createHashRouter([
  // The quick-ask strip is its own window, so it sits outside the app shell: no sidebar,
  // no top bar, nothing but the input.
  { path: '/quick-ask', element: <QuickAskPage />, errorElement: <ErrorScreen /> },
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <ErrorScreen />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'chat/:chatId', element: <ChatPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
      { path: 'documents', element: <GeneralDocumentsPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/chat" replace /> },
    ],
  },
]);

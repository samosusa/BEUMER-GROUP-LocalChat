import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { retryPolicy } from '@/shared/api/queries';
import { useUiStore } from '@/shared/store/uiStore';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: retryPolicy,
        // The service is on loopback: a refetch costs nothing and staleness costs trust.
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
        gcTime: 10 * 60_000,
      },
      mutations: { retry: false },
    },
  });
}

/** Applies the theme preference to the document root, which is what the tokens key off. */
function ThemeSync() {
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  // Created once per app instance rather than per render, so the cache survives re-renders.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      {children}
    </QueryClientProvider>
  );
}

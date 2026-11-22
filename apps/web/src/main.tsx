import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './index.css';
import './i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import type React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AuthProvider } from './lib/auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

async function start() {
  // Browser-only demonstration build: fictional recorded responses replace the API.
  let Switcher: (() => React.JSX.Element) | null = null;
  if (import.meta.env.VITE_DEMO === '1') {
    const [{ installDemoApi }, { DemoSwitcher }] = await Promise.all([
      import('./demo/mock'),
      import('./demo/DemoSwitcher'),
    ]);
    installDemoApi();
    Switcher = DemoSwitcher;
  }
  const { router } = await import('./routes');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          {Switcher && <Switcher />}
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();

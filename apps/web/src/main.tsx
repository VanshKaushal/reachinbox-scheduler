import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import '@fontsource-variable/dm-sans';
import './styles.css';
import { ApiError } from './api';
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
      refetchOnWindowFocus: true,
    },
  },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ style: { fontFamily: 'inherit' } }}
      />
    </QueryClientProvider>
  </StrictMode>,
);

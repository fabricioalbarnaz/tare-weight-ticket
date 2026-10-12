import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './i18n/config';
import './index.css';

async function enableMocking() {
  const apiMode = import.meta.env.VITE_API_MODE ?? 'mock';
  if (apiMode !== 'mock') return;

  const { worker } = await import('./api/mocks/browser');
  return worker.start({ onUnhandledFrame: 'bypass' });
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

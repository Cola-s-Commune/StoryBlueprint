import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

function reportRendererError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  void window.electronAPI?.reportRendererError(scope, message);
}

window.addEventListener('error', (event) =>
  reportRendererError('uncaught-error', event.error ?? event.message),
);
window.addEventListener('unhandledrejection', (event) =>
  reportRendererError('unhandled-rejection', event.reason),
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

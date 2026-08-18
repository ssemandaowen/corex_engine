import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ToastProvider } from './context/ToastContext.tsx';
import { TerminalProvider } from './context/TerminalContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <TerminalProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </TerminalProvider>
    </ToastProvider>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeNativeApp } from './app/native';
import App from './App.tsx';
import './index.css';

void initializeNativeApp();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

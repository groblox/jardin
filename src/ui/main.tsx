import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GardenProvider } from './store.tsx';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GardenProvider>
      <App />
    </GardenProvider>
  </StrictMode>,
);

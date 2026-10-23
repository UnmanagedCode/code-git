import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Toasts } from './shell/Toasts';
import './index.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /><Toasts /></StrictMode>);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import './styles.css';
import './reference-theme.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

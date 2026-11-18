import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ColorModeProvider } from './colorMode';
import { AuthProvider } from './auth/AuthContext';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ColorModeProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ColorModeProvider>
  </StrictMode>,
);

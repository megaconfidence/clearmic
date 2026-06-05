import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Admin } from './pages/Admin';

const container = document.getElementById('root');
if (!container) {
	throw new Error('Root element not found');
}

// Minimal path-based routing. The SPA fallback serves index.html for any route,
// so we pick the root component from the pathname. /api/* never reaches here.
const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin';

createRoot(container).render(isAdmin ? <Admin /> : <App />);

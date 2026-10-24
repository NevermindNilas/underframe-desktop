// Renderer entry: mount the React app, then load data and the engine.
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.jsx';
import { boot, app } from './controller.js';
import { uf } from './platform.js';
import { runSmoke } from './smoke.js';
import { runScenes } from './scenes.js';
import './global.css';

document.documentElement.dataset.backdrop = uf.backdrop === 'mica' ? 'mica' : 'solid';
createRoot(document.getElementById('root')).render(<App />);

boot({
  onReady: uf.smoke ? ({ t0 }) => runSmoke(app, { t0 }) : uf.scenes ? () => runScenes(app) : undefined,
});

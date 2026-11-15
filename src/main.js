// Punto de entrada: carga los datos JSON (historia, tiendas, pueblo y recompensas) y arranca el juego.
import { Game } from './core/Game.js';

async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (${res.status})`);
  return res.json();
}

(async () => {
  const note = document.getElementById('loading-note');
  try {
    const [story, pike, hattie, town, bounties] = await Promise.all([
      loadJSON('./data/story/chapter1.json'), loadJSON('./data/shop.json'), loadJSON('./data/shop_general.json'),
      loadJSON('./data/town.json'), loadJSON('./data/bounties.json'),
    ]);
    window.__game = new Game({ story, shops: { pike, hattie }, town, bounties });
  } catch (err) {
    console.error(err);
    note.textContent = location.protocol === 'file:'
      ? 'Abre el juego desde un servidor (GitHub Pages o «python -m http.server»): los módulos no cargan con doble clic.'
      : 'Error al iniciar: ' + err.message;
  }
})();

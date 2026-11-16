// Punto de entrada: carga los datos JSON (historia, tiendas, pueblo y recompensas), la campaña (data/story/campaign.js) y arranca el juego.
import { Game } from './core/Game.js';
import { EXTRA_ITEMS } from './narrative/ExtraItems.js';

async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (${res.status})`);
  return res.json();
}

// Une el JSON de la Fase 4 con el reparto y los objetos de la campaña (los ids de la Fase 4 tienen prioridad).
function mergeStory(story, c) {
  const npcs = {};
  Object.entries(c.NPCS).forEach(([id, n]) => { npcs[id] = { name: n.name, role: n.role }; });
  story.npcs = { ...npcs, ...story.npcs };
  story.items = { ...c.ITEMS, ...EXTRA_ITEMS, ...story.items };
  return story;
}

(async () => {
  const note = document.getElementById('loading-note');
  try {
    const [story, pike, hattie, town, bounties, campaign] = await Promise.all([
      loadJSON('./data/story/chapter1.json'), loadJSON('./data/shop.json'), loadJSON('./data/shop_general.json'),
      loadJSON('./data/town.json'), loadJSON('./data/bounties.json'), import('../data/story/campaign.js'),
    ]);
    window.__game = new Game({ story: mergeStory(story, campaign), shops: { pike, hattie }, town, bounties, campaign });
  } catch (err) {
    console.error(err);
    note.textContent = location.protocol === 'file:'
      ? 'Abre el juego desde un servidor (GitHub Pages o «python -m http.server»): los módulos no cargan con doble clic.'
      : 'Error al iniciar: ' + err.message;
  }
})();

# The Last Horizon

Videojuego 3D de mundo abierto del Viejo Oeste en tercera persona, para navegador (Three.js + Web Audio API), optimizado para equipos modestos.

## Fase 1 — Prototipo jugable (vertical slice)

- Valle procedural low-poly con niebla exponencial, ciclo día/atardecer/noche y campamento con fogata.
- Vaquero en tercera persona: caminar, correr (resistencia), apuntar y disparar el rifle de palanca con raycast.
- 6 ciervos con máquina de estados (pastar → alerta → huir → muerto) y despellejado.
- Misión "Carne para el campamento" definida en JSON, con diálogo cinematográfico y elecciones.
- Audio 100 % procedural: viento, fuego, grillos, disparo con eco, pasos.
- Vegetación con `InstancedMesh` y resolución adaptativa para mantener 60 FPS.

## Cómo jugar

Abre `index.html` en Chrome o Edge (necesita conexión para cargar Three.js desde CDN), o sírvelo en local:

```bash
python -m http.server 8765
```

| Tecla | Acción |
|---|---|
| W A S D | Moverse |
| Shift | Correr |
| Ratón | Cámara |
| Clic derecho | Apuntar |
| Clic izquierdo | Disparar |
| R | Recargar |
| E | Interactuar / despellejar |
| Tab | Alforjas (inventario) |
| T | Acelerar el tiempo |
| Esc | Pausa |

## Arquitectura

Todo vive hoy en `index.html`, dividido en secciones con la ruta de su futuro módulo (`src/core/Game.js`, `src/ai/Deer.js`, `src/systems/MissionSystem.js`…). La estructura objetivo:

```
src/
  core/      Game, Config, EventBus, InputManager, MathUtils, SaveSystem
  render/    GeometryKit, ParticleSystem
  world/     WorldManager, TimeOfDay, Terrain, Vegetation, Camp
  entities/  PlayerController, CharacterFactory, CampNPC, Horse
  ai/        WildlifeAI, Deer, StateMachine
  systems/   MissionSystem, DialogueSystem, Inventory, AudioSynthesizer
  ui/        UIManager, Radar
data/
  story/chapter1.json, items.json, npcs.json
```

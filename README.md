# The Last Horizon

Videojuego 3D de mundo abierto del Viejo Oeste en tercera persona, para navegador (Three.js + Web Audio API), optimizado para equipos modestos.

**Jugar:** https://alejodv2904.github.io/The-Last-Horizon/

## Contenido

**Fase 1:** valle low-poly con niebla, ciclo día/noche, campamento con fogata, vaquero con rifle de palanca, ciervos con IA (pastar → alerta → huir → muerto), despellejado, misión en JSON con diálogo cinematográfico y audio procedural.

**Fase 2:**
- **Mundo por chunks:** 2 × 2 km divididos en sectores de 200 m. Solo existen 9 a la vez (el del jugador + 8 vecinos); los lejanos se reciclan. Dos biomas: pradera dorada y pinar denso, más un camino al puesto de comercio.
- **Caballo (Ceniza):** paso, trote, medio galope y galope procedurales; `H` para silbarle, `F` para montar o desmontar, `Shift` galopa y gasta su resistencia.
- **Lobos:** manadas de 2–3 que patrullan, gruñen, acechan y atacan; un disparo cercano o una baja en la manada puede ahuyentarlos.
- **Instinto de cazador (`V`):** filtro desaturado y azulado, huellas brillantes y animales resaltados.
- **Puesto de comercio de Jonás Pike:** vender pieles y comprar munición, *cañón largo* (alcance) y *cartuchos expansivos* (daño).
- **Guardado automático** en `localStorage` cada 30 s y en cada evento importante.

## Cómo ejecutarlo en local

Usa módulos ES, así que necesita un servidor (con doble clic no carga):

```bash
python -m http.server 8765
```

y abre `http://localhost:8765`.

## Controles

| Tecla | Acción |
|---|---|
| W A S D | Moverse (a caballo: dirección relativa a la cámara) |
| Shift | Correr / galopar |
| Ctrl | Paso lento a caballo |
| Ratón | Cámara |
| Clic derecho / izquierdo | Apuntar / disparar |
| R | Recargar |
| E | Hablar, despellejar, comerciar |
| F | Montar / desmontar |
| H | Silbar al caballo |
| V | Instinto de cazador |
| Tab | Alforjas |
| T | Acelerar el tiempo |
| Esc | Pausa |

## Arquitectura

```
index.html                 HUD, pantallas, importmap de Three.js
data/
  story/chapter1.json      misiones, diálogos, objetos, NPC
  shop.json                catálogo de la tienda
src/
  main.js                  carga los JSON y arranca Game
  core/      Game, Config, EventBus, InputManager, MathUtils
  render/    GeometryKit (geometría low-poly + materiales), ParticleSystem
  world/     WorldManager, WorldGen (altura/biomas/camino), ChunkManager, Structures, TimeOfDay
  entities/  PlayerController, Horse, NPC, CharacterFactory
  ai/        Animal (base), Deer, Wolf, WildlifeAI
  systems/   MissionSystem, DialogueSystem, Inventory, ShopSystem, SaveSystem, HunterInstinct, AudioSynthesizer
  ui/        UIManager
```

Los sistemas se comunican por `EventBus` (`gunshot`, `animal:killed`, `inventory:changed`, `flag:set`), así que añadir pueblos, nuevas especies o capítulos no obliga a tocar los sistemas existentes.

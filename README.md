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

**Fase 3: Redwood Gulch, honor, bandidos y recompensas:**
- **Pueblo fronterizo (Redwood Gulch)**, al sureste del campamento: saloon de dos plantas con balcón, oficina del sheriff con celda visible desde la calle, tienda general, establo, casas, clínica, telégrafo, pozo y torre de agua. Todo Low-Poly fusionado en 1 malla; ventanas y farolas se encienden de noche; un piano de saloon procedural suena al acercarte.
- **Ciudadanos** que pasean por la calle, charlan y te saludan según tu honor; si sacas el arma o se oye un disparo, levantan las manos, se agachan o corren a refugiarse en un edificio.
- **Honor** (barra roja → blanca con el sombrero en el centro): saludar, rescatar viajeros, entregar bandidos o ayudar sube el honor y da descuentos (hasta −12 %); robar, saquear cadáveres o disparar a inocentes lo baja (recargo de hasta +20 %).
- **Se busca**: un delito presenciado pone precio a tu cabeza (★ 1-3). El sheriff y sus ayudantes intentan arrestarte (multa y noche en el calabozo) o abren fuego si atacas a la ley. Se paga en el tablón, o se diluye si nadie te ve durante un rato.
- **Bandidos con IA táctica**: 3 campamentos fijos (uno en el Cañón Norte, con el cabecilla) y emboscadas / asaltos a viajeros en los caminos. Detectan, buscan cobertura tras rocas y cajas, se asoman para disparar con balas trazadoras visibles y puntería justa, huyen heridos o se rinden, y sueltan botín (dinero, munición, tónicos).
- **Salud con regeneración lenta** y **tónicos** consumibles desde las Alforjas (`Tab` + `1-9`) o con `Q`; el HUD indica la dirección de cada disparo recibido.
- **Tablón de recompensas** junto a la oficina del sheriff: contratos de cazarrecompensas (cabecilla vivo o muerto, limpiar campamentos) y **2 misiones secundarias narrativas** (*El fugitivo del establo* y *La deuda de Clara*) con diálogos en JSON cuyas decisiones cambian el Honor.

**Fase 5: campaña, Dead Eye, banda sonora dinámica y optimización:**
- **Campaña completa data-driven** (`data/story/campaign.js`): 6 capítulos + 2 epílogos × 6 misiones = 48 misiones con objetivos encadenados, diálogos, Honor, recompensas y **4 finales** (Honor alto/bajo × proteger a los inocentes / volver por el oro). El motor (`src/narrative/`) interpreta los objetivos sin código por misión: *viajar, cabalgar, escoltar, hablar, reunir, cazar una especie concreta, sigilo, eliminar oleadas, duelo 1v1, sobrevivir, interactuar, fabricar, competir a tiro y decisiones morales ramificadas*.
- **Cinemáticas automáticas:** pantalla negra con el título del capítulo en tipografía Western (*CAPÍTULO III — SANGRE EN EL RÍO*) al empezar y terminar cada acto; el **campamento se muda** (Cedar Hollow → Sauces Negros → ruinas → Mesa Quebrada → Cedar en ruinas → Rancho La Rueda); en los **Epílogos** el protagonista pasa a ser Wren (nuevo modelo); **créditos finales** y, después, **mundo abierto infinito** (terreno sin fronteras).
- **Dead Eye:** núcleo junto a salud y resistencia, se recarga cazando, con tiros a la cabeza y con tónicos. Apuntando, `Q` ralentiza el tiempo a 0.25x con filtro sepia; clic izq. marca blancos con cruces rojas; soltar clic der. (o `Q`) ejecuta la ráfaga letal.
- **Duelo del Oeste** para los jefes de capítulo: cinemática, medidor de desenfunde (mantén el clic izquierdo, zona dorada), campana, desenfunde con clic derecho; falso desenfunde, clemencia opcional y reintentos sin muerte.
- **Música Western procedural** (guitarra, armónica/silbido, pad y percusión sintetizados): cambia sola entre *exploración, sigilo, tiroteo, duelo y escenas emotivas*. Deslizadores independientes de **Música / Efectos / Ambiente** en la pausa.
- **Calidad gráfica Baja / Media / Alta:** resolución, distancia de chunks y niebla, densidad de vegetación (`InstancedMesh`), sombras, partículas, radio de la IA y capas de música.
- **Object pooling** (`ObjectPool`) para balas, estelas, agujeros de bala, huellas, partículas e impactos: cero asignaciones por disparo en partidas largas.
- **3 ranuras de guardado** (capítulo, misión, dinero, honor y % de avance) con **exportar/importar `.json`**; las partidas de la Fase 4 se migran a la ranura 1.

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
| E | Hablar, despellejar, comerciar, saludar, tablón, atar prisioneros |
| Q | Beber el mejor tónico · **apuntando: Dead Eye** |
| C / Ctrl (a pie) | Agacharse (sigilo) |
| B | Viaje rápido al campamento (desbloqueable) |
| Dead Eye | clic izq. marca · soltar clic der. o `Q` dispara |
| Duelo | mantén clic izq. (medidor) · clic der. o Espacio desenfunda · `X` perdona |
| 1-9 (con las Alforjas abiertas) | Usar el objeto consumible indicado |
| F | Montar / desmontar |
| H | Silbar al caballo |
| V | Instinto de cazador |
| Tab | Alforjas |
| T | Acelerar el tiempo |
| Esc | Pausa: volúmenes, calidad gráfica y ranuras de guardado |

## Arquitectura

```
index.html                 HUD, pantallas, importmap de Three.js
data/
  story/chapter1.json      misiones secundarias, diálogos cinematográficos, objetos, PNJ
  story/campaign.js        la campaña: 48 misiones, reparto, objetos, lugares y los 4 finales
  shop.json                catálogo de Jonás Pike
  shop_general.json        catálogo de la tienda de Hattie Bell (tónicos, munición)
  town.json                honor (umbrales, descuentos), delitos, frases, ciudadanos y sus rutas
  bounties.json            contratos del tablón de recompensas
src/
  main.js                  carga los JSON y arranca Game
  core/      Game, Config, Settings (calidad, volúmenes), ObjectPool, EventBus, InputManager, MathUtils
  render/    GeometryKit (geometría low-poly + materiales), ParticleSystem, EffectsPool (estelas, decals, huellas, impactos)
  world/     WorldManager (colisiones, segmentos 3D), WorldGen (altura, biomas, caminos, cañón), ChunkManager,
             Structures (campamentos reubicables), Landmarks, TownBuilder (pueblo), BanditCamps, TimeOfDay
  entities/  PlayerController, Horse, NPC, Citizen, CharacterFactory
  ai/        Animal, Deer, Wolf, SpeciesVariants (alce, oso, puma…), WildlifeAI · Gunman (FSM táctica), BanditSystem, AmbushDirector, Projectiles
  systems/   MissionSystem, DialogueSystem, Inventory, ShopSystem, SaveSystem, HunterInstinct, AudioSynthesizer,
             HonorSystem, LawSystem, TownLife, BountySystem, Loot, DeadEye, DuelSystem, MusicEngine
  narrative/ CampaignManager (estado, recompensas, cinemáticas, créditos), ObjectiveHandlers (un intérprete por tipo de objetivo),
             StoryDirector (PNJ, enemigos, acompañantes, campamento), LocationMap (lugares → coordenadas), ExtraItems
  ui/        UIManager, MenuManager (ranuras, ajustes)
```

Los sistemas se comunican por `EventBus` (`gunshot`, `animal:killed`, `bandit:killed`, `inventory:changed`, `flag:set`, `honor:changed`), así que añadir pueblos, bandas o capítulos no obliga a tocar los sistemas existentes.

### Rendimiento (objetivo: 60 FPS en equipos modestos)

- **Colisiones**: los edificios son cajas AABB (no se colisiona contra la malla). El pueblo y cada campamento viven en una *zona* con círculo envolvente: fuera de él, el coste es una sola comparación. Los disparos y la línea de visión usan intersecciones analíticas segmento-círculo/caja (con altura: se dispara por encima de una caja baja) más un muestreo del terreno cada 3 m; sin `Raycaster` por frame.
- **IA de cobertura**: decisiones a 4-5 Hz y escalonadas; el punto de cobertura se calcula como *centro del obstáculo + dirección(jugador→obstáculo)*, y basta una comprobación geométrica para saber si sigue protegiendo. Solo se hace UNA comprobación de visión al asomarse. «Fichas de disparo» (máx. 2 tiradores) y LOD de IA (los pistoleros a más de 240 m duermen).
- **Dibujado**: pueblo en 1 malla + ventanas + farolas + 1 atlas de carteles; 1 `InstancedMesh` para las balas, otro para el botín y otro para las cajas de emboscada; ciudadanos con humanoide «lite» (6 mallas) y solo el torso proyecta sombra. En las pruebas el pueblo añade ~18 *draw calls* y la simulación cuesta ~0,3 ms por frame.

### Cómo lee el motor los objetivos de `campaign.js`

Un objetivo es solo **datos** (`{ type, text, location, count, species… }`). `ObjectiveHandlers.js` reduce los 15 tipos a **10 comportamientos** (`ReachHandler`, `TalkHandler`, `CollectHandler`, `HuntHandler`, `StealthHandler`, `CombatHandler`, `SurviveHandler`, `DuelHandler`, `ChoiceHandler`, `InteractHandler`, `ShootHandler`) que comparten un mismo contrato (`start · update · destroy · done · waypoint · interaction`). El `CampaignManager` solo conoce ese contrato: ejecuta los objetivos en orden, corre los opcionales en paralelo, reparte recompensas y Honor, y cambia de capítulo. Los lugares (`location: "salto_weir"`) se traducen a coordenadas en `LocationMap.js`. Añadir un tipo nuevo = escribir una clase y registrarla en `HANDLERS` / `TYPE_MAP`.

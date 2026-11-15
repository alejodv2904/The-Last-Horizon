// Parámetros globales del juego. Todo lo "ajustable" vive aquí.
const CONFIG = {
  // --- Mundo por chunks ---
  CHUNK_SIZE: 200,            // metros por lado de cada sector
  CHUNK_RES: 40,              // celdas por lado (5 m por celda, low-poly)
  WORLD_HALF: 1000,           // el mundo va de -1000 a +1000 (10x10 chunks = 2 km x 2 km)
  WORLD_LIMIT: 935,           // límite jugable (las montañas del borde empiezan antes)
  CHUNK_HYSTERESIS: 14,       // metros fuera del chunk central antes de recentrar (evita "parpadeo")
  CHUNK_BUILDS_PER_FRAME: 1,  // construcción diferida: 1 chunk por frame como máximo
  VEG_MAX_PER_CHUNK: { pine: 240, oak: 36, rock: 40, sage: 110, grass: 360 },

  // --- Puntos fijos ---
  CAMP: { x: 0, z: 0 },
  TRADING_POST: { x: -430, z: 390 },
  ROAD: [[0, -8], [-60, 70], [-200, 170], [-330, 300], [-424, 382]],
  PLAYER_SPAWN: { x: 0, z: -13 },
  HORSE_SPAWN: { x: 6.5, z: -12 },

  // --- Tiempo y render ---
  DAY_LENGTH_SECONDS: 600,
  START_HOUR: 16.6,
  SHADOW_MAP_SIZE: 1024,
  SHADOW_EXTENT: 50,
  MAX_PIXEL_RATIO: 1.25,
  MIN_PIXEL_RATIO: 0.6,

  // --- Jugador ---
  WALK_SPEED: 3.3,
  RUN_SPEED: 7.0,
  AIM_SPEED: 1.9,
  MOUSE_SENS: 0.0022,
  PLAYER_MAX_HEALTH: 100,
  RIFLE_MAG: 8,
  RIFLE_COOLDOWN: 0.85,
  RELOAD_TIME: 1.7,
  START_AMMO: 24,
  RIFLE_BASE_DAMAGE: 70,
  RIFLE_BASE_RANGE: 350,

  // --- Caballo ---
  HORSE: {
    WALK: 2.2, TROT: 5.5, CANTER: 9.0, GALLOP: 14.0,
    STAMINA_DRAIN: 13, STAMINA_REGEN: 9, EXHAUSTED_UNTIL: 35,
    CALL_TELEPORT_DIST: 260, MOUNT_DIST: 3.0,
  },

  // --- Fauna ---
  HERDS: [
    { id: 'arroyo_ne', label: 'Arroyo del noreste', x: 64, z: 60, count: 3 },
    { id: 'praderas_o', label: 'Praderas del oeste', x: -72, z: 66, count: 3 },
    { id: 'llano_este', label: 'Llano del este', x: 280, z: -170, count: 3 },
    { id: 'valle_sur', label: 'Valle del sur', x: -260, z: -300, count: 3 },
    { id: 'colinas_norte', label: 'Colinas del norte', x: 120, z: 520, count: 3 },
  ],
  WOLF_PACKS: [
    { id: 'manada_pinar', x: 330, z: 250, count: 3 },
    { id: 'manada_sur', x: -140, z: -420, count: 2 },
    { id: 'manada_oeste', x: -560, z: 150, count: 3 },
  ],
  DEER_RESPAWN_SECONDS: 90,
  WOLF_RESPAWN_SECONDS: 180,
  AI_ACTIVE_RADIUS: 320,      // fuera de este radio la IA "duerme" (LOD de IA)

  // --- Sistemas ---
  INSTINCT_DURATION: 12,
  INSTINCT_COOLDOWN: 5,
  SAVE_KEY: 'thelasthorizon.save.v1',
  AUTOSAVE_SECONDS: 30,
};

export { CONFIG };

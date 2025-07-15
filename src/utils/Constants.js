// src/utils/Constants.js
// Game constants and configuration

export const GAME_CONFIG = {
    // Map dimensions
    TILE_SIZE: 32,
    MAP_WIDTH: 15,
    MAP_HEIGHT: 13,

    
    
    // Performance
    TARGET_FPS: 60,
    FRAME_TIME: 1000 / 60,
    MAX_FRAME_SKIP: 5,
    
    // Gameplay
    MAX_PLAYERS: 4,
    MIN_PLAYERS: 2,
    LIVES_PER_PLAYER: 3,
    BOMB_TIMER: 3000,
    EXPLOSION_DURATION: 500,
    INVULNERABILITY_TIME: 2000,
    COUNTDOWN_TIME: 10,
    TICK_RATE: 60,
    MAX_GAMES: 100,
    WAITING_TIME: 20000,    // 20 seconds waiting period
    COUNTDOWN_DURATION: 10000, // 10 seconds countdown
    CONNECTION_TIMEOUT: 60000, // 1 minute timeout






    
    // Network
    RECONNECT_ATTEMPTS: 5,
    RECONNECT_DELAY: 2000,
    PING_INTERVAL: 10000,
    TIMEOUT_DURATION: 30000,
    
    BASE_MOVE_SPEED: 5,
    // Input
    INPUT_BUFFER_SIZE: 10,
    INPUT_RATE_LIMIT: 16, // ~60fps
    
    // Rendering
    RENDER_LAYERS: {
        BACKGROUND: 0,
        BLOCKS: 1,
        WALLS: 2,
        POWERUPS: 3,
        BOMBS: 4,
        PLAYERS: 5,
        EXPLOSIONS: 6,
        UI: 10
    }
};

export const PLAYER_CONFIG = {
    DEFAULT_SPEED: 5,
    MAX_SPEED: 7,
    DEFAULT_BOMB_COUNT: 1,
    MAX_BOMB_COUNT: 8,
    DEFAULT_BOMB_RANGE: 1,
    MAX_BOMB_RANGE: 8,

    PLAYER_SIZE: 25,
    
    COLORS: ['#4A90E2', '#E94B3C', '#7ED321', '#F5A623'],
    
    STARTING_POSITIONS: [
        { x: 1, y: 1 },
        { x: 13, y: 1 },
        { x: 1, y: 11 },
        { x: 13, y: 11 }
    ]
};

export const POWER_UP_CONFIG = {
    SPAWN_CHANCE: 0.3,
    DESPAWN_TIME: 30000, // 30 seconds before power-up disappears from map
    
    // Power-up effect durations (in milliseconds)
    EFFECT_DURATIONS: {
        SPEED: 45000,     // 45 seconds
        BOMBS: 60000,     // 60 seconds
        FLAMES: 60000,    // 60 seconds
        ONE_UP: -1,       // -1 = permanent (never expires)
        BLOCK_PASS: 30000 // 30 seconds
    },
    
    // Maximum levels for each power-up type
    MAX_LEVELS: {
        SPEED: 3,
        BOMBS: 5,
        FLAMES: 5,
        LIVES: 4  // Maximum 4 lives total
    },
    
    TYPES: {
        BOMBS: { 
            icon: '💣', 
            color: '#E74C3C', 
            name: 'Extra Bomb',
            description: 'Increases the amount of bombs dropped at a time by 1',
            stackable: true,
            maxStack: 5,
            weight: 25,
            duration: 60000
        },
        FLAMES: { 
            icon: '🔥', 
            color: '#E67E22', 
            name: 'Flame Power',
            description: 'Increases explosion range in four directions by 1 block',
            stackable: true,
            maxStack: 5,
            weight: 25,
            duration: 60000
        },
        SPEED: { 
            icon: '⚡', 
            color: '#F39C12', 
            name: 'Speed Up',
            description: 'Increases movement speed',
            stackable: true,
            maxStack: 3,
            weight: 20,
            duration: 45000
        },
        ONE_UP: {
            icon: '❤️',
            color: '#E91E63',
            name: 'Extra Life',
            description: 'Gain an extra life (max 4 lives)',
            stackable: false,
            maxStack: 1,
            weight: 10,
            duration: -1 // Permanent
        },
        BLOCK_PASS: {
            icon: '👻',
            color: '#9B59B6',
            name: 'Block Pass',
            description: 'Ability to pass through destructible blocks (not walls)',
            stackable: false,
            maxStack: 1,
            weight: 15,
            duration: 30000 // 30 seconds
        }
    }
};
export const GAME_STATES = {
    NICKNAME: 'nickname',
    MENU: 'menu',
    QUEUE: 'queue',
    LOBBY: 'lobby',
    PLAYING: 'playing',
    GAME_OVER: 'gameOver',
    ERROR: 'error'
};

export const EVENT_TYPES = {
    // Network events
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    RECONNECTING: 'reconnecting',
    
    // Game events
    PLAYER_JOINED: 'playerJoined',
    PLAYER_LEFT: 'playerLeft',
    PLAYER_MOVED: 'playerMoved',
    BOMB_PLACED: 'bombPlaced',
    BOMB_EXPLODED: 'bombExploded',
    POWER_UP_SPAWNED: 'powerUpSpawned',
    POWER_UP_COLLECTED: 'powerUpCollected',
    
    // UI events
    STATE_CHANGED: 'stateChanged',
    RENDER_REQUESTED: 'renderRequested'
};

export const CSS_CLASSES = {
    GAME_CONTAINER: 'bomberman-game',
    GAME_AREA: 'game-area',
    STATIC_ELEMENTS: 'static-elements',
    DYNAMIC_ELEMENTS: 'dynamic-elements',
    
    WALL: 'wall',
    BLOCK: 'block',
    PLAYER: 'player',
    BOMB: 'bomb',
    EXPLOSION: 'explosion-tile',
    POWER_UP: 'power-up',
    
    UI_HEADER: 'game-ui-header',
    CHAT_PANEL: 'chat-panel',
    HUD: 'game-hud'
};

export const DEBUG_CONFIG = {
    ENABLED: false,
    LOG_PERFORMANCE: false, // Disabled by default to reduce console noise
    LOG_NETWORK: false,
    LOG_GAME_EVENTS: false, // Disabled by default to reduce console noise
    SHOW_FPS: false,
    SHOW_DEBUG_INFO: false, // Disabled by default

    // NEW: Configurable debug features
    ENABLE_DEBUG_TOOLS: false, // Controls window.bombermanDebug object
    ENABLE_DEBUG_SHORTCUTS: true, // Controls F9-F12 keyboard shortcuts
    ENABLE_PERFORMANCE_LOGGING: false, // Controls performance.now() logging
    ENABLE_FRAME_LOGGING: false // Controls per-frame console logs
};
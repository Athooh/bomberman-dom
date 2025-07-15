/**
 * PhysicsWorker - Off-main-thread bomb physics and explosion calculations
 * Handles chain reactions, bomb placement validation, and explosion propagation
 * Uses predictive calculations to prevent frame drops during complex explosions
 */

// Physics state
let bombs = new Map();
let explosions = new Map();
let walls = new Set();
let blocks = new Set();
let players = new Map();

// Physics constants
const TILE_SIZE = 32;
const BOMB_TIMER = 3000; // 3 seconds
const EXPLOSION_DURATION = 1000; // 1 second
const MAX_EXPLOSION_RANGE = 3;

// Chain reaction tracking
let chainReactionQueue = [];
let explosionPropagationMap = new Map();

/**
 * Validate bomb placement at position
 */
function validateBombPlacement(x, y, playerId) {
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);
    const tileKey = `${tileX},${tileY}`;
    
    // Check if position is blocked
    if (walls.has(tileKey) || blocks.has(tileKey)) {
        return { valid: false, reason: 'blocked' };
    }
    
    // Check if there's already a bomb at this position
    for (const bomb of bombs.values()) {
        const bombTileX = Math.floor(bomb.x / TILE_SIZE);
        const bombTileY = Math.floor(bomb.y / TILE_SIZE);
        if (bombTileX === tileX && bombTileY === tileY) {
            return { valid: false, reason: 'bomb_exists' };
        }
    }
    
    // Check player bomb limit
    const player = players.get(playerId);
    if (player && player.bombsPlaced >= (player.maxBombs || 1)) {
        return { valid: false, reason: 'bomb_limit' };
    }
    
    return { valid: true, tileX, tileY };
}

/**
 * Create bomb with physics properties
 */
function createBomb(id, x, y, playerId, power = 1) {
    const bomb = {
        id,
        x,
        y,
        playerId,
        power,
        timer: BOMB_TIMER,
        isActive: true,
        createdAt: Date.now()
    };
    
    bombs.set(id, bomb);
    
    // Update player bomb count
    const player = players.get(playerId);
    if (player) {
        player.bombsPlaced = (player.bombsPlaced || 0) + 1;
    }
    
    return bomb;
}

/**
 * Update bomb timers and trigger explosions
 */
function updateBombs(deltaTime) {
    const explodingBombs = [];
    
    bombs.forEach((bomb, bombId) => {
        if (!bomb.isActive) return;
        
        bomb.timer -= deltaTime;
        
        if (bomb.timer <= 0) {
            explodingBombs.push(bomb);
            bombs.delete(bombId);
            
            // Update player bomb count
            const player = players.get(bomb.playerId);
            if (player) {
                player.bombsPlaced = Math.max(0, (player.bombsPlaced || 0) - 1);
            }
        }
    });
    
    // Process explosions
    explodingBombs.forEach(bomb => {
        createExplosion(bomb);
    });
    
    return explodingBombs;
}

/**
 * Create explosion with propagation calculation
 */
function createExplosion(bomb) {
    const explosionId = `explosion_${bomb.id}_${Date.now()}`;
    const centerX = Math.floor(bomb.x / TILE_SIZE);
    const centerY = Math.floor(bomb.y / TILE_SIZE);
    
    const explosion = {
        id: explosionId,
        centerX,
        centerY,
        power: bomb.power,
        tiles: [],
        createdAt: Date.now(),
        duration: EXPLOSION_DURATION
    };
    
    // Calculate explosion propagation
    const directions = [
        { dx: 0, dy: -1 }, // up
        { dx: 0, dy: 1 },  // down
        { dx: -1, dy: 0 }, // left
        { dx: 1, dy: 0 }   // right
    ];
    
    // Add center tile
    explosion.tiles.push({ x: centerX, y: centerY, type: 'center' });
    
    // Propagate in each direction
    directions.forEach(({ dx, dy }) => {
        for (let i = 1; i <= bomb.power; i++) {
            const tileX = centerX + (dx * i);
            const tileY = centerY + (dy * i);
            const tileKey = `${tileX},${tileY}`;
            
            // Check for walls (stop propagation)
            if (walls.has(tileKey)) {
                break;
            }
            
            // Add explosion tile
            explosion.tiles.push({ 
                x: tileX, 
                y: tileY, 
                type: 'propagation',
                direction: dx === 0 ? (dy > 0 ? 'down' : 'up') : (dx > 0 ? 'right' : 'left')
            });
            
            // Check for blocks (destroy and stop propagation)
            if (blocks.has(tileKey)) {
                explosion.tiles[explosion.tiles.length - 1].destroysBlock = true;
                blocks.delete(tileKey);
                break;
            }
            
            // Check for chain reaction with other bombs
            bombs.forEach((otherBomb, otherBombId) => {
                const otherTileX = Math.floor(otherBomb.x / TILE_SIZE);
                const otherTileY = Math.floor(otherBomb.y / TILE_SIZE);
                
                if (otherTileX === tileX && otherTileY === tileY) {
                    // Trigger chain reaction
                    chainReactionQueue.push({
                        bombId: otherBombId,
                        delay: 100 // Small delay for visual effect
                    });
                }
            });
        }
    });
    
    explosions.set(explosionId, explosion);
    explosionPropagationMap.set(explosionId, explosion.tiles);
    
    return explosion;
}

/**
 * Process chain reactions
 */
function processChainReactions(deltaTime) {
    const triggeredBombs = [];
    
    chainReactionQueue = chainReactionQueue.filter(reaction => {
        reaction.delay -= deltaTime;
        
        if (reaction.delay <= 0) {
            const bomb = bombs.get(reaction.bombId);
            if (bomb) {
                bomb.timer = 0; // Trigger immediately
                triggeredBombs.push(bomb);
            }
            return false; // Remove from queue
        }
        
        return true; // Keep in queue
    });
    
    return triggeredBombs;
}

/**
 * Update explosions
 */
function updateExplosions(deltaTime) {
    const expiredExplosions = [];
    
    explosions.forEach((explosion, explosionId) => {
        explosion.duration -= deltaTime;
        
        if (explosion.duration <= 0) {
            expiredExplosions.push(explosionId);
            explosions.delete(explosionId);
            explosionPropagationMap.delete(explosionId);
        }
    });
    
    return expiredExplosions;
}

/**
 * Get physics state for transfer
 */
function getPhysicsState() {
    return {
        bombs: Array.from(bombs.values()),
        explosions: Array.from(explosions.values()),
        chainReactions: chainReactionQueue.length,
        blocksDestroyed: Array.from(blocks).length
    };
}

/**
 * Message handler
 */
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    try {
        switch (type) {
            case 'UPDATE_PHYSICS':
                // Update entity data
                if (data.players) {
                    players.clear();
                    data.players.forEach(player => {
                        players.set(player.id, player);
                    });
                }
                
                if (data.walls) walls = new Set(data.walls);
                if (data.blocks) blocks = new Set(data.blocks);
                
                // Update physics
                const explodingBombs = updateBombs(data.deltaTime);
                const chainReactionBombs = processChainReactions(data.deltaTime);
                const expiredExplosions = updateExplosions(data.deltaTime);
                
                self.postMessage({
                    type: 'PHYSICS_UPDATE',
                    data: {
                        explodingBombs,
                        chainReactionBombs,
                        expiredExplosions,
                        physicsState: getPhysicsState(),
                        frameId: data.frameId
                    }
                });
                break;
                
            case 'PLACE_BOMB':
                const validation = validateBombPlacement(data.x, data.y, data.playerId);
                
                if (validation.valid) {
                    const bomb = createBomb(data.id, data.x, data.y, data.playerId, data.power);
                    self.postMessage({
                        type: 'BOMB_PLACED',
                        data: { bomb, validation }
                    });
                } else {
                    self.postMessage({
                        type: 'BOMB_PLACEMENT_FAILED',
                        data: validation
                    });
                }
                break;
                
            case 'TRIGGER_EXPLOSION':
                const bomb = bombs.get(data.bombId);
                if (bomb) {
                    const explosion = createExplosion(bomb);
                    bombs.delete(data.bombId);
                    
                    self.postMessage({
                        type: 'EXPLOSION_TRIGGERED',
                        data: { explosion }
                    });
                }
                break;
                
            case 'CLEANUP':
                bombs.clear();
                explosions.clear();
                chainReactionQueue.length = 0;
                explosionPropagationMap.clear();
                players.clear();
                walls.clear();
                blocks.clear();
                
                self.postMessage({ type: 'CLEANUP_COMPLETE' });
                break;
                
            default:
                console.warn('Unknown message type:', type);
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            error: error.message,
            stack: error.stack
        });
    }
};

// Handle worker errors
self.onerror = function(error) {
    self.postMessage({
        type: 'ERROR',
        error: error.message,
        filename: error.filename,
        lineno: error.lineno
    });
};

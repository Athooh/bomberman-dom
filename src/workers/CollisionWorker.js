/**
 * CollisionWorker - Off-main-thread collision detection
 * Uses transferable ArrayBuffers and spatial partitioning for maximum performance
 * Returns only changed collision states to minimize data transfer
 */

// Collision detection state
let spatialGrid = new Map();
let gridSize = 64; // 2x tile size for better spatial partitioning
let lastFrameId = 0;
let collisionResults = new Map();

// Entity data structures
let players = new Map();
let bombs = new Map();
let walls = new Set();
let blocks = new Set();
let explosions = new Map();

/**
 * Initialize spatial grid for efficient collision detection
 */
function initializeSpatialGrid(width, height) {
    spatialGrid.clear();
    const gridWidth = Math.ceil(width / gridSize);
    const gridHeight = Math.ceil(height / gridSize);
    
    for (let x = 0; x < gridWidth; x++) {
        for (let y = 0; y < gridHeight; y++) {
            spatialGrid.set(`${x},${y}`, {
                players: new Set(),
                bombs: new Set(),
                explosions: new Set(),
                walls: new Set(),
                blocks: new Set()
            });
        }
    }
}

/**
 * Get spatial grid cell for position
 */
function getGridCell(x, y) {
    const gridX = Math.floor(x / gridSize);
    const gridY = Math.floor(y / gridSize);
    return spatialGrid.get(`${gridX},${gridY}`);
}

/**
 * Add entity to spatial grid
 */
function addToGrid(entity, type) {
    const cell = getGridCell(entity.x, entity.y);
    if (cell) {
        cell[type].add(entity.id);
    }
}

/**
 * Remove entity from spatial grid
 */
function removeFromGrid(entity, type) {
    const cell = getGridCell(entity.x, entity.y);
    if (cell) {
        cell[type].delete(entity.id);
    }
}

/**
 * Check collision between two entities
 */
function checkCollision(entity1, entity2, size1 = 32, size2 = 32) {
    const dx = Math.abs(entity1.x - entity2.x);
    const dy = Math.abs(entity1.y - entity2.y);
    
    return dx < (size1 + size2) / 2 && dy < (size1 + size2) / 2;
}

/**
 * Process collision detection for all entities
 */
function processCollisions(frameId) {
    const results = {
        playerCollisions: [],
        bombCollisions: [],
        explosionHits: [],
        frameId: frameId
    };
    
    // Clear spatial grid
    spatialGrid.forEach(cell => {
        cell.players.clear();
        cell.bombs.clear();
        cell.explosions.clear();
    });
    
    // Populate spatial grid
    players.forEach(player => addToGrid(player, 'players'));
    bombs.forEach(bomb => addToGrid(bomb, 'bombs'));
    explosions.forEach(explosion => addToGrid(explosion, 'explosions'));
    
    // Check player collisions
    players.forEach(player => {
        if (!player.isAlive) return;
        
        const cell = getGridCell(player.x, player.y);
        if (!cell) return;
        
        // Check collision with walls
        walls.forEach(wallKey => {
            const [wallX, wallY] = wallKey.split(',').map(Number);
            const wall = { x: wallX * 32, y: wallY * 32 };
            
            if (checkCollision(player, wall)) {
                results.playerCollisions.push({
                    playerId: player.id,
                    type: 'wall',
                    x: wall.x,
                    y: wall.y
                });
            }
        });
        
        // Check collision with blocks
        blocks.forEach(blockKey => {
            const [blockX, blockY] = blockKey.split(',').map(Number);
            const block = { x: blockX * 32, y: blockY * 32 };
            
            if (checkCollision(player, block)) {
                results.playerCollisions.push({
                    playerId: player.id,
                    type: 'block',
                    x: block.x,
                    y: block.y
                });
            }
        });
        
        // Check collision with bombs
        cell.bombs.forEach(bombId => {
            const bomb = bombs.get(bombId);
            if (bomb && checkCollision(player, bomb)) {
                results.playerCollisions.push({
                    playerId: player.id,
                    type: 'bomb',
                    bombId: bomb.id,
                    x: bomb.x,
                    y: bomb.y
                });
            }
        });
        
        // Check collision with explosions
        cell.explosions.forEach(explosionId => {
            const explosion = explosions.get(explosionId);
            if (explosion && checkCollision(player, explosion)) {
                results.explosionHits.push({
                    playerId: player.id,
                    explosionId: explosion.id,
                    x: explosion.x,
                    y: explosion.y
                });
            }
        });
    });
    
    return results;
}

/**
 * Update entity data from JavaScript objects (simplified approach)
 */
function updateEntitiesFromData(entityArray, type) {
    const entityMap = type === 'players' ? players :
                     type === 'bombs' ? bombs : explosions;

    entityMap.clear();

    if (Array.isArray(entityArray)) {
        entityArray.forEach(entity => {
            entityMap.set(entity.id, {
                id: entity.id,
                x: entity.x,
                y: entity.y,
                isAlive: entity.isAlive !== false, // Default to true if not specified
                tileX: entity.tileX,
                tileY: entity.tileY,
                isInvulnerable: entity.isInvulnerable || false
            });
        });
    }
}

/**
 * Message handler
 */
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    try {
        switch (type) {
            case 'INIT_GRID':
                initializeSpatialGrid(data.width, data.height);
                self.postMessage({ type: 'GRID_INITIALIZED' });
                break;
                
            case 'UPDATE_ENTITIES':
                if (data.players) updateEntitiesFromData(data.players, 'players');
                if (data.bombs) updateEntitiesFromData(data.bombs, 'bombs');
                if (data.explosions) updateEntitiesFromData(data.explosions, 'explosions');
                
                // Update static entities
                if (data.walls) walls = new Set(data.walls);
                if (data.blocks) blocks = new Set(data.blocks);
                
                const results = processCollisions(data.frameId);
                
                self.postMessage({
                    type: 'COLLISION_RESULTS',
                    data: results
                });
                break;
                
            case 'CLEANUP':
                spatialGrid.clear();
                players.clear();
                bombs.clear();
                explosions.clear();
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

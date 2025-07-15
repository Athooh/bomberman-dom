// src/systems/MapSystem.js
// Handles map generation, loading, and management

import { GAME_CONFIG, PLAYER_CONFIG, POWER_UP_CONFIG } from '../utils/Constants.js';
import { Logger } from '../utils/Logger.js';

/**
 * Map System
 * Handles map generation, loading, and block destruction
 */
export class MapSystem {
    constructor() {
        this.logger = new Logger('MapSystem');
        
        // Map data
        this.walls = new Set();
        this.blocks = new Set();
        this.spawnPoints = [];
        
        // Map metadata
        this.mapWidth = GAME_CONFIG.MAP_WIDTH;
        this.mapHeight = GAME_CONFIG.MAP_HEIGHT;
        this.tileSize = GAME_CONFIG.TILE_SIZE;
        
        // Generation settings
        this.generationSettings = {
            blockDensity: 0.6,          // 60% chance for blocks
            safeZoneRadius: 2,          // Safe zone around spawn points
            symmetrical: true,          // Generate symmetrical maps
            ensureConnectivity: true,   // Ensure all areas are reachable
            minPathWidth: 1            // Minimum corridor width
        };
        
        // Predefined map templates
        this.mapTemplates = new Map();
        this.loadMapTemplates();
        
        this.logger.info('Map system created');
    }
    
    /**
     * Generate a new map
     */
    generateMap(settings = {}) {
        this.logger.info('Generating new map...');
        
        // Merge settings
        const mapSettings = { ...this.generationSettings, ...settings };
        
        // Clear existing map
        this.clear();
        
        // Generate spawn points first
        this.generateSpawnPoints();
        
        // Generate walls (border and internal)
        this.generateWalls();
        
        // Generate destructible blocks
        this.generateBlocks(mapSettings);
        
        // Ensure connectivity
        if (mapSettings.ensureConnectivity) {
            this.ensureConnectivity();
        }
        
        // Validate map
        this.validateMap();
        
        this.logger.info(`Map generated: ${this.walls.size} walls, ${this.blocks.size} blocks`);
        
        return this.getMapData();
    }
    
    /**
     * Load a predefined map template
     */
    loadTemplate(templateName) {
        const template = this.mapTemplates.get(templateName);
        if (!template) {
            this.logger.error('Map template not found:', templateName);
            return this.generateMap(); // Fallback to generated map
        }
        
        this.logger.info('Loading map template:', templateName);
        
        // Clear existing map
        this.clear();
        
        // Load template data
        this.walls = new Set(template.walls);
        this.blocks = new Set(template.blocks);
        this.spawnPoints = [...template.spawnPoints];
        
        this.logger.info(`Template loaded: ${this.walls.size} walls, ${this.blocks.size} blocks`);
        
        return this.getMapData();
    }
    
    /**
     * Load map from server data
     */
    loadMap(mapData) {
        this.logger.info('Loading map from server data');
        
        // Clear existing map
        this.clear();
        
        // Load data
        if (mapData.walls) {
            this.walls = new Set(mapData.walls);
        }
        
        if (mapData.blocks) {
            this.blocks = new Set(mapData.blocks);
        }
        
        if (mapData.spawnPoints) {
            this.spawnPoints = [...mapData.spawnPoints];
        } else {
            // Generate default spawn points if not provided
            this.generateSpawnPoints();
        }
        
        this.logger.info(`Map loaded: ${this.walls.size} walls, ${this.blocks.size} blocks`);
        
        return this.getMapData();
    }
    
    /**
     * Generate spawn points for players
     */
    generateSpawnPoints() {
        this.spawnPoints = [
            { x: 1, y: 1 },                                    // Top-left
            { x: this.mapWidth - 2, y: 1 },                   // Top-right
            { x: 1, y: this.mapHeight - 2 },                  // Bottom-left
            { x: this.mapWidth - 2, y: this.mapHeight - 2 }   // Bottom-right
        ];
        
        this.logger.debug('Spawn points generated:', this.spawnPoints);
    }
    
    /**
     * Generate border walls and internal wall pillars
     */
    generateWalls() {
        // Border walls
        for (let x = 0; x < this.mapWidth; x++) {
            this.walls.add(`${x},0`);                    // Top border
            this.walls.add(`${x},${this.mapHeight - 1}`); // Bottom border
        }
        
        for (let y = 0; y < this.mapHeight; y++) {
            this.walls.add(`0,${y}`);                    // Left border
            this.walls.add(`${this.mapWidth - 1},${y}`); // Right border
        }
        
        // Internal walls (every 2 tiles, creating a grid pattern)
        for (let x = 2; x < this.mapWidth - 1; x += 2) {
            for (let y = 2; y < this.mapHeight - 1; y += 2) {
                this.walls.add(`${x},${y}`);
            }
        }
        
        this.logger.debug(`Generated ${this.walls.size} walls`);
    }
    
    /**
     * Generate destructible blocks
     */
    generateBlocks(settings) {
        const { blockDensity, safeZoneRadius } = settings;
        
        for (let x = 1; x < this.mapWidth - 1; x++) {
            for (let y = 1; y < this.mapHeight - 1; y++) {
                const tileKey = `${x},${y}`;
                
                // Skip if there's already a wall
                if (this.walls.has(tileKey)) continue;
                
                // Skip safe zones around spawn points
                if (this.isInSafeZone(x, y, safeZoneRadius)) continue;
                
                // Random block placement
                if (Math.random() < blockDensity) {
                    this.blocks.add(tileKey);
                }
            }
        }
        
        this.logger.debug(`Generated ${this.blocks.size} blocks`);
    }
    
    /**
     * Check if position is in safe zone around spawn points
     */
    isInSafeZone(x, y, radius) {
        return this.spawnPoints.some(spawn => {
            const distance = Math.abs(x - spawn.x) + Math.abs(y - spawn.y);
            return distance <= radius;
        });
    }
    
    /**
     * Ensure all areas of the map are reachable
     */
    ensureConnectivity() {
        this.logger.debug('Ensuring map connectivity...');
        
        // Use flood fill to find unreachable areas
        const visited = new Set();
        const queue = [this.spawnPoints[0]]; // Start from first spawn point
        
        while (queue.length > 0) {
            const { x, y } = queue.shift();
            const tileKey = `${x},${y}`;
            
            if (visited.has(tileKey)) continue;
            visited.add(tileKey);
            
            // Check all 4 directions
            const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            
            directions.forEach(([dx, dy]) => {
                const newX = x + dx;
                const newY = y + dy;
                const newTileKey = `${newX},${newY}`;
                
                // Check bounds
                if (newX < 0 || newX >= this.mapWidth || 
                    newY < 0 || newY >= this.mapHeight) return;
                
                // Check if walkable
                if (!this.walls.has(newTileKey) && !this.blocks.has(newTileKey)) {
                    if (!visited.has(newTileKey)) {
                        queue.push({ x: newX, y: newY });
                    }
                }
            });
        }
        
        // Remove blocks that prevent connectivity to spawn points
        this.spawnPoints.forEach(spawn => {
            const spawnKey = `${spawn.x},${spawn.y}`;
            if (!visited.has(spawnKey)) {
                this.createPathToSpawn(spawn, visited);
            }
        });
        
        this.logger.debug('Map connectivity ensured');
    }
    
    /**
     * Create path to unreachable spawn point
     */
    createPathToSpawn(spawn, visited) {
        // Find nearest reachable tile and create path
        let nearestDistance = Infinity;
        let nearestTile = null;
        
        visited.forEach(tileKey => {
            const [x, y] = tileKey.split(',').map(Number);
            const distance = Math.abs(x - spawn.x) + Math.abs(y - spawn.y);
            
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestTile = { x, y };
            }
        });
        
        if (nearestTile) {
            // Remove blocks along path
            this.createPath(nearestTile, spawn);
        }
    }
    
    /**
     * Create path between two points by removing blocks
     */
    createPath(from, to) {
        let x = from.x;
        let y = from.y;
        
        // Move horizontally first
        while (x !== to.x) {
            const tileKey = `${x},${y}`;
            this.blocks.delete(tileKey);
            
            x += x < to.x ? 1 : -1;
        }
        
        // Then move vertically
        while (y !== to.y) {
            const tileKey = `${x},${y}`;
            this.blocks.delete(tileKey);
            
            y += y < to.y ? 1 : -1;
        }
        
        // Ensure destination is clear
        this.blocks.delete(`${to.x},${to.y}`);
    }
    
    /**
     * Validate map for gameplay requirements
     */
    validateMap() {
        const issues = [];
        
        // Check spawn points are clear
        this.spawnPoints.forEach((spawn, index) => {
            const spawnKey = `${spawn.x},${spawn.y}`;
            if (this.walls.has(spawnKey) || this.blocks.has(spawnKey)) {
                issues.push(`Spawn point ${index} is blocked`);
            }
        });
        
        // Check minimum free space around spawn points
        this.spawnPoints.forEach((spawn, index) => {
            const freeSpaces = this.countFreeSpacesAround(spawn.x, spawn.y, 1);
            if (freeSpaces < 2) {
                issues.push(`Spawn point ${index} has insufficient free space`);
            }
        });
        
        if (issues.length > 0) {
            this.logger.warn('Map validation issues:', issues);
            // Auto-fix critical issues
            this.fixMapIssues(issues);
        } else {
            this.logger.debug('Map validation passed');
        }
    }
    
    /**
     * Count free spaces around a position
     */
    countFreeSpacesAround(x, y, radius) {
        let freeSpaces = 0;
        
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (dx === 0 && dy === 0) continue;
                
                const checkX = x + dx;
                const checkY = y + dy;
                const tileKey = `${checkX},${checkY}`;
                
                if (checkX >= 0 && checkX < this.mapWidth &&
                    checkY >= 0 && checkY < this.mapHeight &&
                    !this.walls.has(tileKey) && !this.blocks.has(tileKey)) {
                    freeSpaces++;
                }
            }
        }
        
        return freeSpaces;
    }
    
    /**
     * Fix critical map issues
     */
    fixMapIssues(issues) {
        // Clear spawn points and surrounding area
        this.spawnPoints.forEach(spawn => {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const tileKey = `${spawn.x + dx},${spawn.y + dy}`;
                    this.blocks.delete(tileKey);
                }
            }
        });
        
        this.logger.info('Map issues auto-fixed');
    }
    
    /**
     * Destroy block at position
     */
    destroyBlock(x, y) {
        const tileKey = `${x},${y}`;
        
        if (this.blocks.has(tileKey)) {
            this.blocks.delete(tileKey);
            this.logger.debug(`Block destroyed at (${x}, ${y})`);
            
            // Chance to spawn power-up
            if (Math.random() < POWER_UP_CONFIG.SPAWN_CHANCE) {
                return this.createPowerUp(x, y);
            }
        }
        
        return null;
    }
    
    /**
     * Create power-up at position
     */
    createPowerUp(x, y) {
        const powerUpTypes = Object.keys(POWER_UP_CONFIG.TYPES);
        const randomType = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
        const config = POWER_UP_CONFIG.TYPES[randomType];
        
        const powerUp = {
            id: `powerup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: randomType.toLowerCase(),
            x: x,
            y: y,
            icon: config.icon,
            color: config.color,
            name: config.name,
            spawnTime: Date.now()
        };
        
        this.logger.debug(`Power-up spawned: ${powerUp.type} at (${x}, ${y})`);
        
        return powerUp;
    }
    
    /**
     * Check if position is walkable
     */
    isWalkable(x, y) {
        const tileKey = `${x},${y}`;
        return !this.walls.has(tileKey) && !this.blocks.has(tileKey);
    }
    
    /**
     * Check if position is wall
     */
    isWall(x, y) {
        return this.walls.has(`${x},${y}`);
    }
    
    /**
     * Check if position is block
     */
    isBlock(x, y) {
        return this.blocks.has(`${x},${y}`);
    }
    
    /**
     * Get spawn point for player
     */
    getSpawnPoint(playerIndex) {
        if (playerIndex < this.spawnPoints.length) {
            return { ...this.spawnPoints[playerIndex] };
        }
        
        // Return first spawn point if index out of bounds
        return { ...this.spawnPoints[0] };
    }
    
    /**
     * Get all spawn points
     */
    getSpawnPoints() {
        return [...this.spawnPoints];
    }
    
    /**
     * Get map data for serialization
     */
    getMapData() {
        return {
            walls: Array.from(this.walls),
            blocks: Array.from(this.blocks),
            spawnPoints: [...this.spawnPoints],
            dimensions: {
                width: this.mapWidth,
                height: this.mapHeight,
                tileSize: this.tileSize
            }
        };
    }
    
    /**
     * Load predefined map templates
     */
    loadMapTemplates() {
        // Classic Bomberman map
        this.mapTemplates.set('classic', {
            walls: this.generateClassicWalls(),
            blocks: this.generateClassicBlocks(),
            spawnPoints: [
                { x: 1, y: 1 },
                { x: 13, y: 1 },
                { x: 1, y: 11 },
                { x: 13, y: 11 }
            ]
        });
        
        // Open arena map
        this.mapTemplates.set('arena', {
            walls: this.generateArenaWalls(),
            blocks: this.generateArenaBlocks(),
            spawnPoints: [
                { x: 2, y: 2 },
                { x: 12, y: 2 },
                { x: 2, y: 10 },
                { x: 12, y: 10 }
            ]
        });
        
        this.logger.debug(`Loaded ${this.mapTemplates.size} map templates`);
    }
    
    /**
     * Generate classic map walls
     */
    generateClassicWalls() {
        const walls = [];
        
        // Border
        for (let x = 0; x < 15; x++) {
            walls.push(`${x},0`);
            walls.push(`${x},12`);
        }
        for (let y = 0; y < 13; y++) {
            walls.push(`0,${y}`);
            walls.push(`14,${y}`);
        }
        
        // Internal grid
        for (let x = 2; x < 14; x += 2) {
            for (let y = 2; y < 12; y += 2) {
                walls.push(`${x},${y}`);
            }
        }
        
        return walls;
    }
    
    /**
     * Generate classic map blocks
     */
    generateClassicBlocks() {
        const blocks = [];
        
        // Predefined block pattern for classic feel
        const blockPattern = [
            [3, 1], [5, 1], [7, 1], [9, 1], [11, 1],
            [1, 3], [3, 3], [5, 3], [7, 3], [9, 3], [11, 3], [13, 3],
            [1, 5], [3, 5], [5, 5], [7, 5], [9, 5], [11, 5], [13, 5],
            [1, 7], [3, 7], [5, 7], [7, 7], [9, 7], [11, 7], [13, 7],
            [1, 9], [3, 9], [5, 9], [7, 9], [9, 9], [11, 9], [13, 9],
            [3, 11], [5, 11], [7, 11], [9, 11], [11, 11]
        ];
        
        blockPattern.forEach(([x, y]) => {
            // Skip spawn areas
            if (!this.isInSafeZone(x, y, 1)) {
                blocks.push(`${x},${y}`);
            }
        });
        
        return blocks;
    }
    
    /**
     * Generate arena map walls (minimal walls)
     */
    generateArenaWalls() {
        const walls = [];
        
        // Border only
        for (let x = 0; x < 15; x++) {
            walls.push(`${x},0`);
            walls.push(`${x},12`);
        }
        for (let y = 0; y < 13; y++) {
            walls.push(`0,${y}`);
            walls.push(`14,${y}`);
        }
        
        // Center pillar
        walls.push('7,6');
        
        return walls;
    }
    
    /**
     * Generate arena map blocks (sparse)
     */
    generateArenaBlocks() {
        const blocks = [];
        
        // Scattered blocks for cover
        const blockPositions = [
            [4, 3], [10, 3], [4, 9], [10, 9],
            [6, 5], [8, 5], [6, 7], [8, 7],
            [3, 6], [11, 6]
        ];
        
        blockPositions.forEach(([x, y]) => {
            blocks.push(`${x},${y}`);
        });
        
        return blocks;
    }
    
    /**
     * Clear all map data
     */
    clear() {
        this.walls.clear();
        this.blocks.clear();
        this.spawnPoints = [];
    }
    
    /**
     * Get map statistics
     */
    getStats() {
        const totalTiles = this.mapWidth * this.mapHeight;
        const walkableTiles = totalTiles - this.walls.size - this.blocks.size;
        
        return {
            dimensions: `${this.mapWidth}x${this.mapHeight}`,
            totalTiles,
            walls: this.walls.size,
            blocks: this.blocks.size,
            walkableTiles,
            spawnPoints: this.spawnPoints.length,
            walkablePercentage: ((walkableTiles / totalTiles) * 100).toFixed(1)
        };
    }
    
    /**
     * Cleanup map system
     */
    cleanup() {
        this.clear();
        this.mapTemplates.clear();
        this.logger.info('Map system cleaned up');
    }
}

export default MapSystem;
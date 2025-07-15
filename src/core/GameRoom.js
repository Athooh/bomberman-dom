// src/core/GameRoom.js
// Core Game Room Management System
// Handles game sessions, timing, state management, and player coordination
// Follows game development best practices with optimized performance

import { Logger } from '../utils/Logger.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { GAME_CONFIG, PLAYER_CONFIG, POWER_UP_CONFIG } from '../utils/Constants.js';

/**
 * GameRoom Class - Core Game Session Manager
 * 
 * RESPONSIBILITIES:
 * - Manage game lifecycle (waiting → countdown → playing → finished)
 * - Handle player coordination and state synchronization
 * - Implement proper timing mechanics (20s wait + 10s countdown)
 * - Manage game map, entities, and collision detection
 * - Optimize performance for real-time multiplayer
 * 
 * TIMING LOGIC:
 * - 2-3 players: Wait up to 20 seconds for more players
 * - 4 players: Start immediately  
 * - After wait period: 10-second countdown before game starts
 * 
 * @class GameRoom
 * @version 2.0.0
 */
export class GameRoom {
    constructor(gameId, initialPlayerData, gameConfig) {
        this.logger = new Logger(`GameRoom:${gameId}`);

        // Game identity and configuration
        this.gameId = gameId;
        this.config = { ...gameConfig };
        this.createdAt = Date.now();


        this.mapSeed = this.generateMapSeed();
        this.random = this.createSeededRandom(this.mapSeed);

        // Game state management
        this.state = 'countdown';
        this.players = new Map();
        this.maxPlayers = this.config.MAX_PLAYERS || 4;
        this.minPlayers = this.config.MIN_PLAYERS || 2;

        // Timing system for proper game start logic
        this.timers = {
            countdownTimer: null,    // 10-second countdown
            gameTimer: null          // Main game timer
        };

        this.countdownDuration = 10000;  // 10 seconds
        this.countdownValue = 10;        // Current countdown number

        // Game world state
        this.map = null;
        this.entities = {
            bombs: new Map(),
            explosions: new Map(),
            powerUps: new Map(),
            walls: new Set(),
            blocks: new Set()
        };

        // Performance optimization
        this.tickRate = 60;
        this.lastTickTime = 0;
        this.tickInterval = 1000 / this.tickRate;
        this.gameLoopId = null;

        // Game statistics
        this.stats = {
            startTime: null,
            endTime: null,
            duration: 0,
            winner: null,
            playersEliminated: 0
        };

        // Timer broadcasting
        this.timerBroadcastInterval = null;
        this.TIMER_BROADCAST_INTERVAL = 1000; // Broadcast timer every 1 second

        this.lastBroadcastHash = null; // For optimized state broadcasting

        // Initialize players and start the room
        this.initializePlayers(initialPlayerData);
        this.startCountdown();

        if (typeof requestAnimationFrame === 'undefined') {
            global.requestAnimationFrame = (callback) => {
                return setTimeout(() => callback(Date.now()), 16.67);
            };
        }

        // Polyfill cancelAnimationFrame for Node.js environment
        if (typeof cancelAnimationFrame === 'undefined') {
            global.cancelAnimationFrame = (id) => {
                clearTimeout(id);
            };
            this.logger.debug('Applied cancelAnimationFrame polyfill for Node.js');
        }

        this.logger.info(`Game room created with ${initialPlayerData.length} players`);
    }


    /**
     * Initialize players with their data including nicknames
     */
    initializePlayers(playerDataArray) {
        if (!playerDataArray || playerDataArray.length === 0) {
            this.logger.error('❌ Cannot initialize players: No player data provided');
            return;
        }

        this.players.clear();

        playerDataArray.forEach((playerData, index) => {
            const playerId = playerData.id;
            if (index >= PLAYER_CONFIG.STARTING_POSITIONS.length) {
                this.logger.warn(`⚠️ Too many players: ${playerDataArray.length}, max supported: ${PLAYER_CONFIG.STARTING_POSITIONS.length}`);
                return;
            }

            const startPos = PLAYER_CONFIG.STARTING_POSITIONS[index];
            const pixelX = startPos.x * this.config.TILE_SIZE;
            const pixelY = startPos.y * this.config.TILE_SIZE;

            this.players.set(playerId, {
                id: playerId,
                nickname: playerData.nickname || `Player ${index + 1}`,
                index: index,
                x: pixelX,
                y: pixelY,
                tileX: startPos.x,
                tileY: startPos.y,
                lives: GAME_CONFIG.LIVES_PER_PLAYER,
                isAlive: true,
                isInvulnerable: false,
                score: 0,
                powerUps: {
                    speed: 0,
                    bombs: 0,
                    flames: 0,
                    range: 0
                },
                // Initialize power-up timer system
                _powerUpTimers: {
                    speed: [],
                    bombs: [],
                    flames: []
                },
                // Stats affected by power-ups
                maxBombs: 1,
                bombRange: 1,
                direction: null,
                isMoving: false,
                joinedAt: Date.now()
            });
        });

        this.logger.info(`✅ Initialized ${playerDataArray.length} players with power-up timeout system`);
    }

    initializePlayerPowerUpTimers(player) {
        if (!player._powerUpTimers) {
            player._powerUpTimers = {
                speed: [],
                bombs: [],
                flames: [],
                blockPass: []
            };
            this.logger.debug(`Initialized power-up timers for player ${player.id}`);
        } else {
            // Ensure all timer arrays exist (for backward compatibility)
            const requiredTimers = ['speed', 'bombs', 'flames', 'blockPass'];
            requiredTimers.forEach(timerType => {
                if (!player._powerUpTimers[timerType]) {
                    player._powerUpTimers[timerType] = [];
                    this.logger.debug(`Added missing ${timerType} timer array for player ${player.id}`);
                }
            });
        }
    }




    /**
     * Start the waiting period with proper timing logic
     * Implements the 20-second wait for 2-3 players
     */
    startWaitingPeriod() {
        this.state = 'waiting';

        // If we already have 4 players, start immediately
        if (this.players.size >= this.maxPlayers) {
            this.logger.info('4 players detected - starting immediately');
            this.startCountdown();
            return;
        }

        // Start 20-second waiting period for 2-3 players
        this.logger.info(`Starting 20-second waiting period for ${this.players.size} players`);

        // Broadcast waiting state to all players
        this.broadcastToPlayers({
            type: 'gameWaiting',
            playersCount: this.players.size,
            maxPlayers: this.maxPlayers,
            waitingTime: this.waitingDuration / 1000
        });

        // Set up waiting timer
        this.timers.waitingTimer = setTimeout(() => {
            this.logger.info('Waiting period completed - starting countdown');
            this.startCountdown();
        }, this.waitingDuration);
    }

    /**
     * Start the 10-second countdown before game begins
     * Handles countdown updates and final game start
     */
    startCountdown() {
        this.state = 'countdown';
        this.countdownValue = 10;

        this.logger.info(`Starting 10-second countdown with ${this.players.size} players`);
        console.log(`🎮 [GameRoom] Starting countdown for game ${this.gameId}`);

        // Broadcast countdown start
        this.broadcastToPlayers({
            type: 'gameCountdown',
            countdown: this.countdownValue,
            players: this.getPlayersData()
        });

        // Start countdown timer - updates every second
        this.timers.countdownTimer = setInterval(() => {
            this.countdownValue--;
            console.log(`🎮 [GameRoom] Countdown: ${this.countdownValue} for game ${this.gameId}`);

            // Broadcast countdown update
            this.broadcastToPlayers({
                type: 'countdownUpdate',
                countdown: this.countdownValue
            });

            // Start game when countdown reaches 0
            if (this.countdownValue <= 0) {
                clearInterval(this.timers.countdownTimer);
                this.timers.countdownTimer = null;
                console.log(`🎮 [GameRoom] Countdown finished, starting game ${this.gameId}`);
                this.startGame();
            }
        }, 1000);
    }

    /**
     * Start the actual game
     * Initialize game world, start game loop, and broadcast game start
     */
    startGame() {
        this.state = 'playing';
        this.stats.startTime = Date.now();

        this.logger.info(`Game started with ${this.players.size} players`);

        if (!this.collisionSystem) {
            this.collisionSystem = new CollisionSystem();

            // Set up collision system event listener for power-up collection
            this.collisionSystem.on('playerCollectedPowerUp', (data) => {
                this.handlePlayerCollectedPowerUp(data);
            });

            // Set up additional collision event listeners
            this.collisionSystem.on('playerHitByExplosion', (data) => {
                this.handlePlayerHitByExplosion(data);
            });

            this.logger.debug('✅ Server-side CollisionSystem created with all event listeners');
        }

        // Initialize game world
        this.initializeGameWorld();

        // Start game loop
        this.startGameLoop();

        // Start timer broadcasting
        this.startTimerBroadcast();

        // Get players data for debugging
        const playersData = this.getPlayersData();
        console.log('🎮 [GameRoom] Sending gameStart with players:', playersData.map(p => ({ id: p.id, nickname: p.nickname })));

        // Broadcast game start to all players
        this.broadcastToPlayers({
            type: 'gameStart',
            gameId: this.gameId,
            map: this.serializeMap(),
            players: playersData,
            gameConfig: this.config
        });
    }

    /**
     * Initialize the game world with map, walls, and blocks
     */
    initializeGameWorld() {
        // Clear existing entities
        this.entities.bombs.clear();
        this.entities.explosions.clear();
        this.entities.powerUps.clear();

        // Generate game map with unique seed
        this.map = this.generateMap();

        // Extract walls and blocks from map
        this.entities.walls.clear();
        this.entities.blocks.clear();

        for (let y = 0; y < this.config.MAP_HEIGHT; y++) {
            for (let x = 0; x < this.config.MAP_WIDTH; x++) {
                const tile = this.map[y][x];
                if (tile === 1) {
                    this.entities.walls.add(`${x},${y}`);
                } else if (tile === 2) {
                    this.entities.blocks.add(`${x},${y}`);
                }
            }
        }

        // Update collision system with new map
        this.updateServerCollisionGrid();

        this.logger.info(`Game world initialized: ${this.entities.walls.size} walls, ${this.entities.blocks.size} blocks`);
    }

    updateServerCollisionGrid() {
        // Convert explosions
        const explosions = Array.from(this.entities.explosions.values()).map(explosion => ({
            ...explosion,
            tiles: [{ x: explosion.x, y: explosion.y }]
        }));

        // Convert power-ups with consistent coordinates
        const powerUps = Array.from(this.entities.powerUps.entries()).map(([tileKey, powerUp]) => {
            return {
                ...powerUp,
                id: tileKey // Use tileKey as consistent ID
            };
        });

        const gameState = {
            walls: this.entities.walls || new Set(),
            blocks: this.entities.blocks || new Set(),
            bombs: Array.from(this.entities.bombs.values()),
            players: Array.from(this.players.values()),
            powerUps: powerUps,
            explosions: explosions
        };

        this.collisionSystem.updateCollisionGrid(gameState);
    }

    /**
     * Generate optimized game map
     * Creates walls, destructible blocks, and open spaces
     */
    generateMap() {
        this.logger.info(`Generating map with seed: ${this.mapSeed}`);

        const map = Array(this.config.MAP_HEIGHT).fill(null)
            .map(() => Array(this.config.MAP_WIDTH).fill(0));

        // Generate border walls (always same)
        for (let y = 0; y < this.config.MAP_HEIGHT; y++) {
            for (let x = 0; x < this.config.MAP_WIDTH; x++) {
                if (x === 0 || x === this.config.MAP_WIDTH - 1 ||
                    y === 0 || y === this.config.MAP_HEIGHT - 1) {
                    map[y][x] = 1; // Wall
                }
            }
        }

        // Generate inner walls (grid pattern - always same)
        for (let y = 2; y < this.config.MAP_HEIGHT - 2; y += 2) {
            for (let x = 2; x < this.config.MAP_WIDTH - 2; x += 2) {
                map[y][x] = 1; // Wall
            }
        }

        // Generate random destructible blocks with seeded randomness
        const spawnAreas = this.getSpawnAreas();

        for (let y = 1; y < this.config.MAP_HEIGHT - 1; y++) {
            for (let x = 1; x < this.config.MAP_WIDTH - 1; x++) {
                if (map[y][x] === 0) { // Empty space
                    // Check if it's a spawn area
                    const isSpawnArea = spawnAreas.some(spawn =>
                        Math.abs(spawn.x - x) <= 1 && Math.abs(spawn.y - y) <= 1
                    );

                    // Use seeded random for block placement
                    // Different probability zones for varied gameplay
                    const blockChance = this.getBlockPlacementChance(x, y);

                    if (!isSpawnArea && this.random.nextFloat() < blockChance) {
                        map[y][x] = 2; // Destructible block
                    }
                }
            }
        }

        // Add some random variation patterns
        this.addRandomPatterns(map, spawnAreas);

        this.logger.info(`Map generated with ${this.countMapElements(map)} elements`);
        return map;
    }
    countMapElements(map) {
        let walls = 0, blocks = 0;

        for (let y = 0; y < map.length; y++) {
            for (let x = 0; x < map[y].length; x++) {
                if (map[y][x] === 1) walls++;
                else if (map[y][x] === 2) blocks++;
            }
        }

        return { walls, blocks };
    }

    generateMapSeed() {
        // Combine game ID, timestamp, and random component for uniqueness
        const timestamp = Date.now();
        const randomComponent = Math.floor(Math.random() * 1000000);
        const gameIdHash = this.gameId.split('').reduce((hash, char) => {
            return hash + char.charCodeAt(0);
        }, 0);

        return (timestamp + randomComponent + gameIdHash) % 2147483647; // Keep within 32-bit integer
    }
    createSeededRandom(seed) {
        let currentSeed = seed;

        return {
            next: () => {
                currentSeed = (currentSeed * 16807) % 2147483647;
                return (currentSeed - 1) / 2147483646;
            },

            // Random integer between min and max (inclusive)
            nextInt: (min, max) => {
                return Math.floor(this.random.next() * (max - min + 1)) + min;
            },

            // Random float between 0 and 1
            nextFloat: () => {
                return this.random.next();
            }
        };
    }

    getSpawnAreas() {
        return [
            { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, // Top-left spawn
            { x: this.config.MAP_WIDTH - 2, y: 1 }, { x: this.config.MAP_WIDTH - 3, y: 1 },
            { x: this.config.MAP_WIDTH - 2, y: 2 }, // Top-right spawn
            { x: 1, y: this.config.MAP_HEIGHT - 2 }, { x: 2, y: this.config.MAP_HEIGHT - 2 },
            { x: 1, y: this.config.MAP_HEIGHT - 3 }, // Bottom-left spawn
            { x: this.config.MAP_WIDTH - 2, y: this.config.MAP_HEIGHT - 2 },
            { x: this.config.MAP_WIDTH - 3, y: this.config.MAP_HEIGHT - 2 },
            { x: this.config.MAP_WIDTH - 2, y: this.config.MAP_HEIGHT - 3 } // Bottom-right spawn
        ];
    }

    getBlockPlacementChance(x, y) {
        const centerX = this.config.MAP_WIDTH / 2;
        const centerY = this.config.MAP_HEIGHT / 2;
        const distanceToCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        const maxDistance = Math.sqrt(centerX ** 2 + centerY ** 2);

        // More blocks toward center, fewer near edges
        const baseChance = 0.6;
        const centerBonus = (1 - distanceToCenter / maxDistance) * 0.3;

        return Math.min(baseChance + centerBonus, 0.85);
    }

    addRandomPatterns(map, spawnAreas) {
        const patternCount = this.random.nextInt(2, 4); // 2-4 random patterns

        for (let i = 0; i < patternCount; i++) {
            const patternType = this.random.nextInt(0, 2);

            switch (patternType) {
                case 0:
                    this.addClearPath(map, spawnAreas);
                    break;
                case 1:
                    this.addBlockCluster(map, spawnAreas);
                    break;
                case 2:
                    this.addClearArea(map, spawnAreas);
                    break;
            }
        }
    }
    addClearPath(map, spawnAreas) {
        const startSpawn = spawnAreas[this.random.nextInt(0, 3)];
        const endSpawn = spawnAreas[this.random.nextInt(0, 3)];

        if (startSpawn === endSpawn) return;

        // Simple path clearing (can be enhanced)
        const dx = Math.sign(endSpawn.x - startSpawn.x);
        const dy = Math.sign(endSpawn.y - startSpawn.y);

        let x = startSpawn.x;
        let y = startSpawn.y;

        while (x !== endSpawn.x || y !== endSpawn.y) {
            if (map[y] && map[y][x] === 2) {
                map[y][x] = 0; // Clear block
            }

            if (x !== endSpawn.x) x += dx;
            if (y !== endSpawn.y) y += dy;
        }
    }
    addBlockCluster(map, spawnAreas) {
        const clusterX = this.random.nextInt(3, this.config.MAP_WIDTH - 4);
        const clusterY = this.random.nextInt(3, this.config.MAP_HEIGHT - 4);

        // Check if cluster area is safe
        const isSafeArea = spawnAreas.some(spawn =>
            Math.abs(spawn.x - clusterX) <= 2 && Math.abs(spawn.y - clusterY) <= 2
        );

        if (isSafeArea) return;

        // Add 2x2 block cluster
        for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
                const x = clusterX + dx;
                const y = clusterY + dy;

                if (map[y] && map[y][x] === 0 && this.random.nextFloat() < 0.8) {
                    map[y][x] = 2;
                }
            }
        }
    }
    addClearArea(map) {
        const areaX = this.random.nextInt(2, this.config.MAP_WIDTH - 3);
        const areaY = this.random.nextInt(2, this.config.MAP_HEIGHT - 3);

        // Clear small area
        for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
                const x = areaX + dx;
                const y = areaY + dy;

                if (map[y] && map[y][x] === 2) {
                    map[y][x] = 0;
                }
            }
        }
    }

    /**
     * Start the high-performance game loop
     * Runs at 60fps for smooth gameplay
     */
    startGameLoop() {
        const gameLoop = (currentTime) => {
            if (this.state !== 'playing') {
                return; // Stop loop if game is not playing
            }

            // Calculate delta time for consistent physics
            const deltaTime = currentTime - this.lastTickTime;

            if (deltaTime >= this.tickInterval) {
                this.updateGame(deltaTime);
                this.lastTickTime = currentTime;
            }

            this.gameLoopId = requestAnimationFrame(gameLoop);
        };

        this.lastTickTime = performance.now();
        this.gameLoopId = requestAnimationFrame(gameLoop);

        this.logger.info(`Game loop started at ${this.tickRate}fps`);
    }

    /**
     * Start broadcasting game timer to all players
     */
    startTimerBroadcast() {
        // Clear any existing timer
        if (this.timerBroadcastInterval) {
            clearInterval(this.timerBroadcastInterval);
        }

        // Broadcast timer every second
        this.timerBroadcastInterval = setInterval(() => {
            if (this.state === 'playing' && this.stats.startTime) {
                const currentTime = Date.now();
                const elapsedTime = currentTime - this.stats.startTime;
                const formattedTime = this.formatTime(elapsedTime);

                this.broadcastToPlayers({
                    type: 'gameTimer',
                    elapsedTime: elapsedTime,
                    formattedTime: formattedTime
                });
            }
        }, this.TIMER_BROADCAST_INTERVAL);

        this.logger.debug('Timer broadcasting started');
    }

    /**
     * Format time in milliseconds to MM:SS format
     * @param {number} milliseconds - Time in milliseconds
     * @returns {string} Formatted time string (e.g., "02:34", "12:05")
     */
    formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        // Format as MM:SS with zero padding
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Update game state each frame
     * Handles entity updates, collision detection, and game logic
     */
    updateGame(deltaTime) {
        if (this.state !== 'playing') {
            return;
        }

        const currentTime = Date.now();

        // Update bombs
        this.updateBombs(deltaTime);

        // Update explosions
        this.updateExplosions(deltaTime);

        // Check for expired power-ups on the map (every 5 seconds)
        if (!this.lastPowerUpCheck || (currentTime - this.lastPowerUpCheck) > 5000) {
            this.checkExpiredPowerUps();
            this.lastPowerUpCheck = currentTime;
        }

        // Update collision detection
        if (this.collisionSystem) {
            const gameState = {
                walls: this.entities.walls,
                blocks: this.entities.blocks,
                bombs: Array.from(this.entities.bombs.values()),
                explosions: Array.from(this.entities.explosions.values()),
                powerUps: Array.from(this.entities.powerUps.values()),
                players: Array.from(this.players.values())
            };

            this.collisionSystem.update(deltaTime, gameState);
        }

        // Update player power-up effects (every 1 second for performance)
        if (!this.lastEffectCheck || (currentTime - this.lastEffectCheck) > 1000) {
            this.updatePlayerPowerUps(currentTime);
            this.lastEffectCheck = currentTime;
        }

        // Check win conditions
        this.checkWinConditions();

        // Broadcast game state
        this.broadcastGameState();
    }





    /**
     * Update player's effective stats - SAFE VERSION
     * Only updates if player has the required properties
     */
    updatePlayerEffectiveStats(player) {
        if (!player || !player.powerUps) {
            return; // Can't update stats without power-up data
        }

        try {
            // Calculate effective stats from power-up counters
            const baseSpeed = this.config.BASE_MOVE_SPEED || 100;
            const speedBonus = (player.powerUps.speed || 0) * 20;

            // Only update if player has these properties
            if (typeof player.moveSpeed !== 'undefined') {
                player.moveSpeed = baseSpeed + speedBonus;
            }

            if (typeof player.maxBombs !== 'undefined') {
                player.maxBombs = 1 + (player.powerUps.bombs || 0);
            }

            if (typeof player.bombRange !== 'undefined') {
                player.bombRange = 1 + (player.powerUps.flames || 0);
            }

            this.logger.debug(`Updated stats for player ${player.id}:`, {
                maxBombs: player.maxBombs,
                bombRange: player.bombRange,
                moveSpeed: player.moveSpeed
            });

        } catch (error) {
            this.logger.error(`Error updating effective stats for player ${player.id}:`, error);
        }
    }

    /**
     * Update bomb entities
     */
    updateBombs(deltaTime) {
        this.entities.bombs.forEach((bomb, bombId) => {
            bomb.timer -= deltaTime;

            if (bomb.timer <= 0) {
                this.explodeBomb(bombId, bomb);
            }
        });
    }

    /**
     * Update explosion entities
     */
    updateExplosions(deltaTime) {
        this.entities.explosions.forEach((explosion, explosionId) => {
            explosion.duration -= deltaTime;

            if (explosion.duration <= 0) {
                this.entities.explosions.delete(explosionId);
            }
        });
    }

    // REMOVED: updatePowerUps() - function was never called, power-up expiration is handled by checkExpiredPowerUps()


    /**
     * Handle bomb explosion
     */
    explodeBomb(bombId, bomb) {
        const explosions = [];
        const range = bomb.range || 1;

        // Create explosion pattern (cross shape)
        const directions = [
            { dx: 0, dy: 0 },   // Center
            { dx: 1, dy: 0 },   // Right
            { dx: -1, dy: 0 },  // Left
            { dx: 0, dy: 1 },   // Down
            { dx: 0, dy: -1 }   // Up
        ];

        directions.forEach(dir => {
            for (let i = 0; i <= range; i++) {
                const x = bomb.tileX + (dir.dx * i);
                const y = bomb.tileY + (dir.dy * i);

                // Check bounds
                if (x < 0 || x >= this.config.MAP_WIDTH ||
                    y < 0 || y >= this.config.MAP_HEIGHT) {
                    break;
                }

                // Check for walls
                if (this.entities.walls.has(`${x},${y}`)) {
                    break;
                }

                // Create explosion
                const explosionId = `explosion_${x}_${y}_${Date.now()}`;
                this.entities.explosions.set(explosionId, {
                    id: explosionId,
                    x: x,
                    y: y,
                    duration: 500, // 0.5 seconds
                    power: bomb.power || 1
                });

                setTimeout(() => {
                    this.entities.explosions.delete(explosionId);
                }, 500);

                explosions.push({ x, y });

                // Check for destructible blocks
                if (this.entities.blocks.has(`${x},${y}`)) {


                    this.entities.blocks.delete(`${x},${y}`);



                    // 40% chance to spawn power-up
                    if (Math.random() < 0.4) {
                        this.spawnPowerUp(x, y);
                    }

                    break; // Stop explosion in this direction
                }
            }
        });

        // Remove the bomb
        this.entities.bombs.delete(bombId);

        // Check for player damage
        this.checkExplosionDamage(explosions);

        this.logger.debug(`Bomb exploded at (${bomb.tileX}, ${bomb.tileY}) with ${explosions.length} explosion tiles`);
    }

    /**
     * Spawn a power-up at the specified location
     */
    spawnPowerUp(x, y) {
        const powerUpTypes = ['bombs', 'flames', 'speed', 'oneup', 'blockPass'];
        const weights = [25, 25, 20, 10, 15];

        // Weighted random selection
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let random = Math.random() * totalWeight;

        let selectedType = 'bombs';
        for (let i = 0; i < powerUpTypes.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                selectedType = powerUpTypes[i];
                break;
            }
        }

        // Consistent coordinate system
        const tileX = Math.floor(x);
        const tileY = Math.floor(y);
        const tileKey = this.getTileKey(tileX, tileY);

        const powerUp = {
            id: `powerup_${tileX}_${tileY}_${Date.now()}`,
            type: selectedType,  // Make sure this is set!
            x: tileX,
            y: tileY,
            tileX: tileX,
            tileY: tileY,
            lifetime: 30000,
            spawnTime: Date.now()
        };


        // Store in entities map
        this.entities.powerUps.set(tileKey, powerUp);


        this.logger.info(`✅ Power-up spawned: ${selectedType} at (${tileX}, ${tileY}) with key: ${tileKey}`);

        // Broadcast to clients
        this.broadcastToPlayers({
            type: 'powerUpSpawned',
            powerUp: powerUp,
            x: tileX,
            y: tileY,
            powerUpType: selectedType
        });
    }

    /**
     * Check for explosion damage to players
     */
    checkExplosionDamage(explosions) {
        this.players.forEach((player, playerId) => {
            if (!player.isAlive) return;

            const playerTileX = Math.floor(player.x / this.config.TILE_SIZE);
            const playerTileY = Math.floor(player.y / this.config.TILE_SIZE);

            // Check if player is in any explosion tile
            const isInExplosion = explosions.some(explosion =>
                explosion.x === playerTileX && explosion.y === playerTileY
            );

            if (isInExplosion) {
                this.damagePlayer(playerId);
            }
        });
    }

    /**
     * Damage a player (reduce lives) - Server authoritative
     */
    damagePlayer(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.isAlive || player.isInvulnerable) {
            return;
        }

        // Apply damage (only 1 heart at a time)
        player.lives--;
        this.logger.info(`Player ${playerId} took damage, lives: ${player.lives}`);

        if (player.lives <= 0) {
            // Player dies - eliminate them
            player.isAlive = false;
            this.stats.playersEliminated++;

            this.logger.info(`Player ${playerId} eliminated`);

            // Broadcast player elimination
            this.broadcastToPlayers({
                type: 'playerEliminated',
                playerId: playerId,
                remainingPlayers: this.getAlivePlayers().length
            });

            // Check win conditions
            this.checkWinConditions();
        } else {
            // Player survives - grant invulnerability
            player.isInvulnerable = true;
            setTimeout(() => {
                if (player.isAlive) {
                    player.isInvulnerable = false;
                }
            }, GAME_CONFIG.INVULNERABILITY_TIME);

            // Broadcast player damage to all clients
            this.broadcastToPlayers({
                type: 'playerDamaged',
                playerId: playerId,
                lives: player.lives,
                isAlive: player.isAlive,
                isInvulnerable: player.isInvulnerable,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Check win conditions
     */
    checkWinConditions() {
        const alivePlayers = this.getAlivePlayers();

        if (alivePlayers.length <= 1) {
            this.endGame(alivePlayers[0] || null);
        }
    }

    /**
     * End the game
     */
    endGame(winner) {
        this.state = 'finished';
        this.stats.endTime = Date.now();
        this.stats.duration = this.stats.endTime - this.stats.startTime;
        this.stats.winner = winner;

        // Stop game loop
        if (this.gameLoopId) {
            cancelAnimationFrame(this.gameLoopId);
            this.gameLoopId = null;
        }

        // Stop timer broadcasting
        if (this.timerBroadcastInterval) {
            clearInterval(this.timerBroadcastInterval);
            this.timerBroadcastInterval = null;
        }

        // Clear all timers
        Object.values(this.timers).forEach(timer => {
            if (timer) clearTimeout(timer);
        });

        this.logger.info(`Game ended. Winner: ${winner?.id || 'None'}, Duration: ${this.stats.duration}ms`);

        // Broadcast game end with formatted time
        this.broadcastToPlayers({
            type: 'gameEnd',
            winner: winner,
            stats: {
                ...this.stats,
                formattedDuration: this.formatTime(this.stats.duration)
            },
            finalScores: this.getFinalScores()
        });

        // Notify server to clean up game and reset player states
        if (this.endGameCallback) {
            this.endGameCallback(this.gameId, 'completed');
        }
    }

    /**
     * Add a player to the game (if room available)
     */
    addPlayer(playerId, playerData) {
        if (this.players.size >= this.maxPlayers) {
            return false; // Room full
        }

        // SIMPLIFIED: Only allow joins during countdown (no 'waiting' state)
        if (this.state !== 'countdown') {
            return false; // Game already started
        }

        // Add the player with proper coordinates
        const spawnPositions = [
            { x: 1, y: 1 }, { x: 13, y: 1 }, { x: 1, y: 11 }, { x: 13, y: 11 }
        ];
        const spawn = spawnPositions[this.players.size] || spawnPositions[0];

        this.players.set(playerId, {
            id: playerId,
            index: this.players.size,
            nickname: playerData.nickname || `Player${playerId}`,
            x: spawn.x * this.config.TILE_SIZE,
            y: spawn.y * this.config.TILE_SIZE,
            tileX: spawn.x,
            tileY: spawn.y,
            lives: this.config.LIVES_PER_PLAYER || 3,
            isAlive: true,
            isReady: false,
            score: 0,
            powerUps: {
                speed: 0,
                bombs: 0,
                range: 0,
                bombPass: false,
                blockPass: false,
                detonator: false
            },
            maxBombs: 1,
            bombRange: 1,
            direction: null,
            isMoving: false,
            joinedAt: Date.now()
        });

        this.logger.info(`✅ Player ${playerId} added during countdown (${this.players.size}/${this.maxPlayers})`);

        // Broadcast updated countdown with new player
        this.broadcastToPlayers({
            type: 'gameCountdown',
            countdown: this.countdownValue,
            players: this.getPlayersData()
        });

        // If we reach max players, start game immediately
        if (this.players.size >= this.maxPlayers) {
            if (this.timers.countdownTimer) {
                clearInterval(this.timers.countdownTimer);
                this.timers.countdownTimer = null;
            }
            this.logger.info('Max players reached - starting game immediately');
            this.startGame();
        }

        return true;
    }

    /**
     * Remove a player from the game
     */
    removePlayer(playerId) {
        console.log("moshi moshi mina san             nhejjejwjwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww")
        if (!this.players.has(playerId)) {
            this.logger.warn(`🚫 REMOVE_PLAYER - Player ${playerId} not found in game ${this.gameId}`);
            return false;
        }


        // Get player data before removal for notification
        const player = this.players.get(playerId);
        const playerNickname = player?.nickname || playerId;

        this.logger.info(`🚪 REMOVE_PLAYER - Game state: ${this.state}, Removing: ${playerNickname} from game ${this.gameId}`);
        this.logger.info(`📊 REMOVE_PLAYER - Players before removal: ${this.players.size}`);

        this.players.delete(playerId);

        this.logger.info(`📊 REMOVE_PLAYER - Players after removal: ${this.players.size}`);

        // Notify other players about the disconnection (only during active gameplay)
        if (this.state === 'playing') {
            this.logger.info(`📢 REMOVE_PLAYER - Broadcasting playerLeft to ${this.players.size} remaining players`);
            // Broadcast player elimination
            this.broadcastToPlayers({
                type: 'playerEliminated',
                playerId: playerId,
                remainingPlayers: this.getAlivePlayers().length
            });

            // Check win conditions after player removal
            this.checkWinConditions();
        } else {
            this.logger.info(`⏸️ REMOVE_PLAYER - Not broadcasting (game state: ${this.state})`);
        }

        // If game is waiting and we now have less than minimum players
        if (this.state === 'waiting' && this.players.size < this.minPlayers) {
            this.logger.warn('Not enough players remaining in waiting state');
            // Could handle this by extending wait time or canceling game
        }

        this.logger.info(`✅ REMOVE_PLAYER - Successfully removed ${playerNickname}`);
        return true;
    }

    /**
     * Handle player movement
     */
    handlePlayerMovement(playerId, direction) {
        const player = this.players.get(playerId);
        if (!player || !player.isAlive || this.state !== 'playing') {
            return;
        }

        // Update collision grid before movement check
        this.updateServerCollisionGrid();

        // Calculate movement speed using power-up
        const baseSpeed = GAME_CONFIG.BASE_MOVE_SPEED || 2; // Default base speed
        const speedBonus = player.powerUps.speed || 0;
        const movementSpeed = baseSpeed + speedBonus;

        // Speed calculation complete

        // Store current position
        const currentX = player.x;
        const currentY = player.y;

        let newX = currentX;
        let newY = currentY;

        switch (direction) {
            case 'up':
                newY = currentY - movementSpeed;
                break;
            case 'down':
                newY = currentY + movementSpeed;
                break;
            case 'left':
                newX = currentX - movementSpeed;
                break;
            case 'right':
                newX = currentX + movementSpeed;
                break;
            default:
                return;
        }

        // Check collision
        const canMove = this.collisionSystem.canMoveTo(currentX, currentY, newX, newY, player);

        // DEBUGGING: Log movement attempts to debug the issue
        console.log(`🎮 Player ${playerId} movement ${direction}: (${currentX}, ${currentY}) -> (${newX}, ${newY}) canMove: ${canMove}`);

        if (canMove) {
            // Update player position
            player.x = newX;
            player.y = newY;
            player.direction = direction;
            player.isMoving = true;

            // Update tile coordinates consistently
            player.tileX = Math.floor(player.x / this.config.TILE_SIZE);
            player.tileY = Math.floor(player.y / this.config.TILE_SIZE);

            console.log(`✅ Player ${playerId} moved to (${newX}, ${newY}) tile (${player.tileX}, ${player.tileY})`);

        } else {
            player.direction = direction;
            player.isMoving = false;

            console.log(`❌ Player ${playerId} movement ${direction} blocked at (${newX}, ${newY})`);
        }
    }


    handlePlayerCollectedPowerUp(data) {
        const { player, powerUp } = data;
        const playerId = player.id;



        // Validation
        if (!player || !player.isAlive || !powerUp) {
            this.logger.warn('❌ COLLISION EVENT - Invalid power-up collection data:', {
                hasPlayer: !!player,
                playerAlive: player?.isAlive,
                hasPowerUp: !!powerUp,
                powerUpType: powerUp?.type
            });
            return;
        }

        // Use consistent key generation
        const tileKey = this.getTileKey(powerUp.x, powerUp.y);

        // Check if power-up still exists (prevent double processing)
        if (!this.entities.powerUps.has(tileKey)) {
            this.logger.warn('❌ COLLISION EVENT - Power-up already collected or missing:', {
                tileKey: tileKey,
                availablePowerUps: Array.from(this.entities.powerUps.keys())
            });
            return;
        }

        // Get the actual power-up from storage
        const storedPowerUp = this.entities.powerUps.get(tileKey);

        // Apply power-up to player (using our fixed method)
        this.applyPowerUpToPlayer(player, storedPowerUp);

        // Remove power-up with proper error handling
        const deleteSuccess = this.entities.powerUps.delete(tileKey);
        if (!deleteSuccess) {
            this.logger.error(`❌ Failed to delete power-up at ${tileKey}`);
            return;
        }

        // Update collision grid after power-up removal
        this.updateServerCollisionGrid();

        this.logger.info(`✅ COLLISION EVENT COMPLETE - Player ${playerId} collected ${storedPowerUp.type} at (${storedPowerUp.x}, ${storedPowerUp.y})`);
    }



    handlePlayerHitByExplosion(data) {
        const { player } = data;

        if (!player || !player.isAlive || player.isInvulnerable) {
            return;
        }

        // Use the centralized damage system instead of duplicating logic
        this.damagePlayer(player.id);
    }

    /**
     * Update server-side collision grid for accurate collision detection
     */
    updateServerCollisionGrid() {
        // Convert GameRoom explosion format to CollisionSystem format
        const explosions = Array.from(this.entities.explosions.values()).map(explosion => ({
            ...explosion,
            tiles: [{ x: explosion.x, y: explosion.y }]
        }));

        // Convert power-ups to proper format for collision system
        const powerUps = Array.from(this.entities.powerUps.entries()).map(([tileKey, powerUp]) => {
            const [x, y] = tileKey.split(',').map(Number);
            return {
                ...powerUp,
                x: x,
                y: y,
                tileX: x,
                tileY: y,
                id: tileKey // Use tileKey as ID for easy removal
            };
        });

        const gameState = {
            walls: this.entities.walls || new Set(),
            blocks: this.entities.blocks || new Set(),
            bombs: Array.from(this.entities.bombs.values()),
            players: Array.from(this.players.values()),
            powerUps: powerUps, //  Use converted power-ups
            explosions: explosions
        };

        // Use existing CollisionSystem.updateCollisionGrid method
        this.collisionSystem.updateCollisionGrid(gameState);
    }


    applyPowerUpToPlayer(player, powerUp) {
        // Validation
        if (!powerUp || !powerUp.type) {
            this.logger.warn('❌ applyPowerUpToPlayer - Invalid power-up:', {
                powerUp: powerUp,
                hasType: !!powerUp?.type
            });
            return;
        }

        // Initialize timers if not present
        this.initializePlayerPowerUpTimers(player);

        this.logger.debug(`🎁 APPLYING POWER-UP - ${powerUp.type} to player ${player.id}`);

        const currentTime = Date.now();

        // Log player state BEFORE
        const beforeStats = {
            bombs: player.powerUps.bombs,
            flames: player.powerUps.flames,
            speed: player.powerUps.speed,
            lives: player.lives,
            maxBombs: player.maxBombs,
            bombRange: player.bombRange
        };

        switch (powerUp.type) {
            case 'speed':
                // Check max level
                if (player.powerUps.speed >= POWER_UP_CONFIG.MAX_LEVELS.SPEED) {
                    this.logger.info(`⚡ SPEED: Player ${player.id} already at max level (${POWER_UP_CONFIG.MAX_LEVELS.SPEED})`);
                    return;
                }

                player.powerUps.speed = Math.min(POWER_UP_CONFIG.MAX_LEVELS.SPEED, player.powerUps.speed + 1);

                // Add timer for this effect
                player._powerUpTimers.speed.push({
                    id: `speed_${currentTime}`,
                    expireTime: currentTime + POWER_UP_CONFIG.EFFECT_DURATIONS.SPEED,
                    appliedAt: currentTime
                });

                this.logger.info(`⚡ SPEED: ${beforeStats.speed} → ${player.powerUps.speed} (expires in ${POWER_UP_CONFIG.EFFECT_DURATIONS.SPEED / 1000}s)`);
                break;

            case 'bombs':
                // Check max level
                if (player.powerUps.bombs >= POWER_UP_CONFIG.MAX_LEVELS.BOMBS) {
                    this.logger.info(`💣 BOMBS: Player ${player.id} already at max level (${POWER_UP_CONFIG.MAX_LEVELS.BOMBS})`);
                    return;
                }

                player.powerUps.bombs = Math.min(POWER_UP_CONFIG.MAX_LEVELS.BOMBS, player.powerUps.bombs + 1);
                player.maxBombs = 1 + player.powerUps.bombs;

                // Add timer for this effect
                player._powerUpTimers.bombs.push({
                    id: `bombs_${currentTime}`,
                    expireTime: currentTime + POWER_UP_CONFIG.EFFECT_DURATIONS.BOMBS,
                    appliedAt: currentTime
                });

                this.logger.info(`💣 BOMBS: ${beforeStats.bombs} → ${player.powerUps.bombs}, maxBombs: ${player.maxBombs} (expires in ${POWER_UP_CONFIG.EFFECT_DURATIONS.BOMBS / 1000}s)`);
                break;

            case 'flames':
            case 'range': // Handle both names for compatibility
                // Check max level
                if (player.powerUps.flames >= POWER_UP_CONFIG.MAX_LEVELS.FLAMES) {
                    this.logger.info(`🔥 FLAMES: Player ${player.id} already at max level (${POWER_UP_CONFIG.MAX_LEVELS.FLAMES})`);
                    return;
                }

                player.powerUps.flames = Math.min(POWER_UP_CONFIG.MAX_LEVELS.FLAMES, player.powerUps.flames + 1);
                player.powerUps.range = player.powerUps.flames; // Keep compatibility
                player.bombRange = 1 + player.powerUps.flames;

                // Add timer for this effect
                player._powerUpTimers.flames.push({
                    id: `flames_${currentTime}`,
                    expireTime: currentTime + POWER_UP_CONFIG.EFFECT_DURATIONS.FLAMES,
                    appliedAt: currentTime
                });

                this.logger.info(`🔥 FLAMES: ${beforeStats.flames} → ${player.powerUps.flames}, bombRange: ${player.bombRange} (expires in ${POWER_UP_CONFIG.EFFECT_DURATIONS.FLAMES / 1000}s)`);
                break;

            case 'oneup':
            case 'oneUp':
                // Check max lives limit (4 total)
                if (player.lives >= POWER_UP_CONFIG.MAX_LEVELS.LIVES) {
                    this.logger.info(`❤️ LIFE: Player ${player.id} already at max lives (${POWER_UP_CONFIG.MAX_LEVELS.LIVES})`);
                    return;
                }

                player.lives = Math.min(POWER_UP_CONFIG.MAX_LEVELS.LIVES, player.lives + 1);
                // No timer needed for lives (permanent)

                this.logger.info(`❤️ LIFE: ${beforeStats.lives} → ${player.lives}`);
                break;

            case 'blockPass':
            case 'BLOCK_PASS':
                // Block Pass is a temporary ability
                player.powerUps.blockPass = true;

                // Add timer for this effect
                player._powerUpTimers.blockPass = player._powerUpTimers.blockPass || [];
                player._powerUpTimers.blockPass.push({
                    id: `blockPass_${currentTime}`,
                    expireTime: currentTime + POWER_UP_CONFIG.EFFECT_DURATIONS.BLOCK_PASS,
                    appliedAt: currentTime
                });

                this.logger.info(`👻 BLOCK PASS: Activated for ${POWER_UP_CONFIG.EFFECT_DURATIONS.BLOCK_PASS / 1000}s - can pass through blocks!`);
                break;

            default:
                this.logger.warn(`❓ Unknown power-up type: ${powerUp.type}`);
                return;
        }

        player.score += 100;

        // Broadcast power-up collection with timer info
        this.broadcastToPlayers({
            type: 'powerUpCollected',
            playerId: player.id,
            powerUpType: powerUp.type,
            playerStats: {
                bombs: player.powerUps.bombs,
                flames: player.powerUps.flames,
                speed: player.powerUps.speed,
                range: player.powerUps.flames
            },
            newLives: player.lives,
            maxBombs: player.maxBombs,
            bombRange: player.bombRange,
            effectDuration: POWER_UP_CONFIG.EFFECT_DURATIONS[powerUp.type.toUpperCase()],
            maxLevel: POWER_UP_CONFIG.MAX_LEVELS[powerUp.type.toUpperCase()],
            timestamp: currentTime
        });

        this.logger.info(`✅ Power-up applied: ${powerUp.type} to player ${player.id}`);
    }





    /**
     * Handle bomb placement
     */
    handleBombPlacement(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.isAlive || this.state !== 'playing') {
            return;
        }

        // Check if player can place more bombs
        const currentBombs = Array.from(this.entities.bombs.values())
            .filter(bomb => bomb.playerId === playerId).length;

        if (currentBombs >= player.maxBombs) {
            this.logger.debug(`Player ${playerId} cannot place bomb: ${currentBombs}/${player.maxBombs} bombs already placed`);
            return;
        }

        const tileX = Math.floor(player.x / this.config.TILE_SIZE);
        const tileY = Math.floor(player.y / this.config.TILE_SIZE);

        // Check if there's already a bomb at this position
        const existingBomb = Array.from(this.entities.bombs.values())
            .find(bomb => bomb.tileX === tileX && bomb.tileY === tileY);

        if (existingBomb) {
            return;
        }

        // Create bomb with player's current range
        const bombId = `bomb_${playerId}_${Date.now()}`;
        const currentTime = Date.now();

        this.entities.bombs.set(bombId, {
            id: bombId,
            playerId: playerId,
            x: tileX,
            y: tileY,
            tileX: tileX,
            tileY: tileY,
            timer: this.config.BOMB_TIMER || 3000,
            range: player.bombRange, // Use player's current range
            power: 1,
            createTime: currentTime,
            placedTime: currentTime
        });

        this.logger.info(`✅ Player ${playerId} placed bomb at (${tileX}, ${tileY}) with range ${player.bombRange}`);
    }



    /**
  * Update player power-up timers and handle expiration
  * Reduces power-up levels by 1 when they expire
  */
    updatePlayerPowerUps(currentTime) {
        if (!this.players || this.players.size === 0) {
            return;
        }

        this.players.forEach((player, playerId) => {
            try {
                // Initialize timers if not present (for existing players)
                this.initializePlayerPowerUpTimers(player);

                let statsChanged = false;

                // Check each type of timed effect
                ['speed', 'bombs', 'flames', 'blockPass'].forEach(effectType => {
                    // DEFENSIVE: Check if the timer array exists
                    if (!player._powerUpTimers[effectType] || !Array.isArray(player._powerUpTimers[effectType])) {
                        return; // Skip this effect type
                    }

                    const timers = player._powerUpTimers[effectType];
                    let expiredCount = 0;

                    // Remove expired timers and count them
                    for (let i = timers.length - 1; i >= 0; i--) {
                        const timer = timers[i];
                        if (currentTime >= timer.expireTime) {
                            timers.splice(i, 1);
                            expiredCount++;

                            this.logger.debug(`⏰ Timer expired: ${timer.id} for player ${playerId}`);
                        }
                    }

                    // Reduce power-up level by the number of expired timers
                    if (expiredCount > 0) {
                        const oldLevel = player.powerUps[effectType];
                        player.powerUps[effectType] = Math.max(0, player.powerUps[effectType] - expiredCount);

                        // Update derived stats
                        switch (effectType) {
                            case 'bombs':
                                player.maxBombs = 1 + player.powerUps.bombs;
                                break;
                            case 'flames':
                                player.powerUps.range = player.powerUps.flames; // Keep compatibility
                                player.bombRange = 1 + player.powerUps.flames;
                                break;
                            case 'speed':
                                // Speed changes would be handled in movement calculation
                                break;
                            case 'blockPass':
                                // When Block Pass expires, disable the ability
                                player.powerUps.blockPass = false;
                                break;
                        }

                        statsChanged = true;

                        this.logger.info(`📉 POWER-UP EXPIRED: ${effectType} for player ${playerId}: ${oldLevel} → ${player.powerUps[effectType]} (-${expiredCount})`);

                        // Broadcast expiration to clients
                        this.broadcastToPlayers({
                            type: 'powerUpExpired',
                            playerId: playerId,
                            effectType: effectType,
                            oldLevel: oldLevel,
                            newLevel: player.powerUps[effectType],
                            expiredCount: expiredCount,
                            timestamp: currentTime
                        });
                    }
                });

                // Broadcast updated stats if any changes occurred
                if (statsChanged) {
                    this.broadcastToPlayers({
                        type: 'playerStatsUpdated',
                        playerId: playerId,
                        playerStats: {
                            bombs: player.powerUps.bombs,
                            flames: player.powerUps.flames,
                            speed: player.powerUps.speed,
                            range: player.powerUps.flames
                        },
                        maxBombs: player.maxBombs,
                        bombRange: player.bombRange,
                        timestamp: currentTime
                    });
                }

            } catch (error) {
                this.logger.error(`Error updating power-ups for player ${playerId}:`, error);
            }
        });
    }

    /**
 * Check for expired power-ups on the map and remove them
 */
    checkExpiredPowerUps() {
        const currentTime = Date.now();
        const expiredPowerUps = [];

        // Find expired power-ups
        this.entities.powerUps.forEach((powerUp, tileKey) => {
            if (powerUp.spawnTime && (currentTime - powerUp.spawnTime) > POWER_UP_CONFIG.DESPAWN_TIME) {
                expiredPowerUps.push({ tileKey, powerUp });
            }
        });

        // Remove expired power-ups
        expiredPowerUps.forEach(({ tileKey, powerUp }) => {
            this.entities.powerUps.delete(tileKey);

            // Broadcast timeout to all clients
            this.broadcastToPlayers({
                type: 'powerUpMapExpired',
                powerUpId: powerUp.id,
                x: powerUp.x,
                y: powerUp.y,
                tileKey: tileKey,
                reason: 'spawn_timeout',
                despawnTime: POWER_UP_CONFIG.DESPAWN_TIME / 1000,
                timestamp: currentTime
            });

            this.logger.debug(`⏰ Power-up spawn expired: ${powerUp.type} at (${powerUp.x}, ${powerUp.y}) after ${POWER_UP_CONFIG.DESPAWN_TIME / 1000}s`);
        });

        // Update collision grid if any power-ups expired
        if (expiredPowerUps.length > 0) {
            this.updateServerCollisionGrid();
        }

        return expiredPowerUps.length;
    }

    /**
     * Utility methods
     */
    getAlivePlayers() {
        return Array.from(this.players.values()).filter(player => player.isAlive);
    }

    getTileKey(x, y) {
        return `${Math.floor(x)},${Math.floor(y)}`;
    }

    getPlayersData() {

        const playersArray = Array.from(this.players.values());


        return playersArray;
    }

    getFinalScores() {
        return Array.from(this.players.values())
            .sort((a, b) => b.score - a.score)
            .map(player => ({
                id: player.id,
                nickname: player.nickname,
                score: player.score,
                isAlive: player.isAlive,
                lives: player.lives
            }));
    }

    serializeMap() {
        return {
            walls: Array.from(this.entities.walls),
            blocks: Array.from(this.entities.blocks),
            width: this.config.MAP_WIDTH,
            height: this.config.MAP_HEIGHT
        };
    }

    /**
     * Broadcast message to all players in the room
     */
    broadcastToPlayers(message) {
        // This method should be implemented by the server
        // that manages this GameRoom instance
        if (this.onBroadcast) {
            this.onBroadcast(message);
        }
    }

    /**
     * Broadcast optimized game state
     */
    broadcastGameState() {
        const gameState = {
            type: 'gameState',
            players: this.getPlayersData(),
            bombs: Array.from(this.entities.bombs.values()),
            explosions: Array.from(this.entities.explosions.values()),
            powerUps: Array.from(this.entities.powerUps.values()),
            blocks: Array.from(this.entities.blocks),
            walls: Array.from(this.entities.walls),
            timestamp: Date.now()
        };

        // Include bombs and explosions in hash to detect all changes
        const currentHash = gameState.players
            .map(p => `${p.id}:${p.x},${p.y}`)
            .sort()
            .join('|') +
            `|bombs:${gameState.bombs.length}` +
            `|explosions:${gameState.explosions.length}` +
            `|blocks:${gameState.blocks.length}`;

        if (this.lastBroadcastHash !== currentHash) {
            this.broadcastToPlayers(gameState);
            this.lastBroadcastHash = currentHash;
        }
    }

    /**
     * Set broadcast callback
     */
    setBroadcastCallback(callback) {

        this.onBroadcast = callback;
    }

    /**
     * Set end game callback for notifying server when game ends
     */
    setEndGameCallback(callback) {
        this.endGameCallback = callback;
    }

    /**
     * Cleanup and destroy the game room
     */
    destroy() {
        // Clear countdown timer (no waiting timer to clear)
        if (this.timers.countdownTimer) {
            clearInterval(this.timers.countdownTimer);
            this.timers.countdownTimer = null;
        }

        if (this.timers.gameTimer) {
            clearTimeout(this.timers.gameTimer);
            this.timers.gameTimer = null;
        }

        // Stop timer broadcasting
        if (this.timerBroadcastInterval) {
            clearInterval(this.timerBroadcastInterval);
            this.timerBroadcastInterval = null;
        }

        // Stop game loop
        if (this.gameLoopId) {
            cancelAnimationFrame(this.gameLoopId);
        }

        // Clear all data
        this.players.clear();
        this.entities.bombs.clear();
        this.entities.explosions.clear();
        this.entities.powerUps.clear();
        this.entities.walls.clear();
        this.entities.blocks.clear();

        this.logger.info(`Game room ${this.gameId} destroyed`);
    }
}
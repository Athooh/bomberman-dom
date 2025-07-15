// src/core/StateManager.js
// Centralized state management for the game

import { GAME_STATES, EVENT_TYPES ,GAME_CONFIG} from '../utils/Constants.js';
import { Logger } from '../utils/Logger.js';
// REMOVED: unused import objectPool
import { Player } from '../entities/Player.js';
import { Bomb } from '../entities/Bomb.js';

/**
 * State Manager
 * Manages all game state and provides a single source of truth
 * This helps prevent the player disappearing issue by ensuring
 * all systems use the same state reference
 * 
 * FIXES APPLIED:
 * - Removed process.env.NODE_ENV (browser compatibility)
 * - Fixed data structure formats (arrays vs objects)
 * - Added proper error handling for data consistency
 */
export class StateManager {
    constructor() {
        this.logger = new Logger('StateManager');
        
        // Game state
        this.gameState = GAME_STATES.NICKNAME;
        this.gameId = null;
        this.playerId = null;
        this.isConnected = false;
        
        // UI state
        this.nickname = '';
        this.queueSize = 0;
        this.waitingPlayers = [];
        this.countdown = 0;
        this.chatMessages = [];
        this.currentChatMessage = '';
        this.gameResults = null;
        this.errorMessage = null;
        
        // Game entities (using Maps for better performance)
        this.players = new Map();
        this.bombs = new Map();
        this.explosions = new Map();
        this.powerUps = new Map();
        
        //  Map data - ensure these remain Sets
        this.walls = new Set();
        this.blocks = new Set();
        
        // PERFORMANCE: Cache for converted Sets to avoid repeated conversions
        this._conversionCache = new Map();
        this._cacheMaxSize = 10;

        // Incremental cleanup system
        this.incrementalCleanup = {
            enabled: true,
            cleanupIndex: 0,
            itemsPerFrame: 5,
            lastCleanupTime: Date.now(),
            cleanupInterval: 100 // ms between cleanup cycles
        };

        // Entity recycling system
        this.entityRecycling = {
            enabled: true,
            recycledBombs: [],
            recycledExplosions: [],
            maxRecycledItems: 20
        };

        // Change tracking for incremental updates
        this.changeTracking = {
            enabled: true,
            modifiedEntities: new Set(),
            lastChangeTime: Date.now(),
            batchSize: 10
        };

        // Performance tracking
        this.fps = 60;
        this.frameTime = 16.67;
        this.networkLatency = 0;

        // Event listeners
        this.listeners = new Map();
        
   
        
        // PHASE 1: Object Pools for memory optimization
        this.objectPools = {
            bombs: [],
            explosions: [],
            maxPoolSize: 20
        };
        
        // Cleanup tracking
        this.cleanupTimers = new Set();
        this.lastCleanupTime = 0;
        this.cleanupInterval = 5000; // 5 seconds
        
        // Development mode detection
        this.isDevelopmentMode = this.detectDevelopmentMode();
        
        this.logger.info('State manager initialized with optimized map data handling');
    }
    
    
    /**
     * Browser-compatible development mode detection
     * Replaces the problematic process.env.NODE_ENV check
     */
    detectDevelopmentMode() {
        try {
            // Check for common development indicators
            return (
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1' ||
                window.location.port !== '' ||
                window.location.protocol === 'file:' ||
                (window.location.search && window.location.search.includes('debug=true'))
            );
        } catch (error) {
            // If any error occurs, assume production mode
            return false;
        }
    }
    
    /**
     *  Update state manager with time-based logic
     * This method is called by GameEngine every frame to handle:
     * - Entity lifecycle management
     * - Cleanup expired entities
     * - Update timers and countdowns
     * - Validate state consistency
     * 
     * BROWSER COMPATIBILITY: Removed Node.js process.env dependency
     * 
     * @param {number} deltaTime - Time elapsed since last update (milliseconds)
     */
    update(deltaTime) {
        try {
            const currentTime = Date.now();
            
            // Update countdown timer
            this.updateCountdown(deltaTime);
            
            // Update time-sensitive entities
            this.updateTimeSensitiveEntities(currentTime);
            
            // PERFORMANCE: Optimized periodic cleanup
            if (currentTime - this.lastCleanupTime > this.cleanupInterval) {
                this.performPeriodicCleanup(currentTime);
                this.lastCleanupTime = currentTime;
            }
            
            // Update performance metrics
            this.updateInternalMetrics(deltaTime);
            
            // Validate state consistency (in development mode only)
            if (this.isDevelopmentMode) {
                this.validateStateConsistency();
            }
            
        } catch (error) {
            this.logger.error('Error in StateManager.update:', error);
        }
    }
    
    /**
     * Update countdown timer (used in lobby and game start)
     * @param {number} deltaTime - Time elapsed in milliseconds
     */
    updateCountdown(deltaTime) {
        if (this.countdown > 0) {
            this.countdown = Math.max(0, this.countdown - deltaTime / 1000);
            
            // Emit countdown update event
            if (this.countdown <= 0) {
                this.emit(EVENT_TYPES.COUNTDOWN_FINISHED);
            }
        }
    }

    updateCurrentChatMessage(message) {
        try {
            // Validate input
            if (typeof message !== 'string') {
                this.logger.warn('Invalid chat message type, expected string');
                return;
            }
            
            // Update state
            this.currentChatMessage = message;
            
            // Emit state change event
            this.emit(EVENT_TYPES.STATE_CHANGED, {
                currentChatMessage: this.currentChatMessage
            });
            
            this.logger.debug('Current chat message updated:', message);
            
        } catch (error) {
            this.logger.error('Error updating current chat message:', error);
        }
    }

    /**
     * ENHANCED: Add chat message with proper validation and limits
     * Maintains chat history with performance optimizations
     */
    addChatMessage(messageData) {
        try {
            // Validate message data
            if (!messageData || typeof messageData !== 'object') {
                this.logger.warn('Invalid chat message data');
                return;
            }
            
            const { playerId, nickname, message, timestamp } = messageData;
            
            // Validate required fields
            if (!playerId || !nickname || !message) {
                this.logger.warn('Missing required chat message fields');
                return;
            }
            
            // Create validated message object
            const validatedMessage = {
                playerId: String(playerId),
                nickname: String(nickname).trim(),
                message: String(message).trim(),
                timestamp: timestamp || Date.now(),
                isLocal: messageData.isLocal || false
            };
            
            // Validate message length
            if (validatedMessage.message.length === 0) {
                this.logger.warn('Cannot add empty chat message');
                return;
            }
            
            if (validatedMessage.message.length > 200) {
                this.logger.warn('Chat message too long, truncating');
                validatedMessage.message = validatedMessage.message.substring(0, 200);
            }
            
            // Add to chat messages
            this.chatMessages.push(validatedMessage);
            
            // Maintain chat history limit (keep last 100 messages)
            if (this.chatMessages.length > 100) {
                this.chatMessages = this.chatMessages.slice(-100);
            }
            
            // Emit state change event
            this.emit(EVENT_TYPES.STATE_CHANGED, {
                chatMessages: [...this.chatMessages]
            });
            
            this.logger.debug('Chat message added:', validatedMessage);
            
        } catch (error) {
            this.logger.error('Error adding chat message:', error);
        }
    }

        /**
     * NEW: Clear chat input state
     * Centralized method for clearing current chat message
     */
    clearChatInput() {
        try {
            this.currentChatMessage = '';
            
            // Emit state change event
            this.emit(EVENT_TYPES.STATE_CHANGED, {
                currentChatMessage: ''
            });
            
            this.logger.debug('Chat input cleared');
            
        } catch (error) {
            this.logger.error('Error clearing chat input:', error);
        }
    }

    /**
     * NEW: Get chat messages with optional filtering
     * @param {number} limit - Maximum number of messages to return
     * @param {string} playerId - Filter by specific player (optional)
     * @returns {Array} Filtered chat messages
     */
    getChatMessages(limit = 50, playerId = null) {
        try {
            let messages = [...this.chatMessages];
            
            // Filter by player if specified
            if (playerId) {
                messages = messages.filter(msg => msg.playerId === playerId);
            }
            
            // Apply limit
            if (limit > 0) {
                messages = messages.slice(-limit);
            }
            
            return messages;
            
        } catch (error) {
            this.logger.error('Error getting chat messages:', error);
            return [];
        }
    }

    
    /**
     * Update entities that have time-based behaviors
     * @param {number} currentTime - Current timestamp
     */
    updateTimeSensitiveEntities(currentTime) {
        // Update bombs (handle timers, tick down to explosion)
        this.bombs.forEach((bomb, bombId) => {
            if (bomb.updateTime) {
                bomb.updateTime(currentTime);
                
                // Check if bomb should explode
                if (bomb.shouldExplode && bomb.shouldExplode()) {
                    this.emit(EVENT_TYPES.BOMB_EXPLODED, { bombId, bomb });
                }
            }
        });
        
        // Update explosions (handle duration and fading)
        this.explosions.forEach((explosion) => {
            if (explosion.updateTime) {
                explosion.updateTime(currentTime);
            }
        });
        
        // Update power-ups (handle expiration)
        this.powerUps.forEach((powerUp, powerUpId) => {
            if (powerUp.expireTime && currentTime > powerUp.expireTime) {
                this.removePowerUp(powerUpId);
                this.logger.debug('Power-up expired and removed:', powerUpId);
            }
        });
        
        // Update players (handle status effects, timers)
        this.players.forEach((player) => {
            if (player.update && typeof player.update === 'function') {
                player.update(currentTime);
            }
        });
    }
    
    /**
     * Perform cleanup operations (optimized to run periodically, not every frame)
     * @param {number} currentTime - Current timestamp
     */
    performPeriodicCleanup(currentTime) {
        let cleanupCount = 0;

        // Clean up expired explosions
        this.explosions.forEach((explosion, explosionId) => {
            if (explosion.isExpired && explosion.isExpired(currentTime)) {
                this.removeExplosion(explosionId);
                cleanupCount++;
            }
        });

        // Clean up old chat messages (keep only last 50)
        if (this.chatMessages.length > 50) {
            this.chatMessages = this.chatMessages.slice(-50);
            cleanupCount++;
        }

        // Incremental cleanup to prevent frame drops
        this.performIncrementalCleanup(currentTime);

        // Log cleanup if items were removed (for debugging)
        if (cleanupCount > 0) {
            this.logger.debug(`Cleanup completed: ${cleanupCount} items removed`);
        }
    }

    /**
     * Incremental cleanup to prevent GC pressure
     */
    performIncrementalCleanup(currentTime) {
        if (!this.incrementalCleanup.enabled) return;

        // Only run cleanup at intervals
        if (currentTime - this.incrementalCleanup.lastCleanupTime < this.incrementalCleanup.cleanupInterval) {
            return;
        }

        const itemsToClean = this.incrementalCleanup.itemsPerFrame;
        let cleanedItems = 0;

        // Clean up conversion cache
        if (this._conversionCache.size > this._cacheMaxSize) {
            const entries = Array.from(this._conversionCache.entries());
            const startIndex = this.incrementalCleanup.cleanupIndex % entries.length;

            for (let i = 0; i < itemsToClean && cleanedItems < itemsToClean; i++) {
                const index = (startIndex + i) % entries.length;
                if (entries[index]) {
                    this._conversionCache.delete(entries[index][0]);
                    cleanedItems++;
                }
            }

            this.incrementalCleanup.cleanupIndex += itemsToClean;
        }

        // Clean up object pools if they're getting too large
        Object.values(this.entityRecycling).forEach(pool => {
            if (Array.isArray(pool) && pool.length > this.entityRecycling.maxRecycledItems) {
                const excess = pool.length - this.entityRecycling.maxRecycledItems;
                pool.splice(0, Math.min(excess, itemsToClean));
                cleanedItems += Math.min(excess, itemsToClean);
            }
        });

        this.incrementalCleanup.lastCleanupTime = currentTime;

        if (cleanedItems > 0) {
            this.logger.debug(`Incremental cleanup: ${cleanedItems} items processed`);
        }
    }

    // REMOVED: recycleBomb() - function was never called

    // REMOVED: recycleExplosion() - function was never called

    // REMOVED: getRecycledBomb() - function was never called

    // REMOVED: getRecycledExplosion() - function was never called
    
    /**
     * Update internal performance and timing metrics
     * @param {number} deltaTime - Time elapsed since last update
     */
    updateInternalMetrics(deltaTime) {
        // Calculate actual FPS from deltaTime
        if (deltaTime > 0) {
            const currentFPS = 1000 / deltaTime;
            
            // Smooth FPS calculation (exponential moving average)
            this.fps = this.fps * 0.9 + currentFPS * 0.1;
            this.frameTime = deltaTime;
        }
    }
    
    
    /**
     * Validate state consistency with Set type checking
     */
    validateStateConsistency() {
        try {
            // Check Set types
            if (!(this.walls instanceof Set)) {
                this.logger.warn('Walls is not a Set, recreating:', typeof this.walls);
                this.walls = new Set(Array.isArray(this.walls) ? this.walls : []);
            }
            
            if (!(this.blocks instanceof Set)) {
                this.logger.warn('Blocks is not a Set, recreating:', typeof this.blocks);
                this.blocks = new Set(Array.isArray(this.blocks) ? this.blocks : []);
            }
            
            // Validate entity Maps
            if (!(this.players instanceof Map)) {
                this.logger.warn('Players is not a Map, converting...');
                const playersObj = this.players;
                this.players = new Map();
                Object.entries(playersObj).forEach(([id, player]) => {
                    this.players.set(id, player);
                });
            }
            
            // Validate data structure formats
            this.validateDataStructures();
            
        } catch (error) {
            this.logger.warn('State validation error:', error);
        }
    }
    
    
    /**
     * Validate that data structures match expected formats
     * Helps prevent issues like bombs.forEach errors
     */
    validateDataStructures() {
        const state = this.getCurrentState();
        
        // Validate arrays
        const arrayFields = ['bombs', 'explosions', 'powerUps', 'walls', 'blocks'];
        arrayFields.forEach(field => {
            if (state[field] && !Array.isArray(state[field])) {
                this.logger.warn(`${field} should be an array but is:`, typeof state[field]);
            }
        });
        
        // Validate objects
        if (state.players && typeof state.players !== 'object') {
            this.logger.warn('players should be an object but is:', typeof state.players);
        }
    }
    
    /**
     * Update performance metrics (called by GameEngine)
     * @param {number} fps - Current FPS
     * @param {number} frameTime - Current frame time
     * @param {number} networkLatency - Network latency
     */
    updatePerformance(fps, frameTime, networkLatency) {
        this.fps = fps || this.fps;
        this.frameTime = frameTime || this.frameTime;
        this.networkLatency = networkLatency || this.networkLatency;
    }
    
    /**
     * Get current complete state
     *  Proper data structure formats for RenderSystem compatibility
     */
    
/**
 * ENHANCED: Get current complete state with proper chat data
 * Ensures chat-related state is always included and properly formatted
 */
getCurrentState() {
    try {
        // DEFENSIVE: Ensure waitingPlayers is always valid before accessing
        this._ensureWaitingPlayersArray();

        return {
            // Game state
            gameState: this.gameState,
            gameId: this.gameId,
            playerId: this.playerId,
            isConnected: this.isConnected,

            // UI state
            nickname: this.nickname,
            queueSize: this.queueSize,
            waitingPlayers: [...this.waitingPlayers],
            countdown: this.countdown,
            gameResults: this.gameResults,
            errorMessage: this.errorMessage,
            
            // ENHANCED: Chat state with proper validation
            chatMessages: this.getChatMessages(50), // Get last 50 messages
            currentChatMessage: this.currentChatMessage || '', // Ensure never undefined
            
            // Game entities - Proper data structures
            players: this.getPlayersData(),
            bombs: this.getBombsData(),
            explosions: this.getExplosionsData(),
            powerUps: this.getPowerUpsData(),
            
            // Map data - Always return Arrays for serialization
            walls: Array.from(this.walls),
            blocks: Array.from(this.blocks),
            
            // Performance data
            fps: this.fps,
            frameTime: this.frameTime,
            networkLatency: this.networkLatency,
            
            // Debug info
            showDebugInfo: this.showDebugInfo || false
        };
        
    } catch (error) {
        this.logger.error('Error getting current state:', error);
        
        // Return safe fallback state
        return {
            gameState: GAME_STATES.ERROR,
            errorMessage: 'State retrieval error',
            chatMessages: [],
            currentChatMessage: '',
            players: {},
            bombs: [],
            explosions: [],
            powerUps: [],
            walls: [],
            blocks: [],
            isConnected: false
        };
    }
}
    
    /**
     * Update state with new data
     */
    updateState(updates) {
        
        // State update processing
        let hasChanges = false;
        
        
        // PERFORMANCE: Batch Set operations
        const setOperations = [];
        
        //  Handle walls and blocks specially to preserve Set types
        if (updates.walls !== undefined) {
            const newWalls = this._convertToSetOptimized(updates.walls, 'walls');
            if (!this._setsEqual(this.walls, newWalls)) {
                setOperations.push(() => {
                    this.walls = newWalls;
                });
                hasChanges = true;
            }
            // Remove from updates to prevent overwriting
            delete updates.walls;
        }
        
        if (updates.blocks !== undefined) {
            const newBlocks = this._convertToSetOptimized(updates.blocks, 'blocks');
            if (!this._setsEqual(this.blocks, newBlocks)) {
                setOperations.push(() => {
                    this.blocks = newBlocks;
                });
                hasChanges = true;
            }
            // Remove from updates to prevent overwriting
            delete updates.blocks;
        }
        
        // Handle players specially to maintain Map structure
        if (updates.players) {
            if (typeof updates.players === 'object' && !(updates.players instanceof Map)) {
                // Convert Object back to Map efficiently
                const playerUpdates = Object.entries(updates.players);
                
                // PERFORMANCE: Batch player updates
                playerUpdates.forEach(([playerId, playerData]) => {
                    const existingPlayer = this.players.get(playerId);
                    if (existingPlayer) {
                        // Update existing player
                        existingPlayer.updateFromNetwork(playerData);
                    } else {
                        // Add new player
                        this.addPlayer(playerData);
                    }
                });
                hasChanges = true;
            }
            // Remove from updates to prevent overwriting
            delete updates.players;
        }
        
        // PERFORMANCE: Execute Set operations in batch
        setOperations.forEach(operation => operation());

        // Update other properties with validation
        Object.keys(updates).forEach(key => {
            if (this.hasOwnProperty(key) && this[key] !== updates[key]) {
                //  Validate waitingPlayers to ensure it's always an array
                if (key === 'waitingPlayers') {
                    if (Array.isArray(updates[key])) {
                        this[key] = updates[key];
                        hasChanges = true;
                    } else {
                        this.logger.warn('Invalid waitingPlayers data type, keeping existing array:', typeof updates[key]);
                        // Keep existing array, don't update
                    }
                } else {
                    this[key] = updates[key];
                    hasChanges = true;
                }
            }
        });
        
        if (hasChanges) {
            const newState = this.getCurrentState();
            this.emit(EVENT_TYPES.STATE_CHANGED, newState);
            this.logger.debug('State updated with Set preservation', Object.keys(updates));
        }
    }
    
    /**
     * PERFORMANCE: Convert to Set with caching optimization
     */
    _convertToSetOptimized(data, cacheKey) {
        if (data instanceof Set) {
            return data; // Already a Set
        }
        
        if (Array.isArray(data)) {
            // PERFORMANCE: Use cache for frequently converted arrays
            const arrayKey = `${cacheKey}_${data.length}_${data[0]}_${data[data.length-1]}`;
            
            if (this._conversionCache.has(arrayKey)) {
                return this._conversionCache.get(arrayKey);
            }
            
            const newSet = new Set(data);
            
            // PERFORMANCE: Manage cache size
            if (this._conversionCache.size >= this._cacheMaxSize) {
                const firstKey = this._conversionCache.keys().next().value;
                this._conversionCache.delete(firstKey);
            }
            
            this._conversionCache.set(arrayKey, newSet);
            return newSet;
        }
        
        // Fallback to empty Set
        this.logger.warn('Invalid data type for Set conversion:', typeof data);
        return new Set();
    }
    
    /**
     * PERFORMANCE: Fast Set equality check
     */
    _setsEqual(set1, set2) {
        if (set1.size !== set2.size) return false;

        // PERFORMANCE: Early exit for same reference
        if (set1 === set2) return true;

        // PERFORMANCE: Use Set.has() for O(1) lookup
        for (const item of set1) {
            if (!set2.has(item)) return false;
        }
        return true;
    }

    /**
     * DEFENSIVE: Ensure waitingPlayers is always a valid array
     */
    _ensureWaitingPlayersArray() {
        if (!Array.isArray(this.waitingPlayers)) {
            this.logger.warn('waitingPlayers is not an array, reinitializing:', {
                currentType: typeof this.waitingPlayers,
                value: this.waitingPlayers
            });
            this.waitingPlayers = [];
        }
    }
    
    
    /**
     * Get all game entities
     */
    getEntities() {
        return {
            players: this.players,
            bombs: this.bombs,
            explosions: this.explosions,
            powerUps: this.powerUps
        };
    }
    
    // Player management
    
    /**
     * Add player to state
     */
    addPlayer(player) {
        if (!player || !player.id) {
            this.logger.error('Invalid player data provided to addPlayer');
            return null;
        }
        
        // Create Player instance if not already one
        const playerInstance = player instanceof Player ? 
        player : 
        new Player(player.id, player); 
        
        this.players.set(player.id, playerInstance);
        this.logger.debug('Player added to state', player.id);
        
        this.emit(EVENT_TYPES.PLAYER_ADDED, playerInstance);
        return playerInstance;
    }
    
    /**
     * Remove player from state
     */
    removePlayer(playerId) {
        if (this.players.has(playerId)) {
            const player = this.players.get(playerId);
            this.players.delete(playerId);
            this.logger.debug('Player removed from state', playerId);
            this.emit(EVENT_TYPES.PLAYER_REMOVED, player);
            return player;
        }
        return null;
    }
    
    /**
     * Get player by ID
     */
    getPlayer(playerId) {
        // Ensure players is always a Map
        if (!(this.players instanceof Map)) {
            this.logger.error('Players is not a Map, converting...');
            const playersObj = this.players;
            this.players = new Map();
            Object.entries(playersObj).forEach(([id, player]) => {
                this.players.set(id, player);
            });
        }
        
        return this.players.get(playerId);
    }
    
    /**
     * Get all players
     */
    getPlayers() {
        return Array.from(this.players.values());
    }
    
    /**
     * Get players data for serialization
     * Returns OBJECT (RenderSystem expects Object.values(players))
     */
    getPlayersData() {
        // Ensure players is a Map
        if (!(this.players instanceof Map)) {
            this.logger.warn('Players is not a Map, fixing...');
            const playersObj = this.players;
            this.players = new Map();
            Object.entries(playersObj).forEach(([id, player]) => {
                this.players.set(id, player);
            });
        }
        
        // Convert Map to Object for serialization
        const playersData = {};
        this.players.forEach((player, id) => {
            playersData[id] = player.serialize ? player.serialize() : player;
        });
        return playersData;
    }
    
    // Bomb management
    
    /**
     * Add bomb to state
     */
    addBomb(bombData) {
        let bomb;
        
        // Try to get from pool first
        if (this.objectPools.bombs.length > 0) {
            bomb = this.objectPools.bombs.pop();
            bomb.reinitialize(bombData.id, bombData);
            this.logger.debug(`Reused bomb from pool: ${bomb.id}`);
        } else {
            bomb = new Bomb(bombData.id, bombData);
            this.logger.debug(`Created new bomb: ${bomb.id}`);
        }
        
        this.bombs.set(bomb.id, bomb);
        this.logger.debug(`Added bomb ${bomb.id} at (${bomb.tileX}, ${bomb.tileY})`);
        
        return bomb;
    }
    
    /**
     * Remove bomb from state
     */
    removeBomb(bombId) {
        const bomb = this.bombs.get(bombId);
        if (!bomb) return false;
        
        this.bombs.delete(bombId);
        
        // Return to pool if pool not full
        if (this.objectPools.bombs.length < this.objectPools.maxPoolSize) {
            bomb.resetForPool();
            this.objectPools.bombs.push(bomb);
            this.logger.debug(`Returned bomb ${bombId} to pool`);
        } else {
            bomb.cleanup();
            this.logger.debug(`Cleaned up bomb ${bombId} (pool full)`);
        }
        
        return true;
    }
    
    /**
     * Get bombs data for serialization
     *  Returns ARRAY (RenderSystem expects bombs.forEach)
     */
    getBombsData() {
        return Array.from(this.bombs.values());
    }
    
    // Explosion management
    
    /**
     * Add explosion to state
     */
    addExplosion(explosionData) {
        // Explosions are just data objects, not class instances
        const explosion = {
            ...explosionData,
            createTime: explosionData.createTime || Date.now(),
            duration: explosionData.duration || GAME_CONFIG.EXPLOSION_DURATION || 1000
        };
        
        this.explosions.set(explosion.id, explosion);
        
        // PHASE 1: Immediate cleanup timer setup
        const cleanupTimer = setTimeout(() => {
            this.removeExplosion(explosion.id);
            this.cleanupTimers.delete(cleanupTimer);
        }, explosion.duration);
        
        this.cleanupTimers.add(cleanupTimer);
        explosion._cleanupTimer = cleanupTimer;
        
        this.logger.debug(`Added explosion: ${explosion.id}`);
        return explosion;
    }
    
    
    /**
     * Remove explosion from state
     */
    removeExplosion(explosionId) {
        const explosion = this.explosions.get(explosionId);
        if (!explosion) return false;
        
        this.explosions.delete(explosionId);
        
        // Clear cleanup timer
        if (explosion._cleanupTimer) {
            clearTimeout(explosion._cleanupTimer);
            this.cleanupTimers.delete(explosion._cleanupTimer);
            explosion._cleanupTimer = null;
        }
        
        // Explosions are just data objects, so no need for pooling
        // Just let them be garbage collected
        this.logger.debug(`Removed explosion: ${explosionId}`);
        return true;
    }

    performAggressiveCleanup(currentTime) {
        const timeSinceLastCleanup = currentTime - this.lastCleanupTime;
        
        if (timeSinceLastCleanup < this.cleanupInterval) return;
        
        this.lastCleanupTime = currentTime;
        let cleanupCount = 0;
        
        // Clear expired timers
        this.cleanupTimers.forEach(timer => {
            if (timer._cleared) {
                this.cleanupTimers.delete(timer);
                cleanupCount++;
            }
        });
        
        // Force cleanup old explosions (they're just data objects)
        this.explosions.forEach((explosion, explosionId) => {
            if (currentTime - explosion.createTime > (explosion.duration + 500)) {
                this.removeExplosion(explosionId);
                cleanupCount++;
            }
        });
        
        // Clean up bomb pool if too large
        if (this.objectPools.bombs.length > this.objectPools.maxPoolSize) {
            const excess = this.objectPools.bombs.length - this.objectPools.maxPoolSize;
            const removedBombs = this.objectPools.bombs.splice(this.objectPools.maxPoolSize);
            removedBombs.forEach(bomb => bomb.cleanup());
            cleanupCount += excess;
        }
        
      
        
        // Clear chat messages more aggressively
        if (this.chatMessages.length > 20) {
            this.chatMessages = this.chatMessages.slice(-20);
            cleanupCount++;
        }
        
        if (cleanupCount > 0) {
            this.logger.debug(`Aggressive cleanup: ${cleanupCount} items cleaned`);
        }
    }
    
    /**
     * Get explosions data for serialization
     *  Returns ARRAY (RenderSystem expects explosions.forEach)
     */
    getExplosionsData() {
        return Array.from(this.explosions.values());
    }
    
    // Power-up management
    
    /**
     * Add power-up to state
     */
    addPowerUp(powerUpData) {
        const powerUp = {
            id: powerUpData.id,
            type: powerUpData.type,
            x: powerUpData.x,
            y: powerUpData.y,
            createTime: Date.now(),
            expireTime: Date.now() + (powerUpData.duration || 30000)
        };
        
        this.powerUps.set(powerUp.id, powerUp);
        this.logger.debug('Power-up added to state', powerUp.id);
        return powerUp;
    }
    
    /**
     * Remove power-up
     */
    removePowerUp(powerUpId) {
        // DEFENSIVE: Ensure powerUps is a Map
        if (!(this.powerUps instanceof Map)) {
            this.logger.warn('PowerUps is not a Map! Reinitializing...', {
                currentType: typeof this.powerUps,
                constructor: this.powerUps?.constructor?.name,
                powerUpId: powerUpId
            });
            
            // Convert existing data to Map if possible
            const existingData = Array.isArray(this.powerUps) ? this.powerUps : [];
            this.powerUps = new Map();
            
            // Restore data to Map format
            existingData.forEach(powerUp => {
                if (powerUp && powerUp.id) {
                    this.powerUps.set(powerUp.id, powerUp);
                }
            });
            
            this.logger.info(`PowerUps Map recreated with ${this.powerUps.size} items`);
        }
        
        // Now safely remove the power-up
        if (this.powerUps.has(powerUpId)) {
            this.powerUps.delete(powerUpId);
            this.logger.debug('Power-up removed from state', powerUpId);
            return true;
        } else {
            this.logger.debug('Power-up not found for removal:', powerUpId);
            return false;
        }
    }
    
    
    /**
     * Get power-ups data for serialization
     *  Returns ARRAY (RenderSystem expects powerUps.forEach)
     */
    getPowerUpsData() {
        return Array.from(this.powerUps.values());
    }
    
    // Map management
    
    /**
     * Set map data
     */
    setMapData(mapData) {
        if (!mapData || typeof mapData !== 'object') {
            this.logger.warn('Invalid map data provided:', mapData);
            return;
        }
        
        let hasChanges = false;
        
        //  Safely handle walls with type checking
        if (mapData.walls !== undefined) {
            try {
                // Clear existing walls safely
                if (this.walls && typeof this.walls.clear === 'function') {
                    this.walls.clear();
                } else {
                    this.walls = new Set(); // Recreate if corrupted
                }
                
                // Add new walls
                const wallsData = mapData.walls;
                if (Array.isArray(wallsData)) {
                    wallsData.forEach(wall => this.walls.add(wall));
                } else if (wallsData instanceof Set) {
                    this.walls = new Set(wallsData);
                } else {
                    this.logger.warn('Walls data is not array or Set:', typeof wallsData);
                }
                hasChanges = true;
            } catch (error) {
                this.logger.error('Error setting walls data:', error);
                this.walls = new Set(); // Fallback to empty Set
            }
        }
        
        //  Safely handle blocks with type checking
        if (mapData.blocks !== undefined) {
            try {
                // Clear existing blocks safely
                if (this.blocks && typeof this.blocks.clear === 'function') {
                    this.blocks.clear();
                } else {
                    this.blocks = new Set(); // Recreate if corrupted
                }
                
                // Add new blocks
                const blocksData = mapData.blocks;
                if (Array.isArray(blocksData)) {
                    blocksData.forEach(block => this.blocks.add(block));
                } else if (blocksData instanceof Set) {
                    this.blocks = new Set(blocksData);
                } else {
                    this.logger.warn('Blocks data is not array or Set:', typeof blocksData);
                }
                hasChanges = true;
            } catch (error) {
                this.logger.error('Error setting blocks data:', error);
                this.blocks = new Set(); // Fallback to empty Set
            }
        }
        
        if (hasChanges) {
            this.logger.debug('Map data updated safely', {
                walls: this.walls.size,
                blocks: this.blocks.size,
                wallsType: this.walls.constructor.name,
                blocksType: this.blocks.constructor.name
            });
            
            // Emit map data change event
            this.emit('mapDataChanged', {
                walls: this.walls.size,
                blocks: this.blocks.size
            });
        }
    }
    performPeriodicCleanup(currentTime) {
        let cleanupCount = 0;
        
        // Clean up expired explosions
        this.explosions.forEach((explosion, explosionId) => {
            if (explosion.isExpired && explosion.isExpired(currentTime)) {
                this.removeExplosion(explosionId);
                cleanupCount++;
            }
        });
        
        // Clean up old chat messages (keep only last 50)
        if (this.chatMessages.length > 50) {
            this.chatMessages = this.chatMessages.slice(-50);
            cleanupCount++;
        }
        
      
        
        // PERFORMANCE: Clean up conversion cache periodically
        if (this._conversionCache.size > this._cacheMaxSize) {
            const keysToDelete = Array.from(this._conversionCache.keys())
                .slice(0, Math.floor(this._cacheMaxSize / 2));
            keysToDelete.forEach(key => this._conversionCache.delete(key));
            cleanupCount++;
        }
        
        // Log cleanup if items were removed
        if (cleanupCount > 0) {
            this.logger.debug(`Optimized cleanup completed: ${cleanupCount} operations`);
        }
    }
   
    /**
     * Add wall
     */
    addWall(x, y) {
        const key = `${x},${y}`;
        this.walls.add(key);
    }
    
    /**
     * Add block
     */
    addBlock(x, y) {
        const key = `${x},${y}`;
        this.blocks.add(key);
    }
    
    /**
     * Remove block
     */
    removeBlock(x, y) {
        const key = `${x},${y}`;
        this.blocks.delete(key);
    }
    
    // Event system for communication between systems
    
    /**
     * Emit event to listeners
     */
    emit(eventType, data) {
        const listeners = this.listeners.get(eventType);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    this.logger.error(`Error in event listener for ${eventType}:`, error);
                }
            });
        }
    }
    
    /**
     * Add event listener
     */
    on(eventType, callback) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType).add(callback);
    }
    
    /**
     * Remove event listener
     */
    off(eventType, callback) {
        const listeners = this.listeners.get(eventType);
        if (listeners) {
            listeners.delete(callback);
        }
    }
    
   

    getAllEntities() {
        return {
            players: this.players,
            bombs: this.bombs,
            explosions: this.explosions,
            powerUps: this.powerUps
        };
    }
    
   
    /**
     * Clear all state (for game reset)
     */
    reset() {
        this.logger.info('Resetting state manager with memory cleanup');
        
        // Clear entities
        this.players.clear();
        this.bombs.clear();
        this.explosions.clear();
        this.powerUps.clear();
        
        // Clear map data
        this.walls.clear();
        this.blocks.clear();

        // DEFENSIVE: Ensure arrays are properly reset
        if (Array.isArray(this.waitingPlayers)) {
            this.waitingPlayers.length = 0;
        } else {
            this.waitingPlayers = [];
        }

        if (Array.isArray(this.chatMessages)) {
            this.chatMessages.length = 0;
        } else {
            this.chatMessages = [];
        }
        
        // Reset UI state
        this.queueSize = 0;
        this.countdown = 0;
        this.currentChatMessage = '';
        this.gameResults = null;
        this.errorMessage = null;
        
        // Reset game state
        this.gameState = GAME_STATES.NICKNAME;
        this.gameId = null;
        
        //  Clear event listeners
        this.listeners.clear();
        
        this.emit(EVENT_TYPES.STATE_RESET);
    }
    
    
}
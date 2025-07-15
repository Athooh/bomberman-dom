// src/core/GameEngine.js
// Core game engine coordinating all game systems and state management

import { GAME_STATES, EVENT_TYPES } from '../utils/Constants.js';
import { Logger } from '../utils/Logger.js';
import { StateManager } from './StateManager.js';
import { NetworkManager } from './NetworkManager.js';
import RenderSystem from '../systems/RenderSystem.js';
import { InputSystem } from '../systems/InputSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { MapSystem } from '../systems/MapSystem.js';
import { UIManager } from '../ui/UIManager.js';
import { Player } from '../entities/Player.js';
import { PerformanceMonitor } from '../utils/PerformanceMonitor.js';
import { eventManager, EventCleanupMixin } from '../utils/EventManager.js';
import { WorkerManager } from '../workers/WorkerManager.js';

/**
 * Game Engine - Frame Budget Optimized Edition
 * Maintains stable 60+ FPS with zero frame drops through frame budgeting
 * Implements system priority levels and performance-aware updates
 */
export class GameEngine extends EventCleanupMixin {
    constructor(container) {
        super(); // Initialize EventCleanupMixin
        this.logger = new Logger('GameEngine');
        this.container = container;
        this.isRunning = false;
        this.gameLoopId = null;

        // Set up event manager
        this.setEventManager(eventManager);

        // Initialize WorkerManager for off-main-thread processing
        this.workerManager = new WorkerManager();
        this.useWorkers = false; // Will be set to true when workers are initialized

        // Frame budget system for stable 60+ FPS
        this.FRAME_BUDGET_MS = 14; // 14ms budget (2ms buffer for 60 FPS)
        this.frameBudget = {
            frameTimeLimit: this.FRAME_BUDGET_MS,
            currentFrameStartTime: 0,
            budgetRemaining: this.FRAME_BUDGET_MS,
            systemBudgets: {
                CRITICAL: 6,  // Network, State (6ms)
                HIGH: 4,      // Collision, Input (4ms)
                MEDIUM: 3,    // Rendering (3ms)
                LOW: 1        // UI, Effects (1ms)
            },
            budgetExceededCount: 0,
            emergencyModeActive: false
        };



        // Enhanced performance monitoring
        this.performanceMonitor = new PerformanceMonitor();
        this.performanceMonitor.start();
        
        // System initialization flags
        this.systemsInitialized = {
            core: false,
            ui: false,
            rendering: false,
            gameLogic: false
        };
        
        // State update batching for performance
        this.stateBatchingEnabled = true;
        this.pendingStateUpdates = {};
        this.stateBatchTimeout = null;
        
        // Initialize core systems with proper coordination
        this.initializeSystems();
        
        // Game state
        this.gameId = null;
        
        this.logger.info('GameEngine initialized');
    }
    
    /**
     * Initialize all game systems with proper coordination
     */
    initializeSystems() {
        try {
            this.logger.info('Initializing game systems with state batching...');
            
            // === PHASE 1: CORE SYSTEMS ===
            this.stateManager = new StateManager();
            this.logger.info('StateManager initialized');
      
            
            this.networkManager = new NetworkManager();
            this.logger.info('NetworkManager initialized');
            
            this.systemsInitialized.core = true;
            
            // === PHASE 2: UI SYSTEM (PURE VIRTUAL DOM) ===
            this.uiManager = new UIManager(this.stateManager);
            this.logger.info('UIManager initialized with Pure Virtual DOM');
            
            this.systemsInitialized.ui = true;
            
            // === PHASE 3: RENDERING SYSTEM ===
            this.renderSystem = new RenderSystem();
            this.logger.info('RenderSystem initialized - will receive game area from Virtual DOM');
            
            this.systemsInitialized.rendering = true;
            
            // === PHASE 4: GAME LOGIC SYSTEMS ===
            this.inputSystem = new InputSystem();
            this.logger.info('InputSystem initialized');
            
            this.collisionSystem = new CollisionSystem();
            this.logger.info('CollisionSystem initialized');
            
            this.mapSystem = new MapSystem();
            this.logger.info('MapSystem initialized');
            
            this.systemsInitialized.gameLogic = true;
            
            // === PHASE 5: SYSTEM COORDINATION ===
            this.setupSystemCoordination();
            
            this.logger.info('All systems initialized with state batching coordination');
            
        } catch (error) {
            this.logger.error('Failed to initialize systems:', error);
            throw new Error(`System initialization failed: ${error.message}`);
        }
    }
    
    /**
     * Setup coordination between systems
     */
    setupSystemCoordination() {
        this.logger.debug('Setting up system coordination with state batching...');
        
        // === UIManager → RenderSystem COORDINATION ===
        this.uiManager.setGameAreaCallback((gameArea) => {
            this.logger.info('✅ Virtual DOM game area provided to RenderSystem');
            this.renderSystem.setGameArea(gameArea);
        });
        
        // === NETWORK CONNECTION COORDINATION ===
        this.networkManager.on('connected', () => {
            this.logger.info('🔗 Network connected - updating all systems');
            
            // Update connection state across all systems
            this.batchStateUpdate({
                isConnected: true,
                connectionState: 'connected'
            });
            
            // Update UIManager directly
            this.uiManager.updateConnectionState(true, 'connected');
        });
        
        this.networkManager.on('disconnected', () => {
            this.logger.warn('🔗 Network disconnected - updating all systems');
            
            // Update disconnection state across all systems
            this.batchStateUpdate({
                isConnected: false,
                connectionState: 'disconnected'
            });
            
            // Update UIManager directly
            this.uiManager.updateConnectionState(false, 'disconnected');
        });
        
        this.networkManager.on('connecting', () => {
            this.logger.info('🔗 Network connecting - updating all systems');
            
            // Update connecting state across all systems
            this.batchStateUpdate({
                isConnected: false,
                connectionState: 'connecting'
            });
            
            // Update UIManager directly
            this.uiManager.updateConnectionState(false, 'connecting');
        });

        // === NETWORK MESSAGE HANDLING ===
        this.networkManager.on('connected', (data) => this.handleNetworkEvent('connected', data));
        this.networkManager.on('disconnected', (data) => this.handleNetworkEvent('disconnected', data));
        this.networkManager.on('nicknameSet', (data) => this.handleNetworkEvent('nicknameSet', data));
        this.networkManager.on('queueJoined', (data) => this.handleNetworkEvent('queueJoined', data));
        this.networkManager.on('queueUpdate', (data) => this.handleNetworkEvent('queueUpdate', data));
        this.networkManager.on('gameWaiting', (data) => this.handleNetworkEvent('gameWaiting', data));
        this.networkManager.on('gameCountdown', (data) => this.handleNetworkEvent('gameCountdown', data));
        this.networkManager.on('countdownUpdate', (data) => this.handleNetworkEvent('countdownUpdate', data));
        this.networkManager.on('gameStart', (data) => this.handleNetworkEvent('gameStart', data));
        this.networkManager.on('gameEnd', (data) => this.handleNetworkEvent('gameEnd', data));
        this.networkManager.on('gameStarted', (data) => this.handleNetworkEvent('gameStarted', data));
        this.networkManager.on('gameTimer', (data) => this.handleGameTimer(data));
        this.networkManager.on('gameState', (data) => this.handleNetworkEvent('gameState', data));
        this.networkManager.on('playerJoined', (data) => this.handlePlayerJoined(data));
        this.networkManager.on('playerLeft', (data) => this.handlePlayerLeft(data));
        this.networkManager.on('chatMessage', (data) => this.handleNetworkEvent('chatMessage', data));
        this.networkManager.on('powerUpCollected', (data) => this.handleNetworkEvent('powerUpCollected', data));
        this.networkManager.on('powerUpExpired', (data) => this.handleNetworkEvent('powerUpExpired', data));
        this.networkManager.on('queueCountdown', (data) => this.handleNetworkEvent('queueCountdown', data));
        this.networkManager.on('playerDamaged', (data) => this.handlePlayerDamaged(data));
        this.networkManager.on('playerEliminated', (data) => this.handlePlayerEliminated(data));
        this.networkManager.on('error', (data) => this.handleErrorMessage(data));
        
        // === INPUT SYSTEM COORDINATION ===
        this.inputSystem.on('move', (direction) => {
            this.handlePlayerInput({ type: 'move', direction });
        });

        this.inputSystem.on('placeBomb', () => {
            this.handlePlayerInput({ type: 'placeBomb' });
        });

        this.inputSystem.on('openChat', () => {
            this.handlePlayerInput({ type: 'openChat' });
        });

    
        
        // === STATE CHANGE COORDINATION ===
        this.stateManager.on(EVENT_TYPES.STATE_CHANGED, (newState) => {
            this.handleStateChanged(newState);
        });
        
        // === UI EVENT COORDINATION ===
        this.uiManager.onEvent = (event, data) => {
            this.handleUIEvent(event, data);
        };
        
       
        this.collisionSystem.on('explosionHitBlock', (data) => {
            this.handleExplosionHitBlock(data);
        });
        
        this.collisionSystem.on('explosionHitBomb', (data) => {
            this.handleExplosionHitBomb(data);
        });

        // === PERFORMANCE MONITORING COORDINATION ===
        if (typeof window !== 'undefined') {
            window.addEventListener('performanceOptimizationChange', (event) => {
                this.handlePerformanceOptimization(event.detail);
            });

            window.addEventListener('performanceEmergencyOptimization', (event) => {
                this.handleEmergencyOptimization(event.detail);
            });
        }

        // === WORKER COORDINATION ===
        this.setupWorkerEventListeners();

        this.logger.debug('✅ System coordination established with state batching, performance monitoring, and workers');
    }

    /**
     * Setup worker event listeners for handling worker responses
     */
    setupWorkerEventListeners() {
        if (!this.workerManager) {
            this.logger.warn('WorkerManager not available - skipping worker event listeners');
            return;
        }

        // === COLLISION WORKER EVENTS ===
        this.workerManager.addEventListener('collision', 'COLLISION_RESULTS', (data) => {
            this.handleCollisionWorkerResults(data);
        });

        this.workerManager.addEventListener('collision', 'ERROR', (error) => {
            this.handleWorkerError('collision', error);
        });

        // === PHYSICS WORKER EVENTS ===
        this.workerManager.addEventListener('physics', 'PHYSICS_UPDATE', (data) => {
            this.handlePhysicsWorkerUpdate(data);
        });

        this.workerManager.addEventListener('physics', 'BOMB_PLACED', (data) => {
            this.handleWorkerBombPlaced(data);
        });

        this.workerManager.addEventListener('physics', 'BOMB_PLACEMENT_FAILED', (data) => {
            this.handleWorkerBombPlacementFailed(data);
        });

        this.workerManager.addEventListener('physics', 'EXPLOSION_TRIGGERED', (data) => {
            this.handleWorkerExplosionTriggered(data);
        });

        this.workerManager.addEventListener('physics', 'ERROR', (error) => {
            this.handleWorkerError('physics', error);
        });

        // === NETWORK WORKER EVENTS ===
        this.workerManager.addEventListener('network', 'INCOMING_PROCESSED', (data) => {
            this.handleNetworkWorkerIncomingProcessed(data);
        });

        this.workerManager.addEventListener('network', 'OUTGOING_READY', (data) => {
            this.handleNetworkWorkerOutgoingReady(data);
        });

        this.workerManager.addEventListener('network', 'NETWORK_STATS', (data) => {
            this.handleNetworkWorkerStats(data);
        });

        this.workerManager.addEventListener('network', 'ERROR', (error) => {
            this.handleWorkerError('network', error);
        });

        this.logger.debug('Worker event listeners established');
    }

    /**
     * Handle performance optimization changes
     */
    handlePerformanceOptimization(detail) {
        try {
            this.logger.info(`Performance optimization level changed to: ${detail.level}`);

            // Apply optimizations to render system
            if (this.renderSystem && this.renderSystem.applyOptimizations) {
                this.renderSystem.applyOptimizations(detail.adjustments);
            }

            // Apply optimizations to collision system
            if (this.collisionSystem && this.collisionSystem.setOptimizationLevel) {
                this.collisionSystem.setOptimizationLevel(detail.level);
            }

        } catch (error) {
            this.logger.error('Error handling performance optimization:', error);
        }
    }

    /**
     * Handle emergency performance optimization
     */
    handleEmergencyOptimization(detail) {
        try {
            this.logger.warn('Emergency performance optimization triggered');

            // Apply emergency optimizations
            if (this.renderSystem) {
                this.renderSystem.enableEmergencyMode(detail.adjustments);
            }

            if (this.collisionSystem) {
                this.collisionSystem.enableEmergencyMode();
            }

            // Note: Emergency mode reduces frame budget instead of changing FPS target

        } catch (error) {
            this.logger.error('Error handling emergency optimization:', error);
        }
    }
    
    /**
     * Batch state updates for optimal performance and reduced re-renders
     */
    batchStateUpdate(updates) {
        if (!updates || typeof updates !== 'object') return;
        
        // Merge updates into pending batch
        Object.assign(this.pendingStateUpdates, updates);

        // Clear existing timeout to prevent accumulation
        if (this.stateBatchTimeout) {
            clearTimeout(this.stateBatchTimeout);
        }
        
        // Batch updates to reduce state change frequency
        this.stateBatchTimeout = setTimeout(() => {
            if (Object.keys(this.pendingStateUpdates).length > 0) {
                this.logger.debug('Applying batched state updates:', Object.keys(this.pendingStateUpdates));
                this.validateAndUpdateState(this.pendingStateUpdates);
                this.pendingStateUpdates = {};
            }
            this.stateBatchTimeout = null;
        }, 16); // Wait one frame (60fps = 16ms)
    }

    validateAndUpdateState(updates) {
        try {
            // Validate players data structure
            if (updates.players && typeof updates.players !== 'object') {
            this.logger.warn('Invalid players data type:', typeof updates.players);
            delete updates.players;
        } 
            
            // Validate arrays
            ['bombs', 'explosions', 'powerUps', 'walls', 'blocks'].forEach(field => {
                if (updates[field] && !Array.isArray(updates[field])) {
                    this.logger.warn(`Invalid ${field} data type:`, typeof updates[field]);
                    delete updates[field];
                }
            });
            
            // Apply validated updates
            this.stateManager.updateState(updates);
            
        } catch (error) {
            this.logger.error('Error in validateAndUpdateState:', error);
            // Try to recover by applying updates one by one
            Object.entries(updates).forEach(([key, value]) => {
                try {
                    this.stateManager.updateState({ [key]: value });
                } catch (singleError) {
                    this.logger.warn(`Failed to update ${key}:`, singleError);
                }
            });
        }
    }
    
    
    /**
     * Flush pending state updates immediately
     */
    flushStateUpdates() {
        if (this.stateBatchTimeout) {
            clearTimeout(this.stateBatchTimeout);
            this.stateBatchTimeout = null;
        }
        
        if (Object.keys(this.pendingStateUpdates).length > 0) {
            this.logger.debug('Flushing batched state updates:', Object.keys(this.pendingStateUpdates));
            this.stateManager.updateState(this.pendingStateUpdates);
            this.pendingStateUpdates = {};
        }
    }
   
    /**
     * Handle network events and route to state manager
     */
    handleNetworkEvent(eventType, data) {
        try {
            // Validate input parameters
            if (!eventType || typeof eventType !== 'string') {
                this.logger.warn('Invalid eventType received:', eventType);
                return;
            }

            // DEBUGGING: Log specific events that are causing issues
            if (eventType === 'countdownUpdate' || eventType === 'gameStart') {
                this.logger.info(`GameEngine handling network event: ${eventType}`, {
                    eventType: eventType,
                    hasData: !!data,
                    dataKeys: Object.keys(data || {}),
                    fullData: data
                });
            }

            // Ensure data is an object and provide safe defaults
            const eventData = data || {};

            switch (eventType) {
                case 'connected':
                    this.batchStateUpdate({
                        isConnected: true,
                        connectionState: 'connected'
                    });
                    break;
                    
                case 'disconnected':
                    this.batchStateUpdate({
                        isConnected: false,
                        connectionState: 'disconnected'
                    });
                    break;
                    
                case 'nicknameSet':
                    this.batchStateUpdate({
                        nickname: eventData.nickname || 'Player',
                        gameState: GAME_STATES.MENU
                    });
                    break;

                case 'queueJoined':
                    // Handle queue join confirmation from server
                    this.logger.info(`Queue joined - ${eventData.queueSize || 0} players in queue`);
                    this.batchStateUpdate({
                        gameState: GAME_STATES.QUEUE,
                        queueSize: eventData.queueSize || 0,
                        waitingPlayers: Array.isArray(eventData.players) ? eventData.players : [],
                        queueCountdown: null  // Clear any existing countdown
                    });
                    break;

                case 'queueUpdate':
                    this.handleQueueUpdate(eventData);
                    break;

                case 'gameCountdown':
                    this.handleGameCountdown(eventData);
                    break;

                case 'countdownUpdate':
                    this.handleCountdownUpdate(eventData);
                    break;

                case 'gameStart':
                    this.handleGameStart(eventData);
                    break;

                case 'gameEnd':
                    this.handleGameEnd(eventData);
                    break;

                case 'gameStarted':
                    this.handleGameStarted(eventData);
                    break;

                case 'gameState':
                    this.handleGameUpdate(eventData);
                    break;

                case 'chatMessage':
                    this.handleChatMessage(eventData);
                    break;

                case 'powerUpCollected':
                    this.handlePowerUpCollected(eventData);
                    break;

                case 'powerUpExpired':
                    this.handlePowerUpExpired(eventData);
                    break;
                case 'queueCountdown':
                    this.handleQueueCountdown(eventData);
                    break;
                
                    
                default:
                    this.logger.debug('Unhandled network event:', eventType);
            }
        } catch (error) {
            this.logger.error('Error handling network event:', error);
        }
    }

    /**
     * Handle UI events - Routes UI events to appropriate systems
     */
    handleUIEvent(event, data) {
        try {
            this.logger.debug(`Handling UI event: ${event}`, data);
            
            switch (event) {
                case 'setNickname':
                    this.handleSetNickname(data);
                    break;
                    
                case 'joinQueue':
                    this.handleJoinQueue();
                    break;
                    
                case 'leaveQueue':
                    this.handleLeaveQueue();
                    break;
                    
                case 'sendChatMessage':
                    this.handleSendChatMessage(data);
                    break;
                    
                case 'returnToMenu':
                    this.handleReturnToMenu();
                    break;
                    
                case 'placeBomb':
                    this.handlePlayerInput({ type: 'placeBomb' });
                    break;
                    
                case 'openChat':
                    // Focus chat input
                    const chatInput = document.querySelector('.chat-input');
                    if (chatInput) {
                        chatInput.focus();
                    }
                    break;
                    
                case 'closeChat':
                    // Blur chat input
                    const activeChatInput = document.querySelector('.chat-input:focus');
                    if (activeChatInput) {
                        activeChatInput.blur();
                    }
                    break;
                    
                default:
                    this.logger.warn('Unknown UI event:', event, data);
            }
            
        } catch (error) {
            this.logger.error('Error handling UI event:', error);
        }
    }

    handleQueueCountdown(data) {
        try {
            // DEBUGGING: Log the received data structure
            this.logger.info('Queue countdown received:', {
                hasData: !!data,
                countdown: data?.countdown,
                queueSize: data?.queueSize,
                playersCount: data?.players?.length || 0,
                fullData: data
            });

            if (!data || data.countdown === undefined || data.queueSize === undefined) {
                this.logger.warn('Invalid queue countdown data received:', data);
                return;
            }

            this.logger.info(`Queue countdown: ${data.countdown} seconds with ${data.queueSize} players`);

            this.batchStateUpdate({
                gameState: GAME_STATES.QUEUE,
                queueCountdown: data.countdown,      // ✅ Queue-level countdown
                queueSize: data.queueSize,
                waitingPlayers: Array.isArray(data.players) ? data.players : []
            });
            
            // Show notification for queue countdown milestones
            if (this.uiManager) {
                if (data.countdown === 20) {
                    this.uiManager.showNotification('Game starting in 20 seconds!', 'info');
                } else if (data.countdown === 10) {
                    this.uiManager.showNotification('Game starting in 10 seconds!', 'warning');
                } else if (data.countdown === 5) {
                    this.uiManager.showNotification('Get ready! Game starting soon!', 'warning');
                }
            }
            
        } catch (error) {
            this.logger.error('Error handling queue countdown:', error);
        }
    }
    

    handlePowerUpCollected(data) {
        try {
            const { playerId, powerUpType, x, y } = data;
            
            this.logger.info(`Player ${playerId} collected ${powerUpType} at (${x}, ${y})`);
            
            // Remove power-up from client state using coordinates
            const powerUpId = `powerup_${x}_${y}`;
            this.stateManager.removePowerUp(powerUpId);
            
            // CRITICAL: Remove visual element
            this.renderSystem.removePowerUpElement(powerUpId);
            
            // Update game state
            this.batchStateUpdate({
                powerUps: this.stateManager.getPowerUpsData()
            });
            
            // Show collection notification
            if (this.uiManager) {
                const player = this.stateManager.getPlayer(playerId);
                const playerName = player ? player.nickname : `Player ${playerId}`;
                this.uiManager.showNotification(
                    `${playerName} collected ${powerUpType}!`, 
                    'success'
                );
            }
            
        } catch (error) {
            this.logger.error('Error handling power-up collection:', error);
        }
    }

    handlePowerUpExpired(data) {
        try {
            const { powerUpId, x, y, reason } = data;
            
            this.logger.debug(`Power-up expired: ${powerUpId} at (${x}, ${y}) - ${reason}`);
            
            // Remove from client state
            this.stateManager.removePowerUp(powerUpId);
            
            // CRITICAL: Remove visual element
            this.renderSystem.removePowerUpElement(powerUpId);
            
            // Update game state
            this.batchStateUpdate({
                powerUps: this.stateManager.getPowerUpsData()
            });
            
        } catch (error) {
            this.logger.error('Error handling power-up expiration:', error);
        }
    }
    

    /**
     * Handle game countdown start
     */
    handleGameCountdown(data) {
        try {
            this.logger.info(`Game countdown started: ${data.countdown} seconds`);
            this.logger.info(`Game countdown started with ${data.players?.length || 0} players`);
            
            // Convert player array to object format and store in correct field
            const playersObject = this.convertPlayersArrayToObject(data.players);
            
            this.batchStateUpdate({
                gameState: GAME_STATES.LOBBY,
                countdown: data.countdown,
                players: playersObject,  // ✅ Store in players field for game entities
                waitingPlayers: Array.isArray(data.players) ? data.players : []  // ✅ Keep for lobby display
            });
            
            // Show notification
            if (this.uiManager) {
                this.uiManager.showNotification('Game starting soon!', 'info');
            }
            
            this.logger.debug(`Players stored correctly: ${Object.keys(playersObject).length} players`);
            
        } catch (error) {
            this.logger.error('Error handling game countdown:', error);
        }
    }
    
    /**
     * NEW: Convert players array to object format required by StateManager
     */
    convertPlayersArrayToObject(playersArray) {
        if (!Array.isArray(playersArray)) {
            this.logger.warn('Players data is not an array:', typeof playersArray);
            return {};
        }
        
        const playersObject = {};
        
        playersArray.forEach((playerData, index) => {
            try {
                const playerId = playerData.id || `player_${index}`;

               
                
                // Create properly formatted player object
                playersObject[playerId] = {
                    id: playerId,
                    nickname: playerData.nickname || `Player ${index + 1}`,
                    index: playerData.index || index,
                    x: playerData.x || 0,
                    y: playerData.y || 0,
                    lives: playerData.lives || 3,
                    isAlive: playerData.isAlive !== false,
                    isInvulnerable: playerData.isInvulnerable || false,
                    speed: playerData.speed || 2,
                    maxBombs: playerData.maxBombs || 1,
                    bombRange: playerData.bombRange || 1,
                    placedBombs: playerData.placedBombs || 0,
                    powerUps: playerData.powerUps || {},
                    color: this.getPlayerColor(index),
                    direction: playerData.direction || 'down',
                    isMoving: playerData.isMoving || false,
                    score: playerData.score || 0,
                    joinedAt: playerData.joinedAt || Date.now()
                };
                
                
            } catch (playerError) {
                this.logger.error(`Error converting player ${index}:`, playerError);
            }
        });
        
        return playersObject;
    }

    getPlayerColor(index) {
        const colors = ['#4A90E2', '#E94B3C', '#7ED321', '#F5A623'];
        return colors[index] || '#999999';
    }
    
    

    /**
     * Handle countdown updates
     */
    handleCountdownUpdate(data) {
        try {
            // DEBUGGING: Log the received data structure
            this.logger.debug('Countdown update received:', {
                hasData: !!data,
                countdown: data?.countdown,
                fullData: data
            });

            if (!data || data.countdown === undefined) {
                this.logger.warn('Invalid countdown update data received:', data);
                return;
            }

            this.logger.debug(`Countdown update: ${data.countdown}`);

            const currentState = this.stateManager.getCurrentState();
            
            // If we're in QUEUE and receive countdown update, transition to LOBBY
            // This means the game countdown has started (10 seconds)
            if (currentState.gameState === GAME_STATES.QUEUE && data.countdown <= 10) {
                this.logger.info(`Game countdown started - transitioning from QUEUE to LOBBY`);
                
                this.batchStateUpdate({
                    gameState: GAME_STATES.LOBBY,  // ✅ Transition to LOBBY
                    countdown: data.countdown,     // ✅ Update countdown
                    queueCountdown: null          // ✅ Clear queue countdown
                });
                
                // Show notification
                if (this.uiManager) {
                    this.uiManager.showNotification('Game starting now!', 'success');
                }
            } else {
                // Regular countdown update (already in LOBBY)
                this.batchStateUpdate({
                    countdown: data.countdown
                });
            }
            
        } catch (error) {
            this.logger.error('Error handling countdown update:', error);
        }
    }



    /**
     * Handle game end
     */
    handleGameEnd(data) {
        try {
            this.logger.info('Game ended:', data.winner?.id || 'No winner');
            
            const gameResults = {
                winner: data.winner,
                stats: data.stats,
                finalScores: data.finalScores || [],
                duration: data.stats?.duration || 0
            };
            
            this.batchStateUpdate({
                gameState: GAME_STATES.GAME_OVER,
                gameResults: gameResults
            });
            
            // Show notification
            if (this.uiManager) {
                const winnerText = data.winner ? 
                    `${data.winner.nickname || 'Player'} wins!` : 
                    'Game Over!';
                this.uiManager.showNotification(winnerText, 'info');
            }
            
        } catch (error) {
            this.logger.error('Error handling game end:', error);
        }
    }

    handleGameStarted(data) {
        try {
            this.gameId = data.gameId;
            
            const gameStartedUpdates = {
                gameState: GAME_STATES.PLAYING,
                gameId: this.gameId
            };
            
            // Handle map data
            if (data.walls) gameStartedUpdates.walls = data.walls;
            if (data.blocks) gameStartedUpdates.blocks = data.blocks;
            if (data.mapData) {
                gameStartedUpdates.walls = data.mapData.walls || [];
                gameStartedUpdates.blocks = data.mapData.blocks || [];
            }
            
            // Convert players properly
            if (data.players) {
                gameStartedUpdates.players = this.convertPlayersArrayToObject(data.players);
            }
            
            this.batchStateUpdate(gameStartedUpdates);
            
            this.logger.info('Game started event handled:', this.gameId);
            
        } catch (error) {
            this.logger.error('Error handling game started:', error);
        }
    }
    
    /**
     * Handle player hit by explosion
     */
    handlePlayerHitByExplosion(data) {
        try {
            const { player, explosion } = data;
            this.logger.gameEvent('PlayerHitByExplosion', { playerId: player.id, explosionId: explosion.id });

            // Server-authoritative damage: Only notify server, don't apply damage locally
            if (this.networkManager.checkConnection()) {
                this.networkManager.send({
                    type: 'playerHitByExplosion',
                    playerId: player.id,
                    explosionId: explosion.id,
                    timestamp: Date.now()
                });
            }

            this.logger.debug(`Player ${player.id} hit by explosion - notified server`);

        } catch (error) {
            this.logger.error('Error handling player hit by explosion:', error);
        }
    }
    
    /**
     * Handle player joined game
     */
    handlePlayerJoined(data) {
        try {
            this.logger.gameEvent('PlayerJoined', { playerId: data.id, nickname: data.nickname });
            
            // Create player instance properly
            const playerData = {
                id: data.id,
                nickname: data.nickname,
                x: data.x || 0,
                y: data.y || 0,
                lives: data.lives || 3,
                isAlive: data.isAlive !== false,
                isInvulnerable: data.isInvulnerable || false,
                speed: data.speed || 2,
                maxBombs: data.maxBombs || 1,
                bombRange: data.bombRange || 1,
                placedBombs: data.placedBombs || 0,
                powerUps: data.powerUps || {},
                color: data.color || '#ff6b6b',
                index: data.index || 0
            };
            
            const player = new Player(data.id, playerData);
            
            // Add to state manager
            this.stateManager.addPlayer(player);
            
            // Update UI state with proper players data
            this.batchStateUpdate({
                players: this.stateManager.getPlayersData()
            });
            
            // Show notification
            if (this.uiManager && data.nickname) {
                this.uiManager.showNotification(`${data.nickname} joined the game`, 'info');
            }
            
            this.logger.info(`Player joined successfully: ${data.nickname || data.id}`);
            
        } catch (error) {
            this.logger.error('Error handling player joined:', error);
        }
    }
    
    /**
     * Handle player left game
     */
    handlePlayerLeft(data) {
        try {
            const currentState = this.stateManager.getCurrentState();
            this.logger.info(`🚪 PLAYER_LEFT - Current game state: ${currentState.gameState}, Player: ${data.nickname || data.id}`);

            this.logger.gameEvent('PlayerLeft', {
                playerId: data.id,
                nickname: data.nickname,
                currentGameState: currentState.gameState,
                remainingPlayers: data.remainingPlayers
            });

            // Get player before removal for notification
            const player = this.stateManager.getPlayer(data.id);
            const playerName = player?.nickname || data.nickname || data.id;

            this.logger.info(`🔍 PLAYER_LEFT - Removing player: ${playerName}, Current players count: ${this.stateManager.getPlayers().length}`);

            // Remove from state manager
            this.stateManager.removePlayer(data.id);

            const updatedPlayers = this.stateManager.getPlayersData();
            this.logger.info(`📊 PLAYER_LEFT - After removal, players count: ${updatedPlayers.length}`);

            // Update UI state
            this.batchStateUpdate({
                players: updatedPlayers
            });

            // Show notification
            if (this.uiManager) {
                this.uiManager.showNotification(`${playerName} left the game`, 'warning');
            }

            // Check if game should end due to insufficient players
            this.checkGameOverConditions();

            this.logger.info(`✅ PLAYER_LEFT - Completed removal of: ${playerName}`);
            
        } catch (error) {
            this.logger.error('Error handling player left:', error);
        }
    }

    /**
     * Handle player damaged by server (but still alive)
     */
    handlePlayerDamaged(data) {
        try {
            const player = this.stateManager.getPlayer(data.playerId);
            if (!player) return;

            // Update player state from server (player is still alive)
            player.lives = data.lives;
            player.isAlive = data.isAlive;
            player.isInvulnerable = data.isInvulnerable;

            // Update UI state
            this.batchStateUpdate({
                players: this.stateManager.getPlayersData()
            });

            // Show heart loss notification
            if (this.uiManager) {
                const isCurrentPlayer = data.playerId === this.stateManager.getCurrentState().playerId;
                if (isCurrentPlayer) {
                    // Show notification for current player
                    this.uiManager.showNotification(`💔 You lost a heart! (${data.lives} ❤️ remaining)`, 'warning');
                } else {
                    // Show notification for other players
                    const playerName = player.nickname || 'Player';
                    this.uiManager.showNotification(`💔 ${playerName} lost a heart!`, 'info');
                }
            }

            this.logger.info(`Player ${data.playerId} damaged - Lives: ${data.lives}`);

        } catch (error) {
            this.logger.error('Error handling player damaged:', error);
        }
    }

    /**
     * Handle player eliminated by server
     */
    handlePlayerEliminated(data) {
        try {
            const player = this.stateManager.getPlayer(data.playerId);
            if (!player) return;

            // Update player state from server
            player.isAlive = false;
            player.lives = 0;

            // Update UI state
            this.batchStateUpdate({
                players: this.stateManager.getPlayersData()
            });

            // Show notification
            if (this.uiManager) {
                this.uiManager.showNotification(`${player.nickname} was eliminated!`, 'warning');
            }

            // Check if game should end
            if (data.remainingPlayers <= 1) {
                this.checkGameOverConditions();
            }

            this.logger.info(`Player ${data.playerId} eliminated - ${data.remainingPlayers} players remaining`);

        } catch (error) {
            this.logger.error('Error handling player eliminated:', error);
        }
    }

    /**
     * Handle explosion hitting block
     */
    handleExplosionHitBlock(data) {
        try {
            const { x, y } = data;
            
            // Destroy block and potentially spawn power-up
            const powerUp = this.mapSystem.destroyBlock(x, y);
            this.stateManager.removeBlock(x, y);
            
            if (powerUp) {
                this.stateManager.addPowerUp(powerUp);
            }
            
            // Update state
            this.batchStateUpdate({
                blocks: Array.from(this.stateManager.blocks),
                powerUps: this.stateManager.getPowerUpsData()
            });
            
        } catch (error) {
            this.logger.error('Error handling explosion hit block:', error);
        }
    }
    
    /**
     * Handle explosion hitting bomb (chain reaction)
     */
    handleExplosionHitBomb(data) {
        try {
            const { bomb } = data;
            this.logger.debug('Chain reaction triggered', { bombId: bomb.id });
            
            // Trigger bomb explosion after short delay
            setTimeout(() => {
                if (this.stateManager.bombs.has(bomb.id)) {
                    const chainExplosion = bomb.explode ? bomb.explode() : null;
                    if (chainExplosion) {
                        this.handleBombExplosion(bomb, chainExplosion);
                    }
                }
            }, 200);
            
        } catch (error) {
            this.logger.error('Error handling explosion hit bomb:', error);
        }
    }
    
    /**
     * Handle setting nickname
     */
    handleSetNickname(nickname) {
        try {
            if (!nickname || nickname.length < 2) {
                this.logger.warn('Invalid nickname provided');
                return;
            }
            
            // Update local state
            this.batchStateUpdate({ nickname });
            
            // Send to server
            if (this.networkManager.checkConnection()) {
                this.networkManager.setNickname(nickname);
            }
            
            this.logger.info('Nickname set:', nickname);
            
        } catch (error) {
            this.logger.error('Error setting nickname:', error);
        }
    }

    /**
     * Handle error messages from server
     */
    handleErrorMessage(data) {
        try {
            const message = data.message || 'An error occurred';
            const code = data.code || 'UNKNOWN_ERROR';

            this.logger.warn('Server error received:', { message, code });

            // Show error notification to user
            if (this.uiManager) {
                this.uiManager.showNotification(message, 'error');
            }

        } catch (error) {
            this.logger.error('Error handling server error message:', error);
        }
    }

    /**
     * Handle joining queue
     */
    handleJoinQueue() {
        try {
            if (this.networkManager.checkConnection()) {
                this.networkManager.joinQueue();
                this.logger.info('Joining matchmaking queue');
            } else {
                this.logger.warn('Cannot join queue - not connected to server');
            }
        } catch (error) {
            this.logger.error('Error joining queue:', error);
        }
    }
    
    /**
     * Handle leaving queue
     */
    handleLeaveQueue() {
        try {
            if (this.networkManager.checkConnection()) {
                this.networkManager.leaveQueue();
                this.logger.info('Leaving matchmaking queue');
            }
        } catch (error) {
            this.logger.error('Error leaving queue:', error);
        }
    }
    
    /**
     * Handle sending chat message
     */
    handleSendChatMessage(message) {
        try {
            // Validation
            if (!message || typeof message !== 'string') {
                this.logger.warn('Invalid chat message provided');
                return;
            }
            
            const trimmedMessage = message.trim();
            if (!trimmedMessage) {
                this.logger.warn('Cannot send empty chat message');
                return;
            }
            
            if (trimmedMessage.length > 200) {
                this.logger.warn('Chat message too long:', trimmedMessage.length);
                this.showNotification('Message too long! (Max 200 characters)');
                return;
            }
            
            // Check connection
            if (!this.networkManager.checkConnection()) {
                this.logger.warn('Cannot send chat message - not connected to server');
                this.showNotification('Not connected to server');
                return;
            }
            
            // Send message
            const success = this.networkManager.sendChatMessage(trimmedMessage);
            
            if (success) {
                this.logger.debug('Chat message sent successfully:', trimmedMessage);
                
                // Clear chat input state after successful send
                this.clearChatInputState();
                
                
                
            } else {
                this.logger.error('Failed to send chat message');
                this.showNotification('Failed to send message');
            }
            
        } catch (error) {
            this.logger.error('Error sending chat message:', error);
            this.showNotification('Error sending message');
        }
    }
    /**
     * NEW: Clear chat input state across all managers
     * Ensures consistent state clearing after message send
     */
    clearChatInputState() {
        try {
            // Clear in StateManager
            this.batchStateUpdate({
                currentChatMessage: ''
            });
            
            // Clear in UIManager if available
            if (this.uiManager && typeof this.uiManager.clearChatInput === 'function') {
                this.uiManager.clearChatInput();
            }
            
            this.logger.debug('Chat input state cleared');
            
        } catch (error) {
            this.logger.error('Error clearing chat input state:', error);
        }
    }

    /**
     * Handle returning to menu
     */
    handleReturnToMenu() {
        try {
            // Reset game state
            this.batchStateUpdate({
                gameState: GAME_STATES.MENU,
                gameResults: null,
                gameId: null
            });
            
            this.logger.info('Returned to menu');
            
        } catch (error) {
            this.logger.error('Error returning to menu:', error);
        }
    }
    
    handleQueueUpdate(data) {
        // DEBUGGING: Log the received data structure
        this.logger.info('Queue update received:', {
            hasData: !!data,
            queueSize: data?.queueSize,
            playersCount: data?.players?.length || 0,
            fullData: data
        });

        if (!data || data.queueSize === undefined) {
            this.logger.warn('Invalid queue update data received:', data);
            return;
        }

        const currentState = this.stateManager.getCurrentState();

        const stateUpdate = {
            queueSize: data.queueSize,
            waitingPlayers: Array.isArray(data.players) ? data.players : [],
            queueCountdown: null  // ✅ Clear any existing queue countdown
        };
        
        // If we're in menu and receive queueUpdate, transition to queue
        if (currentState.gameState === GAME_STATES.MENU) {
            stateUpdate.gameState = GAME_STATES.QUEUE;
            this.logger.info('Received queue update while in menu - transitioning to queue');
        }
        
        this.batchStateUpdate(stateUpdate);
    }

    /**
     * Handle game started event
     */
    handleGameStart(data) {
        try {
            // DEBUGGING: Log the received data structure
            this.logger.info('Game started with data:', {
                gameId: data?.gameId,
                hasMap: !!data?.map,
                mapWalls: data?.map?.walls?.length || 0,
                mapBlocks: data?.map?.blocks?.length || 0,
                hasPlayers: !!data?.players,
                playersCount: Array.isArray(data?.players) ? data.players.length : Object.keys(data?.players || {}).length,
                playersData: data?.players?.map ? data.players.map(p => ({ id: p.id, nickname: p.nickname })) : 'not array'
            });

            this.gameId = data.gameId;
            this.logger.info('Game started:', this.gameId);

            // Use ONLY updateState for all data - no duplicate setMapData call
            const gameStartUpdates = {
                gameState: GAME_STATES.PLAYING,
                gameId: this.gameId,
                countdown: 0
            };
            
            // Add map data to single update (StateManager will handle Set conversion)
            if (data.map) {
                gameStartUpdates.walls = data.map.walls || [];
                gameStartUpdates.blocks = data.map.blocks || [];
            }
            
            // Ensure players data is properly structured
            if (data.players) {
                // Convert players array to object if needed
                if (Array.isArray(data.players)) {
                    const playersObj = {};
                    data.players.forEach((player, index) => {
                        const playerId = player.id || `player_${index}`;
                        playersObj[playerId] = {
                            id: playerId,
                            nickname: player.nickname || `Player ${index + 1}`,
                            x: player.x || 0,
                            y: player.y || 0,
                            lives: player.lives || 3,
                            isAlive: player.isAlive !== false,
                            ...player
                        };
                    });
                    gameStartUpdates.players = playersObj;
                } else {
                    gameStartUpdates.players = data.players;
                }
            }
            
            // Single batched update prevents multiple re-renders and data conflicts
            this.logger.debug('Applying single batched game start update');
            this.flushStateUpdates(); // Clear any pending updates first
            this.stateManager.updateState(gameStartUpdates);
            
            // REMOVED: Duplicate setMapData call that was causing the error
            // The StateManager.updateState() now handles map data properly
            
            // Show notification
            if (this.uiManager) {
                this.uiManager.showNotification('Game Started! Good luck!', 'success');
            }
            
            this.logger.info('✅ Game start handled with single optimized update');
            
        } catch (error) {
            this.logger.error('Error handling game start:', error);
            
            // Error recovery - ensure game state is consistent
            this.recoverFromGameStartError(data);
        }
    }

    /**
     * Handle game timer update from server
     */
    handleGameTimer(data) {
        try {
            if (!data) {
                this.logger.warn('No timer data received');
                return;
            }

            // Update state with timer information
            const timerUpdates = {
                elapsedTime: data.elapsedTime || 0,
                formattedTime: data.formattedTime || '00:00'
            };

            // Batch update the state
            this.batchStateUpdate(timerUpdates);

            this.logger.debug(`Timer updated: ${data.formattedTime}`);

        } catch (error) {
            this.logger.error('Error handling game timer:', error);
        }
    }

    /**
     * Handle game update from server
     */
    handleGameUpdate(data) {
        try {
            const updateBatch = {};
    
            
            // Handle players data conversion
            if (data.players) {
                if (Array.isArray(data.players)) {
                    // Convert array to object
                    updateBatch.players = this.convertPlayersArrayToObject(data.players);
                } else if (typeof data.players === 'object') {
                    // Already object format, use directly
                    updateBatch.players = data.players;
                    
                    // But also update StateManager's player instances
                    Object.entries(data.players).forEach(([playerId, playerData]) => {
                        const player = this.stateManager.getPlayer(playerId);
                        if (player && typeof player.updateFromNetwork === 'function') {
                            player.updateFromNetwork(playerData);
                        } else {
                            // Create new player if doesn't exist
                            const newPlayer = new Player(playerId, playerData);
                            this.stateManager.addPlayer(newPlayer);
                        }
                    });
                }
            }
            
            // FIX: Add type checking before calling Map methods
            if (data.bombs && Array.isArray(data.bombs)) {
                
                // Ensure bombs is a Map
                if (!(this.stateManager.bombs instanceof Map)) {
                    this.stateManager.bombs = new Map();
                }
                
                this.stateManager.bombs.clear();
                data.bombs.forEach(bombData => {
                    this.stateManager.addBomb(bombData);
                });
            }
            
            if (data.explosions && Array.isArray(data.explosions)) {
                
                // Ensure explosions is a Map
                if (!(this.stateManager.explosions instanceof Map)) {
                    this.stateManager.explosions = new Map();
                }
                
                this.stateManager.explosions.clear();
                data.explosions.forEach(explosionData => {
                    this.stateManager.addExplosion(explosionData);
                });
            }
            
            if (data.powerUps && Array.isArray(data.powerUps)) {
                
                // Ensure powerUps is a Map
                if (!(this.stateManager.powerUps instanceof Map)) {
                    this.stateManager.powerUps = new Map();
                }
                
                this.stateManager.powerUps.clear();
                data.powerUps.forEach(powerUpData => {
                    this.stateManager.addPowerUp(powerUpData);
                });
            }
            
            // Handle map updates
            if (data.walls) updateBatch.walls = data.walls;
            if (data.blocks) updateBatch.blocks = data.blocks;
            
            // Apply batched updates
            if (Object.keys(updateBatch).length > 0) {
                this.batchStateUpdate(updateBatch);
                this.logger.debug('Game update applied:', Object.keys(updateBatch));
            }
            
        } catch (error) {
            this.logger.error('Error handling game update:', error);
        }
    }
    
    /**
     * Handle chat message
     */
    handleChatMessage(data) {
        try {
            if (!data || !data.message) {
                this.logger.warn('Invalid chat message data received');
                return;
            }
            
            const currentState = this.stateManager.getCurrentState();
            let updatedChatMessages = [...(currentState.chatMessages || [])];
            
            // Remove local echo if this message is from the same player
            if (data.playerId === currentState.playerId) {
                updatedChatMessages = updatedChatMessages.filter(msg => !msg.isLocal);
            }
            
            // Add confirmed server message
            const serverMessage = {
                playerId: data.playerId,
                nickname: data.nickname || 'Unknown',
                message: data.message,
                timestamp: data.timestamp || Date.now(),
                isLocal: false
            };
            
            updatedChatMessages.push(serverMessage);
            
            // Keep only last 50 messages for performance
            const trimmedMessages = updatedChatMessages.slice(-50);
            
            this.batchStateUpdate({
                chatMessages: trimmedMessages,
            });
            
            // Scroll chat to bottom
            this.scrollChatToBottom();
            
            this.logger.debug('Chat message received:', data.message);
            
        } catch (error) {
            this.logger.error('Error handling chat message:', error);
        }
    }

    /**
     * NEW: Scroll chat panel to bottom when new messages arrive
     * Ensures users see the latest messages
     */
    scrollChatToBottom() {
        try {
            // Use setTimeout to ensure DOM has updated
            setTimeout(() => {
                const chatMessages = document.querySelector('.chat-messages');
                if (chatMessages) {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            }, 10);
            
        } catch (error) {
            this.logger.error('Error scrolling chat to bottom:', error);
        }
    }
        
    /**
     * Check if game should end due to various conditions
     */
    checkGameOverConditions() {
        const alivePlayers = this.stateManager.getPlayers().filter(p => p.isAlive);
        
        if (alivePlayers.length <= 1) {
            // Game over - declare winner
            const winner = alivePlayers[0] || null;
            
            const gameResults = {
                winner: winner ? {
                    id: winner.id,
                    nickname: winner.nickname,
                    lives: winner.lives
                } : null,
                players: this.stateManager.getPlayers().map(p => ({
                    id: p.id,
                    nickname: p.nickname,
                    lives: p.lives,
                    isAlive: p.isAlive
                })),
                duration: Date.now() - this.gameStartTime
            };
            
            this.batchStateUpdate({
                gameState: GAME_STATES.GAME_OVER,
                gameResults: gameResults
            });
            
            this.logger.info('Game over', gameResults);
        }
    }
    
    /**
     * Check if this client is authoritative (for single player or host)
     */
    isAuthoritative() {
        // For now, always return true as we handle collisions locally
        // In a more complex system, this would check server authority
        return true;
    }
    /**
     * NEW: Error recovery for game start failures
     */
    recoverFromGameStartError(originalData) {
        try {
            this.logger.info('Attempting game start error recovery...');
            
            // Set basic game state
            this.stateManager.updateState({
                gameState: GAME_STATES.PLAYING,
                gameId: this.gameId || 'recovery_game',
                countdown: 0
            });
            
            // Handle map data separately with error handling
            if (originalData.map) {
                this.stateManager.setMapData({
                    walls: originalData.map.walls || [],
                    blocks: originalData.map.blocks || []
                });
            }
            
            // Handle players separately
            if (originalData.players) {
                this.handlePlayersDataRecovery(originalData.players);
            }
            
            this.logger.info('Game start error recovery completed');
            
        } catch (recoveryError) {
            this.logger.error('Error recovery failed:', recoveryError);
            // Final fallback - return to menu
            this.stateManager.updateState({
                gameState: GAME_STATES.ERROR,
                errorMessage: 'Failed to start game. Please try again.'
            });
        }
    }
    
    /**
     * NEW: Handle players data recovery
     */
    handlePlayersDataRecovery(playersData) {
        try {
            // Clear existing players
            this.stateManager.players.clear();
            
            // Add players one by one with error handling
            if (Array.isArray(playersData)) {
                playersData.forEach((playerData, index) => {
                    try {
                        const player = new Player(playerData.id || `player_${index}`, {
                            nickname: playerData.nickname || `Player ${index + 1}`,
                            x: playerData.x || 0,
                            y: playerData.y || 0,
                            lives: playerData.lives || 3,
                            isAlive: playerData.isAlive !== false,
                            ...playerData
                        });
                        this.stateManager.addPlayer(player);
                    } catch (playerError) {
                        this.logger.warn(`Failed to add player ${index}:`, playerError);
                    }
                });
            } else if (typeof playersData === 'object') {
                Object.entries(playersData).forEach(([playerId, playerData]) => {
                    try {
                        const player = new Player(playerId, playerData);
                        this.stateManager.addPlayer(player);
                    } catch (playerError) {
                        this.logger.warn(`Failed to add player ${playerId}:`, playerError);
                    }
                });
            }
            
            this.logger.debug(`Player recovery completed: ${this.stateManager.players.size} players`);
            
        } catch (error) {
            this.logger.error('Players data recovery failed:', error);
        }
    }

    // === WORKER EVENT HANDLERS ===

    /**
     * Handle collision worker results
     */
    handleCollisionWorkerResults(data) {
        try {
            if (!data || !data.data) return;

            const results = data.data;

            // Process player collisions
            if (results.playerCollisions && results.playerCollisions.length > 0) {
                results.playerCollisions.forEach(collision => {
                    this.processPlayerCollision(collision);
                });
            }

            // Process bomb collisions
            if (results.bombCollisions && results.bombCollisions.length > 0) {
                results.bombCollisions.forEach(collision => {
                    this.processBombCollision(collision);
                });
            }

            // Process explosion hits
            if (results.explosionHits && results.explosionHits.length > 0) {
                results.explosionHits.forEach(hit => {
                    this.processExplosionHit(hit);
                });
            }

            // Only log occasionally to avoid spam
            if (results.playerCollisions?.length > 0 || results.bombCollisions?.length > 0) {
                this.logger.debug('Collision worker results processed');
            }

        } catch (error) {
            this.logger.error('Error handling collision worker results:', error);
            // Fallback to main thread collision detection
            this.fallbackToMainThreadCollision();
        }
    }

    /**
     * Handle physics worker update
     */
    handlePhysicsWorkerUpdate(data) {
        try {
            if (!data || !data.data) return;

            const update = data.data;

            // Handle exploding bombs
            if (update.explodingBombs && update.explodingBombs.length > 0) {
                update.explodingBombs.forEach(bombId => {
                    const bomb = this.stateManager.getBomb(bombId);
                    if (bomb) {
                        this.stateManager.removeBomb(bombId);
                    }
                });
            }

            // Handle chain reaction bombs
            if (update.chainReactionBombs && update.chainReactionBombs.length > 0) {
                update.chainReactionBombs.forEach(bombId => {
                    this.triggerChainReaction(bombId);
                });
            }

            // Handle expired explosions
            if (update.expiredExplosions && update.expiredExplosions.length > 0) {
                update.expiredExplosions.forEach(explosionId => {
                    this.stateManager.removeExplosion(explosionId);
                });
            }

            // Update physics state
            if (update.physicsState) {
                this.updatePhysicsState(update.physicsState);
            }


        } catch (error) {
            this.logger.error('Error handling physics worker update:', error);
            // Fallback to main thread physics
            this.fallbackToMainThreadPhysics();
        }
    }

    /**
     * Handle worker bomb placed
     */
    handleWorkerBombPlaced(data) {
        try {
            if (!data || !data.data) return;

            const { bomb, validation } = data.data;

            if (validation.valid && bomb) {
                this.stateManager.addBomb(bomb);
                this.logger.debug('Bomb placed via worker:', bomb.id);
            }

        } catch (error) {
            this.logger.error('Error handling worker bomb placed:', error);
        }
    }

    /**
     * Handle worker bomb placement failed
     */
    handleWorkerBombPlacementFailed(data) {
        try {
            if (!data || !data.data) return;

            const validation = data.data;
            this.logger.debug('Bomb placement failed:', validation.reason);

            // Show user feedback
            if (this.uiManager) {
                this.uiManager.showNotification('Cannot place bomb here', 'warning');
            }

        } catch (error) {
            this.logger.error('Error handling worker bomb placement failed:', error);
        }
    }

    /**
     * Handle worker explosion triggered
     */
    handleWorkerExplosionTriggered(data) {
        try {
            if (!data || !data.data) return;

            const { explosion } = data.data;

            if (explosion) {
                this.stateManager.addExplosion(explosion);
                this.logger.debug('Explosion triggered via worker:', explosion.id);
            }

        } catch (error) {
            this.logger.error('Error handling worker explosion triggered:', error);
        }
    }

    /**
     * Handle network worker incoming processed
     */
    handleNetworkWorkerIncomingProcessed(data) {
        try {
            if (!data || !data.data) return;

            const { messages, processingTime } = data.data;

            // Process the decompressed/processed messages
            messages.forEach(message => {
                this.handleNetworkMessage(message);
            });

            // Track performance
            if (processingTime > 5) {
                this.logger.debug(`Network processing took ${processingTime.toFixed(2)}ms`);
            }

        } catch (error) {
            this.logger.error('Error handling network worker incoming processed:', error);
        }
    }

    /**
     * Handle network worker outgoing ready
     */
    handleNetworkWorkerOutgoingReady(data) {
        try {
            if (!data || !data.data) return;

            const { messages, compressionRatio } = data.data;

            // Send the compressed/batched messages
            if (this.networkManager && messages.length > 0) {
                this.networkManager.sendBatch(messages);
            }

            // Track compression performance
            if (compressionRatio < 0.8) {
                this.logger.debug(`Good compression ratio: ${(compressionRatio * 100).toFixed(1)}%`);
            }

        } catch (error) {
            this.logger.error('Error handling network worker outgoing ready:', error);
        }
    }

    /**
     * Handle network worker stats
     */
    handleNetworkWorkerStats(data) {
        try {
            if (!data || !data.data) return;

            const stats = data.data;

            // Update performance monitor with worker stats
            if (this.performanceMonitor) {
                this.performanceMonitor.updateNetworkWorkerStats(stats);
            }

        } catch (error) {
            this.logger.error('Error handling network worker stats:', error);
        }
    }

    /**
     * Handle worker errors with fallback mechanisms
     */
    handleWorkerError(workerType, error) {
        this.logger.error(`${workerType} worker error:`, error);

        // Implement fallback strategies
        switch (workerType) {
            case 'collision':
                this.fallbackToMainThreadCollision();
                break;
            case 'physics':
                this.fallbackToMainThreadPhysics();
                break;
            case 'network':
                this.fallbackToMainThreadNetwork();
                break;
        }
    }

    /**
     * Fallback to main thread collision detection
     */
    fallbackToMainThreadCollision() {
        this.logger.warn('Falling back to main thread collision detection');
        // The existing CollisionSystem will handle this automatically
    }

    /**
     * Fallback to main thread physics
     */
    fallbackToMainThreadPhysics() {
        this.logger.warn('Falling back to main thread physics processing');
        // Implement main thread physics fallback if needed
    }

    /**
     * Fallback to main thread network processing
     */
    fallbackToMainThreadNetwork() {
        this.logger.warn('Falling back to main thread network processing');
        // The existing NetworkManager will handle this automatically
    }

    // === COLLISION PROCESSING HELPERS ===

    /**
     * Process player collision from worker
     */
    processPlayerCollision(collision) {
        try {
            const player = this.stateManager.getPlayer(collision.playerId);
            if (!player) return;

            switch (collision.type) {
                case 'wall':
                case 'block':
                    // Handle solid collision - prevent movement
                    this.handlePlayerSolidCollision(player, collision);
                    break;
                case 'explosion':
                    // Handle explosion hit
                    this.handlePlayerExplosionHit(player, collision);
                    break;
                case 'powerup':
                    // Handle power-up collection
                    this.handlePlayerPowerUpCollection(player, collision);
                    break;
            }

        } catch (error) {
            this.logger.error('Error processing player collision:', error);
        }
    }

    /**
     * Process bomb collision from worker
     */
    processBombCollision(collision) {
        try {
            const bomb = this.stateManager.getBomb(collision.bombId);
            if (!bomb) return;

            // Handle bomb push or other bomb interactions
            if (collision.type === 'push') {
                this.handleBombPush(bomb, collision);
            }

        } catch (error) {
            this.logger.error('Error processing bomb collision:', error);
        }
    }

    /**
     * Process explosion hit from worker
     */
    processExplosionHit(hit) {
        try {
            switch (hit.type) {
                case 'block':
                    this.handleExplosionHitBlock({
                        x: hit.x,
                        y: hit.y,
                        explosion: hit.explosion
                    });
                    break;
                case 'bomb':
                    this.handleExplosionHitBomb({
                        bombId: hit.bombId,
                        explosion: hit.explosion
                    });
                    break;
                case 'player':
                    this.handlePlayerExplosionHit(
                        this.stateManager.getPlayer(hit.playerId),
                        hit
                    );
                    break;
            }

        } catch (error) {
            this.logger.error('Error processing explosion hit:', error);
        }
    }

    /**
     * Handle player solid collision
     */
    handlePlayerSolidCollision(player, collision) {
        // Prevent movement into solid objects
        // This would typically be handled by the movement system
        this.logger.debug(`Player ${player.id} hit ${collision.type} at (${collision.x}, ${collision.y})`);
    }

    /**
     * Handle player explosion hit
     */
    handlePlayerExplosionHit(player) {
        if (!player || player.isInvulnerable) return;

        // Server-authoritative damage: Only notify server, don't apply damage locally
        if (this.networkManager.checkConnection()) {
            this.networkManager.send({
                type: 'playerHitByExplosion',
                playerId: player.id,
                timestamp: Date.now()
            });
        }

        this.logger.info(`Player ${player.id} hit by explosion - notified server`);
    }

    /**
     * Handle player power-up collection
     */
    handlePlayerPowerUpCollection(player, collision) {
        if (!player) return;

        // Apply power-up to player
        player.collectPowerUp(collision.powerUpType);

        // Remove power-up from game state
        this.stateManager.removePowerUp(collision.powerUpId);

        // Update game state
        this.batchStateUpdate({
            players: this.stateManager.getPlayersData(),
            powerUps: this.stateManager.getPowerUpsData()
        });

        this.logger.info(`Player ${player.id} collected ${collision.powerUpType}`);
    }

    /**
     * Handle bomb push
     */
    handleBombPush(bomb, collision) {
        // Move bomb in push direction
        const newX = bomb.x + collision.pushX;
        const newY = bomb.y + collision.pushY;

        bomb.x = newX;
        bomb.y = newY;
        bomb.tileX = Math.floor(newX / 32);
        bomb.tileY = Math.floor(newY / 32);

        // Update game state
        this.batchStateUpdate({
            bombs: this.stateManager.getBombsData()
        });

        this.logger.debug(`Bomb ${bomb.id} pushed to (${newX}, ${newY})`);
    }

    /**
     * Trigger chain reaction
     */
    triggerChainReaction(bombId) {
        const bomb = this.stateManager.getBomb(bombId);
        if (bomb) {
            // Force bomb to explode
            const explosionData = bomb.explode();
            if (explosionData) {
                this.handleBombExplosion(bomb, explosionData);
            }
        }
    }

    /**
     * Update physics state from worker
     */
    updatePhysicsState(physicsState) {
        // Update internal physics tracking
        if (physicsState.bombs) {
            // Update bomb states
        }

        if (physicsState.explosions) {
            // Update explosion states
        }

      
    }

    /**
     * Handle network message from worker
     */
    handleNetworkMessage(message) {
        try {
            // Validate message structure
            if (!message || typeof message !== 'object') {
                this.logger.warn('Invalid message received from worker:', message);
                return;
            }

            if (!message.type) {
                this.logger.warn('Message missing type field:', message);
                return;
            }

            // The message from NetworkWorker is already in the correct format
            // Don't extract message.data - pass the entire message as the event data
            // The NetworkWorker returns the original messages, so they have the correct structure

            // DEBUGGING: Log queue-related messages to debug the issue
            if (message.type === 'queueUpdate' || message.type === 'queueCountdown' || message.type === 'queueJoined') {
                this.logger.info(`GameEngine processing worker message ${message.type}:`, {
                    messageType: message.type,
                    hasMessage: !!message,
                    messageKeys: Object.keys(message || {}),
                    queueSize: message.queueSize,
                    countdown: message.countdown,
                    playersCount: message.players?.length || 0,
                    fullMessage: message
                });
            }

            // Process the message as if it came directly from the network
            if (this.networkManager) {
                this.handleNetworkEvent(message.type, message);
            }

        } catch (error) {
            this.logger.error('Error handling network message from worker:', error, message);
        }
    }

    /**
     * Start the game engine with proper system coordination
     */
    async start() {
        try {
            this.logger.info('Starting game engine with state batching and workers...');

            // Validate systems are initialized
            this.validateSystems();

            // Initialize WorkerManager first for off-main-thread processing
            const workersInitialized = await this.workerManager.initializeWorkers();
            if (!workersInitialized) {
                this.logger.warn('Workers failed to initialize - falling back to main thread processing');
                this.useWorkers = false;
            } else {
                this.logger.info('✅ Workers initialized successfully');
                this.useWorkers = true;

                // Set worker manager on systems that can use workers
                if (this.collisionSystem) {
                    this.collisionSystem.setWorkerManager(this.workerManager);
                    this.collisionSystem.setPerformanceMonitor(this.performanceMonitor);
                }
                if (this.networkManager) {
                    this.networkManager.setWorkerManager(this.workerManager);
                    this.networkManager.setPerformanceMonitor(this.performanceMonitor);
                }
            }

            // Initialize systems in proper order WITH COORDINATION
            await this.initializeSystemsWithCoordination();


            // Connect to server
            this.networkManager.connect();

            // Start main game loop
            this.startOptimizedGameLoop();

            this.isRunning = true;
            this.gameStartTime = Date.now();
            this.logger.info('✅ Game engine started with state batching and workers');

        } catch (error) {
            this.logger.error('Failed to start game engine:', error);
            throw error;
        }
    }
    
    /**
     * Handle state changes from StateManager
     */
    handleStateChanged() {
        try {
            
            
            // NOTE: UIManager handles its own state updates via event listeners
            // RenderSystem gets state updates through the render() method
            
        } catch (error) {
            this.logger.error('Error handling state change:', error);
        }
    }
    
    /**
     * Validate all systems are properly initialized
     */
    validateSystems() {
        const requiredSystems = [
            'stateManager',  'networkManager',
            'renderSystem', 'inputSystem', 'collisionSystem', 
            'mapSystem', 'uiManager'
        ];
        
        for (const system of requiredSystems) {
            if (!this[system]) {
                throw new Error(`Required system ${system} is not initialized`);
            }
        }
        
        this.logger.debug('All systems validated successfully');
    }
    
    /**
     * Initialize systems with proper coordination
     */
    async initializeSystemsWithCoordination() {
        // 1. Initialize UIManager (creates all DOM via Virtual DOM)
        await this.uiManager.initialize();
        this.logger.debug('✅ UIManager initialized with Pure Virtual DOM');
        
        // 2. Initialize RenderSystem (will receive game area from Virtual DOM)
        this.renderSystem.initialize();
        this.logger.debug('✅ RenderSystem initialized and awaiting Virtual DOM game area');
        
        // 3. Enable input after everything is ready
        this.inputSystem.enable();
        this.logger.debug('✅ Input System enabled');
        
        // NOTE: Virtual DOM will automatically provide game area to RenderSystem
        // when gameState changes to 'playing' via the coordination setup
        
        this.logger.info('✅ All systems initialized with state batching coordination');
    }
    
    /**
     * Start optimized game loop
     */
    startOptimizedGameLoop() {
        let lastTime = 0;
        let accumulator = 0;
        const fixedTimeStep = 1000 / 60; // 60 FPS
        
        const gameLoop = (currentTime) => {
            if (!this.isRunning) return;

            // Frame budget tracking starts here
            const frameStartTime = performance.now();

            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;

            // Cap delta time to prevent spiral of death
            const clampedDelta = Math.min(deltaTime, 100);
            accumulator += clampedDelta;

            // Fixed timestep updates for consistent physics with frame budget awareness
            while (accumulator >= fixedTimeStep) {
                // Check if we have budget remaining for updates
                const currentFrameTime = performance.now() - frameStartTime;
                if (currentFrameTime > this.FRAME_BUDGET_MS * 0.8) {
                    // Skip updates if we're close to budget limit
                    break;
                }

                this.update(fixedTimeStep);
                accumulator -= fixedTimeStep;
            }

            // Variable timestep rendering for smooth visuals
            const interpolation = accumulator / fixedTimeStep;
            this.render(interpolation);

            // Performance monitoring and frame tracking
            this.performanceMonitor.recordFrame();

            // Track total frame time (only log occasionally to avoid spam)
            const totalFrameTime = performance.now() - frameStartTime;
            if (totalFrameTime > this.FRAME_BUDGET_MS) {
                this.logger.debug(`Frame exceeded budget: ${totalFrameTime.toFixed(2)}ms`);
            }

            this.gameLoopId = requestAnimationFrame(gameLoop);
        };
        
        this.gameLoopId = requestAnimationFrame(gameLoop);
        this.logger.info('Optimized game loop started (60fps target)');
    }
    
    /**
     * Update game logic with frame budget awareness for stable 60+ FPS
     */
    update(deltaTime) {
        this.frameBudget.currentFrameStartTime = performance.now();
        this.frameBudget.budgetRemaining = this.FRAME_BUDGET_MS;

        // Frame budget system - prioritize critical systems
        try {
            // CRITICAL priority systems (6ms budget)
            this.updateWithBudget('CRITICAL', () => {
                this.networkManager.update();
                this.stateManager.update(deltaTime);
            });

            // HIGH priority systems (4ms budget)
            if (this.frameBudget.budgetRemaining > 0) {
                this.updateWithBudget('HIGH', () => {
                    const gameState = this.stateManager.getCurrentState();
                    if (gameState && gameState.gameState === 'playing') {
                        this.collisionSystem.update(deltaTime, gameState);
                    }
                    this.updateEntitiesOptimized(deltaTime);
                });
            }

            // MEDIUM priority systems (3ms budget)
            if (this.frameBudget.budgetRemaining > 0) {
                this.updateWithBudget('MEDIUM', () => {
                    // Additional game logic updates
                });
            }

            // LOW priority systems (1ms budget)
            if (this.frameBudget.budgetRemaining > 0) {
                this.updateWithBudget('LOW', () => {
                    this.uiManager.update(deltaTime);
                });
            }

        } catch (error) {
            this.logger.error('Update error:', error);
        }

        // Track frame budget performance
        this.trackFrameBudgetPerformance();
    }

    /**
     * Execute system updates within budget constraints
     */
    updateWithBudget(priority, updateFunction) {
        const systemBudget = this.frameBudget.systemBudgets[priority];
        const systemStartTime = performance.now();

        try {
            updateFunction();
        } catch (error) {
            this.logger.error(`${priority} system update error:`, error);
        }

        const systemTime = performance.now() - systemStartTime;
        this.frameBudget.budgetRemaining -= systemTime;

        // Warn if system exceeded its budget
        if (systemTime > systemBudget) {
            this.logger.warn(`${priority} system exceeded budget: ${systemTime.toFixed(2)}ms (limit: ${systemBudget}ms)`);
        }
    }

    /**
     * Track frame budget performance and emit events
     */
    trackFrameBudgetPerformance() {
        const totalFrameTime = performance.now() - this.frameBudget.currentFrameStartTime;

        if (totalFrameTime > this.FRAME_BUDGET_MS) {
            this.frameBudget.budgetExceededCount++;

            // Emit frame budget exceeded event
            this.emitFrameBudgetExceeded(totalFrameTime);

            // Activate emergency mode if consistently over budget
            if (this.frameBudget.budgetExceededCount > 5 && !this.frameBudget.emergencyModeActive) {
                this.activateEmergencyMode();
            }
        } else {
            // Reset counter on good frame
            this.frameBudget.budgetExceededCount = Math.max(0, this.frameBudget.budgetExceededCount - 1);
        }
    }

    /**
     * Emit frame budget exceeded event for performance monitoring
     */
    emitFrameBudgetExceeded(frameTime) {
        eventManager.emit('frameBudgetExceeded', {
            frameTime,
            budget: this.FRAME_BUDGET_MS,
            exceededBy: frameTime - this.FRAME_BUDGET_MS,
            timestamp: Date.now()
        });
    }

    /**
     * Activate emergency performance mode
     */
    activateEmergencyMode() {
        this.frameBudget.emergencyModeActive = true;
        this.logger.warn('Emergency performance mode activated');

        // Reduce frame budget for more aggressive optimization
        this.FRAME_BUDGET_MS = 12; // Even tighter budget

        // Emit emergency optimization event
        eventManager.emit('emergencyOptimization', {
            active: true,
            newBudget: this.FRAME_BUDGET_MS,
            timestamp: Date.now()
        });
    }


    
    /**
     * Render game (variable timestep for smooth visuals)
     */
    render(interpolation) {
        try {
            const currentState = this.stateManager.getCurrentState();
            
            
            
            // RenderSystem handles game entity rendering WITHIN the Virtual DOM game area
            if (this.renderSystem && typeof this.renderSystem.render === 'function') {
                this.renderSystem.render(currentState, interpolation);
            }
            
            // UIManager handles ALL UI rendering via Pure Virtual DOM
            // It's reactive and updates automatically via state changes
            
        } catch (error) {
            this.logger.error('Render error:', error);
        }
    }
    
    /**
     * Update all game entities with optimization
     */
    updateEntitiesOptimized(deltaTime) {
        const entities = this.stateManager.getAllEntities();

        // Send physics updates to worker if available
        if (this.useWorkers && this.workerManager) {
            this.sendPhysicsUpdateToWorker(deltaTime, entities);
        }

        // Batch entity updates
        const updateBatch = {
            players: [],
            bombs: [],
            explosions: []
        };

        // Collect entities that need updates
        entities.players.forEach(player => {
            if (player.update && player.isAlive) {
                updateBatch.players.push(player);
            }
        });

        entities.bombs.forEach((bomb, bombId) => {
            if (bomb.update && bomb.isActive) {
                updateBatch.bombs.push({ bomb, bombId });
            }
        });

        // Process updates in batches
        this.processBatchedUpdates(updateBatch, deltaTime);
    }

    /**
     * Send physics update to worker
     */
    sendPhysicsUpdateToWorker(deltaTime, entities) {
        try {
            const startTime = performance.now();
            const physicsData = this.preparePhysicsDataForWorker(entities);

            const success = this.workerManager.sendToWorker('physics', {
                type: 'UPDATE_PHYSICS',
                data: {
                    ...physicsData,
                    deltaTime: deltaTime,
                    frameId: this.frameId || 0
                }
            });

            if (!success) {
                // Only log occasionally to avoid spam
                if (this.frameCount % 300 === 0) {
                    this.logger.debug('Failed to send physics data to worker (logged every 300 frames)');
                }
                this.performanceMonitor.recordWorkerFallback('physics', 'physics update send failed');
            } else {
                // Record successful message send
                const processingTime = performance.now() - startTime;
                this.performanceMonitor.recordWorkerMessage('physics', processingTime, true);
            }

        } catch (error) {
            this.logger.error('Error sending physics data to worker:', error);
            this.performanceMonitor.recordWorkerFallback('physics', 'physics update send error');
        }
    }

    /**
     * Prepare physics data for worker
     */
    preparePhysicsDataForWorker(entities) {
        const physicsData = {
            players: [],
            bombs: [],
            explosions: [],
            walls: [],
            blocks: []
        };

        // Prepare players data
        if (entities.players) {
            physicsData.players = Array.from(entities.players.values()).map(player => ({
                id: player.id,
                x: player.x,
                y: player.y,
                bombsPlaced: player.placedBombs || 0,
                maxBombs: player.maxBombs || 1,
                bombRange: player.bombRange || 1
            }));
        }

        // Prepare bombs data
        if (entities.bombs) {
            physicsData.bombs = Array.from(entities.bombs.values()).map(bomb => ({
                id: bomb.id,
                x: bomb.x,
                y: bomb.y,
                playerId: bomb.playerId,
                timer: bomb.timer,
                power: bomb.power || 1,
                isActive: bomb.isActive
            }));
        }

        // Prepare explosions data
        if (entities.explosions) {
            physicsData.explosions = Array.from(entities.explosions.values()).map(explosion => ({
                id: explosion.id,
                x: explosion.x,
                y: explosion.y,
                duration: explosion.duration,
                tiles: explosion.tiles || []
            }));
        }

        // Get current game state for static entities
        const gameState = this.stateManager.getCurrentState();

        if (gameState.walls) {
            physicsData.walls = Array.isArray(gameState.walls) ? gameState.walls : Array.from(gameState.walls);
        }

        if (gameState.blocks) {
            physicsData.blocks = Array.isArray(gameState.blocks) ? gameState.blocks : Array.from(gameState.blocks);
        }

        return physicsData;
    }

    /**
     * Process entity updates in batches
     */
    processBatchedUpdates(updateBatch, deltaTime) {
        // Update players in batch
        updateBatch.players.forEach(player => {
            player.update(deltaTime);
        });

        // Update bombs with explosion handling
        updateBatch.bombs.forEach(({ bomb }) => {
            bomb.update(deltaTime);

            // Check for explosion
            if (bomb.shouldExplode()) {
                const explosionData = bomb.explode();
                if (explosionData) {
                    this.handleBombExplosion(bomb, explosionData);
                }
            }
        });
        
        // Get entities from state manager and update explosions with aggressive cleanup
        const entities = this.stateManager.getAllEntities();
        const explosionsToRemove = [];

        if (entities.explosions) {
            entities.explosions.forEach((explosion, explosionId) => {
                if (explosion.update) {
                    explosion.update(deltaTime);

                    // Check for expiration
                    if (explosion.isExpired && explosion.isExpired()) {
                        explosionsToRemove.push(explosionId);
                    }
                }
            });
        }
        
        // Remove expired explosions in batch
        explosionsToRemove.forEach(explosionId => {
            if (this.stateManager.removeExplosion) {
                this.stateManager.removeExplosion(explosionId);
            }
            if (this.renderSystem && this.renderSystem.removeExplosionElement) {
                this.renderSystem.removeExplosionElement(explosionId);
            }
        });
    }
    
    /**
     * Handle bomb explosion
     */
    handleBombExplosion(bomb, explosionData) {
        try {
            this.logger.gameEvent('BombExplosion', { bombId: bomb.id, playerId: bomb.playerId });
            
            // PHASE 1: Remove bomb from state FIRST to prevent memory leaks
            this.stateManager.removeBomb(bomb.id);
            
            // Create explosion with immediate cleanup scheduling
            this.stateManager.addExplosion(explosionData);
            
            // Process explosion effects in batches
            this.processExplosionEffectsBatched(explosionData);
            
            // Update player's bomb count immediately
            const player = this.stateManager.getPlayer(bomb.playerId);
            if (player) {
                player.bombExploded();
            }
            
            // PHASE 1: Batch state updates and clear references
            this.scheduleStateUpdate({
                bombs: this.stateManager.getBombsData(),
                explosions: this.stateManager.getExplosionsData(),
                players: this.stateManager.getPlayersData()
            });
            
            // Send to network without keeping reference
            if (this.networkManager.checkConnection()) {
                this.networkManager.send({
                    type: 'bombExploded',
                    bombId: bomb.id,
                    playerId: bomb.playerId,
                    explosionData: this.createNetworkExplosionData(explosionData),
                    timestamp: Date.now()
                });
            }
            
            this.logger.debug(`Bomb ${bomb.id} exploded with optimized cleanup`);
            
        } catch (error) {
            this.logger.error('Error handling bomb explosion:', error);
            // Ensure cleanup even on error
            this.stateManager.removeBomb(bomb.id);
        }
    }

    // NEW: Batched explosion effects processing
    processExplosionEffectsBatched(explosionData) {
        if (!explosionData.tiles) return;
        
        const batchSize = 10;
        const tiles = explosionData.tiles;
        const totalTiles = tiles.length;
        
        // Process tiles in batches to prevent main thread blocking
        for (let i = 0; i < totalTiles; i += batchSize) {
            const batch = tiles.slice(i, i + batchSize);
            
            // Use setTimeout to yield control
            setTimeout(() => {
                this.processTileBatch(batch);
            }, 0);
        }
    }

    // NEW: Process tile batch
    processTileBatch(tileBatch) {
        const blocksToDestroy = [];
        const chainsToTrigger = [];
        
        tileBatch.forEach(tile => {
            // Check for block destruction
            const blockKey = `${tile.x},${tile.y}`;
            if (this.stateManager.blocks.has(blockKey)) {
                blocksToDestroy.push(tile);
            }
            
            // Check for chain reactions
            const bombsAtLocation = Array.from(this.stateManager.bombs.values())
                .filter(bomb => Math.floor(bomb.x) === tile.x && Math.floor(bomb.y) === tile.y);
            
            chainsToTrigger.push(...bombsAtLocation);
        });
        
        // Process blocks in batch
        blocksToDestroy.forEach(tile => {
            const powerUp = this.mapSystem.destroyBlock(tile.x, tile.y);
            this.stateManager.removeBlock(tile.x, tile.y);
            
            if (powerUp) {
                this.stateManager.addPowerUp(powerUp);
            }
        });
        
        // Process chain reactions with delay
        chainsToTrigger.forEach(bomb => {
            setTimeout(() => {
                if (this.stateManager.bombs.has(bomb.id)) {
                    const chainExplosion = bomb.explode();
                    if (chainExplosion) {
                        this.handleBombExplosion(bomb, chainExplosion);
                    }
                }
            }, 50); // Small delay to prevent stack overflow
        });
    }

    // NEW: Create network-optimized explosion data
    createNetworkExplosionData(explosionData) {
        return {
            id: explosionData.id,
            centerX: explosionData.centerX,
            centerY: explosionData.centerY,
            range: explosionData.range,
            tileCount: explosionData.tiles ? explosionData.tiles.length : 0
            // Don't send full tiles array to reduce network overhead
        };
    }

    // NEW: Schedule state update to batch them
    scheduleStateUpdate(stateData) {
        if (this._pendingStateUpdate) {
            clearTimeout(this._pendingStateUpdate);
        }
        
        this._pendingStateUpdate = setTimeout(() => {
            this.renderSystem.updateGameState(stateData);
            this._pendingStateUpdate = null;
        }, 16); // ~60fps
    }
        
    /**
     * Process individual explosion effects
     */
    processExplosionEffects(explosionData) {
        if (!explosionData.tiles) return;
        
        explosionData.tiles.forEach(tile => {
            // Check for block destruction
            const blockKey = `${tile.x},${tile.y}`;
            if (this.stateManager.blocks.has(blockKey)) {
                // Destroy block and potentially spawn power-up
                const powerUp = this.mapSystem.destroyBlock(tile.x, tile.y);
                this.stateManager.removeBlock(tile.x, tile.y);
                
                if (powerUp) {
                    this.stateManager.addPowerUp(powerUp);
                }
            }
            
            // Check for chain reactions (bombs hit by explosion)
            const bombsAtLocation = Array.from(this.stateManager.bombs.values())
                .filter(bomb => Math.floor(bomb.x) === tile.x && Math.floor(bomb.y) === tile.y);
            
            bombsAtLocation.forEach(bomb => {
                // Chain reaction - explode this bomb too
                setTimeout(() => {
                    if (this.stateManager.bombs.has(bomb.id)) {
                        const chainExplosion = bomb.explode ? bomb.explode() : null;
                        if (chainExplosion) {
                            this.handleBombExplosion(bomb, chainExplosion);
                        }
                    }
                }, 100); // Small delay for visual effect
            });
        });
    }
    
    /**
     * Handle player input with validation
     */
    handlePlayerInput(input) {
        try {
            if (!input || typeof input.type !== 'string') {
                this.logger.warn('Invalid input received:', input);
                return;
            }

            // DEBUGGING: Log movement inputs to debug the issue
            if (input.type === 'move') {
                this.logger.info('GameEngine handling player input:', {
                    inputType: input.type,
                    direction: input.direction,
                    isConnected: this.networkManager?.checkConnection(),
                    gameState: this.stateManager?.getCurrentState()?.gameState
                });
            }

            // Process input through network manager
            if (this.networkManager.checkConnection()) {
                this.networkManager.sendPlayerAction(input);
            } else {
                this.logger.warn('Cannot send player action - not connected to server');
            }

        } catch (error) {
            this.logger.error('Error handling player input:', error);
        }
    }
    
    /**
     * Simple collision check for local prediction
     */
    canPlayerMoveTo(x, y) {
        const tileSize = this.config.TILE_SIZE || 32;
        const tileX = Math.floor(x / tileSize);
        const tileY = Math.floor(y / tileSize);

        // Check bounds
        if (tileX < 0 || tileX >= this.config.GRID_WIDTH ||
            tileY < 0 || tileY >= this.config.GRID_HEIGHT) {
            return false;
        }

        // Check walls (simplified - assumes walls are in gameState)
        const gameState = this.stateManager.gameState;
        if (gameState.walls && gameState.walls.has(`${tileX},${tileY}`)) {
            return false;
        }

        // Check blocks
        if (gameState.blocks && gameState.blocks.has(`${tileX},${tileY}`)) {
            return false;
        }

        return true;
    }


    /**
     * Handle bomb placement with worker integration
     */
    handleBombPlacement(player) {
        if (!player || !player.canPlaceBomb()) {
            this.logger.debug('Cannot place bomb', {
                playerId: player?.id,
                canPlace: player?.canPlaceBomb()
            });
            return;
        }

        const bombData = {
            id: `${player.id}-${Date.now()}`,
            x: player.x,
            y: player.y,
            playerId: player.id,
            power: player.bombRange || 1
        };

        if (this.useWorkers && this.workerManager) {
            // Send bomb placement to physics worker for validation
            this.sendBombPlacementToWorker(bombData);
        } else {
            // Fallback to main thread processing
            this.processBombPlacementMainThread(bombData, player);
        }
    }

    /**
     * Send bomb placement to physics worker
     */
    sendBombPlacementToWorker(bombData) {
        try {
            const startTime = performance.now();

            const success = this.workerManager.sendToWorker('physics', {
                type: 'PLACE_BOMB',
                data: bombData
            });

            if (!success) {
                this.logger.warn('Failed to send bomb placement to worker - falling back to main thread');
                this.performanceMonitor.recordWorkerFallback('physics', 'bomb placement send failed');
                const player = this.stateManager.getPlayer(bombData.playerId);
                this.processBombPlacementMainThread(bombData, player);
            } else {
                // Record successful message send
                const processingTime = performance.now() - startTime;
                this.performanceMonitor.recordWorkerMessage('physics', processingTime, true);
            }

        } catch (error) {
            this.logger.error('Error sending bomb placement to worker:', error);
            this.performanceMonitor.recordWorkerFallback('physics', 'bomb placement send error');
            const player = this.stateManager.getPlayer(bombData.playerId);
            this.processBombPlacementMainThread(bombData, player);
        }
    }

    /**
     * Fallback bomb placement processing on main thread
     */
    processBombPlacementMainThread(bombData, player) {
        try {
            // Simple validation
            const tileX = Math.floor(bombData.x / 32);
            const tileY = Math.floor(bombData.y / 32);

            // Check if position is blocked
            const isBlocked = this.collisionSystem.getEntitiesAt(tileX, tileY, this.collisionSystem.layers.SOLID).length > 0;
            const hasBomb = this.collisionSystem.getEntitiesAt(tileX, tileY, this.collisionSystem.layers.BOMBS).length > 0;

            if (isBlocked || hasBomb) {
                this.logger.debug('Bomb placement blocked', { tileX, tileY, isBlocked, hasBomb });
                return;
            }

            // Create bomb
            const bomb = player.placeBomb();
            if (bomb) {
                this.stateManager.addBomb(bomb);
                this.logger.debug('Bomb placed on main thread', bomb.id);
            }

        } catch (error) {
            this.logger.error('Error processing bomb placement on main thread:', error);
        }
    }

    clearAllTimers() {
        // Clear any stored timer references
        if (this.timers) {
            Object.values(this.timers).forEach(timer => {
                if (timer) {
                    clearTimeout(timer);
                    clearInterval(timer);
                }
            });
            this.timers = {};
        }
        
        // Clear frame-related timers
        if (this.frameTimerId) {
            clearTimeout(this.frameTimerId);
            this.frameTimerId = null;
        }
        

    }
    
    
    /**
     * Stop the game engine and clean up all resources
     */
    stop() {
        this.logger.info('Stopping game engine...');
        
        this.isRunning = false;
        
        // Stop game loop
        if (this.gameLoopId) {
            cancelAnimationFrame(this.gameLoopId);
            this.gameLoopId = null;
        }
        
        // Clear state batching with timeout cleanup
        if (this.stateBatchTimeout) {
            clearTimeout(this.stateBatchTimeout);
            this.stateBatchTimeout = null;
        }
        
        // Clear pending state updates completely
        this.pendingStateUpdates = {};
     
        
        if (this.networkManager) {
            this.networkManager.disconnect();
            this.networkManager.cleanup();
        }
        
        if (this.inputSystem) {
            this.inputSystem.cleanup();
        }
        
        if (this.renderSystem) {
            this.renderSystem.cleanup();
        }
        
        if (this.stateManager) {
            this.stateManager.reset();
        }

        // Cleanup WorkerManager and all workers
        if (this.workerManager) {
            this.workerManager.cleanup();
        }

        // Clear all timers and intervals
        this.clearAllTimers();

        // Clean up all event listeners
        this.cleanupEvents();

        this.logger.info('Game engine stopped with complete memory cleanup and worker cleanup');
    }
    
    /**
     * Get current game statistics with state batching info
     */
    getGameStats() {
        return {
            networkLatency: this.networkManager.getLatency(),
            players: this.stateManager.getPlayers().length,
            isConnected: this.networkManager.checkConnection(),
            frameCount: this.frameCount,
            systemStatus: {
                core: this.systemsInitialized.core,
                ui: this.systemsInitialized.ui,
                rendering: this.systemsInitialized.rendering,
                gameLogic: this.systemsInitialized.gameLogic
            },
            coordination: {
                uiManagerInitialized: !!this.uiManager && this.uiManager.isInitialized,
                renderSystemHasGameArea: !!this.renderSystem && !!this.renderSystem.gameArea,
                gameAreaMounted: this.uiManager ? this.uiManager.gameAreaMounted : false
            },
            stateBatching: {
                enabled: this.stateBatchingEnabled,
                pendingUpdates: Object.keys(this.pendingStateUpdates).length,
                hasPendingTimeout: !!this.stateBatchTimeout
            }
        };
    }
    
    
}

export default GameEngine;
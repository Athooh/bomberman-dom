// src/ui/UIManager.js
// User interface management and rendering coordination

import { GAME_STATES, GAME_CONFIG, EVENT_TYPES} from '../utils/Constants.js';
import { Logger } from '../utils/Logger.js';
import { createApp, h } from '../easy-api.js';

/**
 * UI Manager - Duplicate Notifications Edition
 */
export class UIManager {
    constructor(stateManager) {
        this.logger = new Logger('UIManager');
        this.stateManager = stateManager;
        
        // UI components
        this.app = null;
        this.currentScreen = null;
        this.isInitialized = false;
        
        // DOM CONTROL - UIManager owns the main container
        this.gameContainer = null;
        
        // Game area tracking for render optimization
        this.gameAreaMounted = false;
        this.lastNotifiedGameArea = null;
        this.gameAreaNotificationCount = 0;
        this.pendingGameAreaNotification = false;
        
        // UI state
        this.uiState = {
            nickname: '',
            currentChatMessage: '',
            showDebugInfo: false,
            notifications: []
        };
        
        // Event callback for game engine communication
        this.onEvent = null;
        this.onGameAreaCreated = null; // Callback for RenderSystem
        
        this.logger.info('UI Manager created - with duplicate notification prevention');
    }
    
    /**
     * Initialize UI system
     */
    async initialize() {
        this.logger.info('Initializing UI system with duplicate notification prevention...');
        
        try {
            // Step 1: Verify CSS is loaded
            this.verifyCSSLoaded();
            
            // Step 2: Create main game container
            this.createMainGameContainer();
            
            // Step 3: Create UI app framework within our container
            this.app = createApp({
                container: this.gameContainer,
                state: {
                    gameState: GAME_STATES.NICKNAME,
                    ...this.uiState,
                    ...this.getInitialGameState()
                },
                debug: false
            });
            
            // Step 4: Setup rendering
            this.app.render((state) => this.renderCurrentScreen(state));
            
            // Step 5: Start UI app
            this.app.start();
            
            // Step 6: Setup event listeners
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.logger.info('✅ UI system initialized with duplicate notification prevention!');
            
        } catch (error) {
            this.logger.error('Failed to initialize UI system:', error);
            throw error;
        }
    }
    
    /**
     * Verify that CSS is properly loaded
     */
    verifyCSSLoaded() {
        // Check if styles.css rules are available
        const testElement = document.createElement('div');
        testElement.className = 'bomberman-game-container';
        testElement.style.visibility = 'hidden';
        testElement.style.position = 'absolute';
        testElement.style.top = '-9999px';
        
        document.body.appendChild(testElement);
        
        // Check computed styles
        const computedStyle = window.getComputedStyle(testElement);
        
        document.body.removeChild(testElement);
        
        // Verify key CSS properties are applied
        if (computedStyle.position !== 'fixed') {
            this.logger.warn('⚠️ CSS may not be fully loaded - game container styles not applied');
            this.logger.warn('Make sure styles.css is included in your HTML file');
        } else {
            this.logger.info('✅ External CSS verified and loaded');
        }
    }
    
    /**
     * CREATE MAIN GAME CONTAINER - UIManager controls the root DOM
     */
    createMainGameContainer() {
        // Create the main game container that holds everything
        this.gameContainer = document.createElement('div');
        this.gameContainer.id = 'bomberman-game-container';
        this.gameContainer.className = 'bomberman-game-container';
        
        // Add to document body
        document.body.appendChild(this.gameContainer);
        
        this.logger.info('Main game container created by UIManager (styled via CSS)');
    }
    
    /**
     * Get initial game state for UI
     */
    getInitialGameState() {
        return {
            isConnected: false,
            playerId: null,
            queueSize: 0,
            waitingPlayers: [],
            countdown: 0,
            players: {},
            chatMessages: [],
            gameResults: null,
            fps: 60,
            errorMessage: null
        };
    }
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen to state changes from state manager
        this.stateManager.on(EVENT_TYPES.STATE_CHANGED, (newState) => {
            this.handleStateChange(newState);
        });
        
        // Listen to specific game events
        this.stateManager.on('playerJoined', (player) => {
            this.showNotification(`${player.nickname} joined the game`, 'info');
        });
        
        this.stateManager.on('playerLeft', (player) => {
            this.showNotification(`${player.nickname} left the game`, 'warning');
        });
        
        // Network events
        this.stateManager.on('connected', () => {
            this.showNotification('Connected to server', 'success');
        });
        
        this.stateManager.on('disconnected', () => {
            this.showNotification('Disconnected from server', 'error');
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });
        
        this.logger.debug('Event listeners setup complete');
    }

    /**
     * Update connection state
     */
    updateConnectionState(isConnected, connectionState) {
        // Update internal UI state
        this.uiState.isConnected = isConnected;
        this.uiState.connectionState = connectionState;
        
        // Update the app state to trigger re-render
        if (this.app) {
            this.app.setState({
                isConnected: isConnected,
                connectionState: connectionState
            });
        }
        
        // Log for debugging
        this.logger.debug(`UI connection state updated: ${connectionState} (connected: ${isConnected})`);
    }
    
    /**
     * Handle keyboard shortcuts
     */
    handleKeyboardShortcuts(event) {
        // Don't interfere with input fields
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }
        
        switch (event.key) {
            case 'F1':
                event.preventDefault();
                this.toggleDebugInfo();
                break;
                
            case 'Escape':
                event.preventDefault();
                this.handleEscapeKey();
                break;
        }
    }
    
    /**
     * Handle state changes with optimized batching and deduplication
     */
    handleStateChange(newState) {
        if (!this.isInitialized) return;
        
        try {
            const currentState = this.app.getState();
            const oldGameState = currentState?.gameState;
            const newGameState = newState?.gameState;
            
            // Detect screen transitions for optimized rendering
            if (oldGameState !== newGameState && newGameState) {
                console.log(`🔄 SCREEN_TRANSITION - ${oldGameState} → ${newGameState}`);

                // Force complete re-render for screen transitions
                this.forceCompleteRerender(newState, newGameState);
                return;
            }
            
            // Normal state update for non-screen changes
            this.handleNormalStateUpdate(newState);
            
        } catch (error) {
            this.logger.error('Error updating UI state:', error);
        }
    }
    
    /**
     * Force complete re-render for screen transitions
     */
    forceCompleteRerender(newState, newGameState) {
        console.log(`🔄 FORCE_RERENDER - Cleaning screen for ${newGameState}`);
        
        // Clear the container completely
        if (this.gameContainer) {
            this.gameContainer.innerHTML = '';
        }
        
        // Create fresh app state
        const freshState = {
            gameState: newGameState,
            ...this.buildStateUpdates(newState),
            ...this.uiState
        };
        
        // Recreate the DOM from scratch
        if (this.app) {
            // Stop current app
            this.app.stop();
            
            // Create new app instance
            this.app = createApp({
                container: this.gameContainer,
                state: freshState,
                debug: false
            });
            
            // Setup rendering
            this.app.render((state) => this.renderCurrentScreen(state));
            this.app.start();
            
            console.log(`✅ CLEAN_RERENDER - ${newGameState} screen created fresh`);
        }
        
        // Reset game area flags for new screen
        if (newGameState === GAME_STATES.PLAYING) {
            this.gameAreaMounted = false;
            this.lastNotifiedGameArea = null;
            this.scheduleGameAreaNotification();
        }
    }

    handleNormalStateUpdate(newState) {
        // Check for game state transition to playing
        if (newState.gameState === GAME_STATES.PLAYING && !this.gameAreaMounted) {
            this.logger.debug('Game state changed to playing, scheduling game area notification');
            this.scheduleGameAreaNotification();
        }
        
        // Build and apply normal updates
        const stateUpdates = this.buildStateUpdates(newState);
        this.app.setState(stateUpdates);
        
        this.logger.debug('UI state updated for game state:', newState.gameState);
    }
    
    
    /**
     * Build batched state updates to reduce Virtual DOM re-renders
     */
    buildStateUpdates(newState) {
        const updates = {};
        
        // Only include changed values
        if (newState.gameState !== undefined) updates.gameState = newState.gameState;
        if (newState.nickname !== undefined) updates.nickname = newState.nickname || this.uiState.nickname;
        if (newState.isConnected !== undefined) updates.isConnected = newState.isConnected;
        if (newState.playerId !== undefined) updates.playerId = newState.playerId;
        if (newState.queueSize !== undefined) updates.queueSize = newState.queueSize;
        if (newState.waitingPlayers !== undefined) updates.waitingPlayers = newState.waitingPlayers;
        if (newState.countdown !== undefined) updates.countdown = newState.countdown;
        if (newState.players !== undefined) updates.players = newState.players;
        if (newState.chatMessages !== undefined) updates.chatMessages = newState.chatMessages;
        if (newState.gameResults !== undefined) updates.gameResults = newState.gameResults;
        if (newState.fps !== undefined) updates.fps = newState.fps;
        if (newState.errorMessage !== undefined) updates.errorMessage = newState.errorMessage;
        
        return updates;
    }
    
    /**
     * Schedule game area notification with deduplication
     */
    scheduleGameAreaNotification() {
        // Prevent multiple pending notifications
        if (this.pendingGameAreaNotification) {
            this.logger.debug('Game area notification already pending, skipping duplicate');
            return;
        }
        
        this.pendingGameAreaNotification = true;
        
        // Use requestAnimationFrame for better timing
        requestAnimationFrame(() => {
            this.notifyGameAreaMounted();
            this.pendingGameAreaNotification = false;
        });
    }
    
    /**
     * Notify RenderSystem with deduplication logic
     */
    notifyGameAreaMounted() {
        const gameArea = document.getElementById('game-area');
        
        if (!gameArea) {
            this.logger.debug('Game area not found in DOM, retrying...');
            // Retry with exponential backoff
            setTimeout(() => {
                if (!this.gameAreaMounted) {
                    this.notifyGameAreaMounted();
                }
            }, 16); // Next frame
            return;
        }
        
        // Check if this is the same element we already notified about
        if (this.lastNotifiedGameArea === gameArea && this.gameAreaMounted) {
            this.logger.debug('Game area already notified (same element), skipping duplicate notification');
            return;
        }
        
        // Track which game area element we're notifying about
        this.lastNotifiedGameArea = gameArea;
        this.gameAreaMounted = true;
        this.gameAreaNotificationCount++;
        
        this.logger.info(`✅ Game area mounted and providing to RenderSystem (notification #${this.gameAreaNotificationCount})`);
        
        // Notify RenderSystem
        if (this.onGameAreaCreated) {
            try {
                this.onGameAreaCreated(gameArea);
                this.logger.info('✅ RenderSystem notified successfully');
            } catch (error) {
                this.logger.error('Error notifying RenderSystem:', error);
                // Reset flags so we can retry
                this.gameAreaMounted = false;
                this.lastNotifiedGameArea = null;
            }
        } else {
            this.logger.warn('No game area callback registered');
        }
    }
    
    /**
     * Render current screen based on game state
     */
    renderCurrentScreen(state) {
        try {
            switch (state.gameState) {
                case GAME_STATES.NICKNAME:
                    return this.renderNicknameScreen(state);
                case GAME_STATES.MENU:
                    return this.renderMenuScreen(state);
                case GAME_STATES.QUEUE:
                    return this.renderQueueScreen(state);
                case GAME_STATES.LOBBY:
                    return this.renderLobbyScreen(state);
                case GAME_STATES.PLAYING:
                    return this.renderPlayingScreen(state);
                case GAME_STATES.GAME_OVER:
                    return this.renderGameOverScreen(state);
                case GAME_STATES.ERROR:
                    return this.renderErrorScreen(state);
                default:
                    return this.renderLoadingScreen(state);
            }
        } catch (error) {
            this.logger.error('Error rendering screen:', error);
            return this.renderErrorScreen({ errorMessage: 'UI rendering error' });
        }
    }
    
    /**
     * Render playing screen with game area included in Virtual DOM
     */
    renderPlayingScreen(state) {
        return h('div', { className: 'playing-screen' }, [
            // Game area is now part of the Virtual DOM (styled via CSS)
            h('div', { 
                id: 'game-area',
                className: 'game-area'
            }),
            
            // HUD Overlays (rendered on top of game area)

            // Game timer (top-center)
            this.renderGameTimer(state),

            // Performance info (top-left)
            this.renderPerformanceInfo(state),

            // Player stats (top-right)
            this.renderPlayerStats(state),
            
            // Chat panel (bottom-left)
            this.renderChatPanel(state),
            
            // Game controls info (bottom-center)
            this.renderControlsInfo(),
            
            // Notifications (center-top)
            this.renderNotifications(),
            
            // Debug info (if enabled)
            state.showDebugInfo ? this.renderDebugInfo(state) : null
        ]);
    }
    
    /**
     * Render nickname entry screen
     */
    renderNicknameScreen(state) {
        const isConnected = state.isConnected !== undefined ? state.isConnected : this.uiState.isConnected;
        const nickname = state.nickname || this.uiState.nickname || '';
        
        return h('div', { className: 'screen nickname-screen' }, [
            h('div', { className: 'screen-content' }, [
                h('h1', { className: 'game-title' }, ['💣 BOMBERMAN DOM']),
                h('p', { className: 'subtitle' }, ['Enhanced Multiplayer Edition']),

                h('div', { className: 'nickname-form' }, [
                    h('h2', {}, ['Enter Your Nickname']),
                    h('input', {
                        type: 'text',
                        className: 'nickname-input',
                        placeholder: 'Your nickname (2-16 chars)',
                        maxLength: 16,
                        value: nickname,
                        onInput: (e) => this.handleNicknameChange(e.target.value),
                        onKeyDown: (e) => {
                            if (e.key === 'Enter' && this.canSubmitNickname({ nickname })) {
                                this.submitNickname();
                            }
                        }
                    }),
                    h('button', {
                        className: 'primary-button',
                        disabled: !isConnected || !this.canSubmitNickname({ nickname }),
                        onClick: () => this.submitNickname()
                    }, [
                        isConnected ? 'Continue' : 'Connecting...'
                    ])
                ]),

                // Connection status display
                h('div', {
                    className: `connection-status ${isConnected ? 'connected' : 'connecting'}`
                }, [
                    isConnected ?
                        h('span', {}, ['✅ Connected to server']) :
                        h('span', {}, [
                            h('span', { className: 'loading-spinner' }, ['🔄']),
                            ' Connecting to server...'
                        ])
                ])
            ]),

            // Notifications (should appear on all screens)
            this.renderNotifications()
        ]);
    }

    /**
     * Render main menu screen
     */
    renderMenuScreen(state) {
        return h('div', { className: 'screen menu-screen' }, [
            h('div', { className: 'screen-content' }, [
                h('h1', { className: 'game-title' }, [`Welcome, ${state.nickname}!`]),

                h('div', { className: 'menu-options' }, [
                    h('button', {
                        className: 'menu-button',
                        onClick: () => this.joinQueue()
                    }, ['🎮 Quick Match']),

                    h('button', {
                        className: 'menu-button',
                        onClick: () => this.showComingSoon('Co-op vs AI')
                    }, ['🤖 Co-op vs AI']),
                ]),

                this.renderGameInfo(),
                this.renderConnectionStatus(state)
            ]),

            // Notifications (should appear on all screens)
            this.renderNotifications()
        ]);
    }
    
    /**
     * Render queue screen
     */
    renderQueueScreen(state) {
        return h('div', { className: 'screen queue-screen' }, [
            h('div', { className: 'screen-content' }, [
                h('h1', {}, ['Finding Players...']),
                
                h('div', { className: 'queue-status' }, [
                    h('div', { className: 'queue-counter' }, [
                        h('span', { className: 'current-count' }, [state.queueSize?.toString() || '0']),
                        h('span', { className: 'separator' }, ['/']),
                        h('span', { className: 'max-count' }, [GAME_CONFIG.MAX_PLAYERS.toString()]),
                        h('span', { className: 'label' }, [' players'])
                    ]),
                    
                    h('div', { className: 'queue-spinner' }, ['⏳'])
                ]),
                
                h('div', { className: 'waiting-players' }, [
                    h('h3', {}, ['Players in Queue']),
                    h('ul', { className: 'player-list' }, 
                        (state.waitingPlayers || []).map(player => 
                            h('li', { key: player.id }, [
                                h('span', { className: 'player-name' }, [player.nickname]),
                                player.id === state.playerId ?
                                    h('span', { className: 'you-label' }, [' (YOU)']) : null
                            ])
                        )
                    )
                ]),
                
                h('button', {
                    className: 'secondary-button',
                    onClick: () => this.leaveQueue()
                }, ['Cancel'])
            ]),

            // Add chat panel to queue screen for waiting players
            this.renderChatPanel(state, 'queue-context'),

            // Notifications (should appear on all screens)
            this.renderNotifications()
        ]);
    }
    
    
    /**
     * Render lobby screen
     */
    renderLobbyScreen(state) {
        return h('div', { className: 'screen lobby-screen' }, [
            h('div', { className: 'screen-content' }, [
                h('h1', {}, ['Game Starting!']),
                
                h('div', { className: 'countdown-display' }, [
                    h('div', { className: 'countdown-number' }, [state.countdown?.toString() || '0']),
                    h('div', { className: 'countdown-label' }, ['seconds'])
                ]),
                
                h('div', { className: 'game-players' }, [
                    h('h3', {}, ['Players Ready']),
                    h('div', { className: 'player-grid' }, 
                        (state.waitingPlayers || []).map((player, index) => 
                            h('div', { 
                                key: player.id,
                                className: `player-card player-${index}`
                            }, [
                                h('div', { className: 'player-avatar' }, [player.nickname?.charAt(0)?.toUpperCase() || `P${index + 1}`]),
                                h('div', { className: 'player-info' }, [
                                    h('div', { className: 'player-name' }, [player.nickname]),
                                    player.id === state.playerId ? 
                                        h('div', { className: 'you-badge' }, ['YOU']) : null
                                ])
                            ])
                        )
                    )
                ])
            ]),

            // Notifications (should appear on all screens)
            this.renderNotifications()
        ]);
    }
    
    /**
     * Render game over screen
     */
    renderGameOverScreen(state) {
        const results = state.gameResults;
        if (!results) return this.renderLoadingScreen(state);
        
        const isWinner = results.winner && results.winner.id === state.playerId;
        
        return h('div', { className: 'screen game-over-screen' }, [
            h('div', { className: 'screen-content' }, [
                h('h1', { className: isWinner ? 'winner-title' : 'game-over-title' }, [
                    isWinner ? '🏆 YOU WIN!' : '💀 GAME OVER'
                ]),
                
                this.renderGameResults(results, state.playerId),
                
                h('div', { className: 'game-over-actions' }, [
                    h('button', {
                        className: 'primary-button',
                        onClick: () => this.returnToMenu()
                    }, ['Play Again']),
                    
                    h('button', {
                        className: 'secondary-button',
                        onClick: () => this.joinQueue()
                    }, ['Quick Match'])
                ])
            ]),

            // Notifications (should appear on all screens)
            this.renderNotifications()
        ]);
    }
    
    /**
     * Render error screen
     */
    renderErrorScreen(state) {
        return h('div', { className: 'screen error-screen' }, [
            h('div', { className: 'screen-content' }, [
                h('h1', { className: 'error-title' }, ['❌ Connection Error']),
                h('p', { className: 'error-message' }, [state.errorMessage || 'Something went wrong']),
                h('button', {
                    className: 'primary-button',
                    onClick: () => this.refreshPage()
                }, ['🔄 Refresh Page'])
            ]),

            // Notifications (should appear on all screens)
            this.renderNotifications()
        ]);
    }
    
    /**
     * Render loading screen
     */
    renderLoadingScreen(state) {
        return h('div', { className: 'screen loading-screen' }, [
            h('div', { className: 'screen-content' }, [
                h('h1', {}, ['💣 BOMBERMAN DOM']),
                h('div', { className: 'loading-spinner' }, ['⏳']),
                h('p', {}, ['Loading...'])
            ]),

            // Notifications (should appear on all screens)
            this.renderNotifications()
        ]);
    }
    
    /**
     * Render connection status
     */
    renderConnectionStatus(state) {
        return h('div', { className: 'connection-status' }, [
            state.isConnected 
                ? h('span', { className: 'status-connected' }, ['🟢 Connected'])
                : h('span', { className: 'status-connecting' }, ['🟡 Connecting...'])
        ]);
    }
    
    /**
     * Render performance info
     */
    renderPerformanceInfo(state) {
        if (!state.fps) return null;
        
        const fpsClass = state.fps >= 55 ? 'fps-good' : 
                        state.fps >= 45 ? 'fps-medium' : 'fps-poor';
        
        return h('div', { 
            className: 'performance-info',
            style: 'position: absolute; top: 10px; left: 10px; z-index: 200;'
        }, [
            h('div', { className: `fps-counter ${fpsClass}` }, [`FPS: ${state.fps || 60}`])
        ]);
    }
    
    /**
     * Render player stats - Only show alive players
     * Purpose: Display HUD stats only for living players
     * Inputs: state (object) - current game state
     * Outputs: Virtual DOM element with alive player stats
     * Dependencies: h() helper function, player data structure
     */
    renderPlayerStats(state) {
        const allPlayers = Object.values(state.players || {});
        
        // MINIMAL CHANGE: Filter only alive players for stats display
        const alivePlayers = allPlayers.filter(player => player.isAlive);
        
        if (alivePlayers.length === 0) return null;
        
        return h('div', { 
            className: 'player-stats',
            style: 'position: absolute; top: 10px; right: 10px; z-index: 200;'
        }, 
            alivePlayers.map((player, index) => 
                h('div', { 
                    key: player.id,
                    className: `player-stat ${player.id === state.playerId ? 'local-player' : ''}`
                }, [
                    h('div', { className: 'player-name' }, [
                        player.id === state.playerId ? 'YOU' : (player.nickname || `Player${index + 1}`)
                    ]),
                    h('div', { className: 'player-lives' }, [
                        '❤️'.repeat(Math.max(0, player.lives || 0))
                    ]),
                    h('div', { className: 'player-powerups' }, [
                        (player.powerUps?.bombs || 0) > 0 ? h('span', { title: 'Extra Bombs' }, ['💣']) : null,
                        (player.powerUps?.flames || 0) > 0 ? h('span', { title: 'More Range' }, ['🔥']) : null,
                        (player.powerUps?.speed || 0) > 0 ? h('span', { title: 'Speed Up' }, ['⚡']) : null,
                        player.powerUps?.blockPass ? h('span', { title: 'Block Pass - Can pass through blocks!' }, ['👻']) : null
                    ])
                ])
            )
        );
    }
    
    /**
     * Render game timer display
     */
    renderGameTimer(state) {
        // Timer display is disabled - return null to hide from UI
        return null;
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
     *  Render chat panel with context-aware styling
     * @param {Object} state - Current game state
     * @param {string} context - Context for styling ('queue-context', 'game-context')
     */
    renderChatPanel(state, context = 'game-context') {
        const isQueueContext = context === 'queue-context';
        
        const panelStyle = isQueueContext
            ? 'position: absolute; bottom: 20px; left: 20px; width: 350px; max-height: 300px; z-index: 200;'
            : 'position: absolute; bottom: 10px; left: 10px; width: 300px; max-height: 250px; z-index: 200;';
        
        const headerText = isQueueContext ? '💬 Chat (Queue)' : '💬 Chat';
        
        return h('div', {
            className: `chat-panel ${context}`,
            style: panelStyle
        }, [
            h('div', { className: 'chat-header' }, [headerText]),
            
            h('div', {
                className: 'chat-messages',
                style: 'max-height: 150px; overflow-y: auto; margin-bottom: 10px;'
            },
                (state.chatMessages || []).slice(-10).map((msg, index) =>
                    h('div', {
                        // Stable key without Date.now()
                        key: `msg-${msg.timestamp}-${index}`,
                        className: `chat-message ${msg.playerId === state.playerId ? 'own-message' : ''}`
                    }, [
                        h('span', { className: 'chat-nickname' }, [`${msg.nickname}:`]),
                        h('span', { className: 'chat-text' }, [msg.message])
                    ])
                )
            ),
            
            h('div', { className: 'chat-input-container' }, [
                h('input', {
                    // Stable key - only include context, remove Date.now()
                    key: `chat-input-${context}`,
                    type: 'text',
                    className: 'chat-input',
                    placeholder: isQueueContext ? 'Chat with waiting players...' : 'Type message...',
                    value: state.currentChatMessage || '',
                    maxLength: 200,
                    
                    // Direct binding without excessive re-renders
                    onInput: (e) => this.handleChatInput(e.target.value),
                    onKeyDown: (e) => this.handleChatKeyDown(e)
                }),
                
                h('button', {
                    className: 'chat-send-button',
                    disabled: !(state.currentChatMessage?.trim()),
                    onClick: () => this.sendChatMessage()
                }, ['Send'])
            ])
        ]);
    }

    
    /**
     * Render game controls info
     */
    renderControlsInfo() {
        return h('div', { 
            className: 'controls-info',
            style: 'position: absolute; bottom: 10px; right: 10px; z-index: 200;'
        }, [
            h('div', { className: 'controls-text' }, [
                'WASD/Arrows: Move | SPACE: Bomb | ENTER: Chat | F1: Debug'
            ])
        ]);
    }
    
    /**
     * Render notifications
     */
    renderNotifications() {
        return h('div', { 
            className: 'notifications',
            style: 'position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 300;'
        },
            this.uiState.notifications.map(notification =>
                h('div', {
                    key: notification.id,
                    className: `notification ${notification.type}`,
                    onClick: () => this.removeNotification(notification.id)
                }, [notification.message])
            )
        );
    }
    
    /**
     * Render debug info with deduplication tracking
     */
    renderDebugInfo(state) {
        return h('div', { 
            className: 'debug-info',
            style: 'position: absolute; top: 100px; left: 10px; z-index: 200;'
        }, [
            h('h3', {}, ['Debug Info (F1 to toggle)']),
            h('div', {}, [`Game State: ${state.gameState}`]),
            h('div', {}, [`Players: ${Object.keys(state.players || {}).length}`]),
            h('div', {}, [`FPS: ${state.fps || 60}`]),
            h('div', {}, [`Connected: ${state.isConnected ? 'Yes' : 'No'}`]),
            h('div', {}, [`Player ID: ${state.playerId || 'None'}`]),
            h('div', {}, [`Game Area: ${this.gameAreaMounted ? 'Mounted' : 'Not Mounted'}`]),
            h('div', {}, [`Notifications: ${this.gameAreaNotificationCount}`]),
            h('div', {}, [`Pending: ${this.pendingGameAreaNotification ? 'Yes' : 'No'}`])
        ]);
    }
    
    /**
     * Render game info
     */
    renderGameInfo() {
        return h('div', { className: 'game-info' }, [
            h('h3', {}, ['Game Features']),
            h('ul', {}, [
                h('li', {}, ['✅ 2-4 Player Multiplayer']),
                h('li', {}, ['✅ Real-time Chat']),
                h('li', {}, ['✅ 8 Power-ups Types']),
                h('li', {}, ['✅ Lives System (3 lives each)']),
                h('li', {}, ['✅ 60fps Performance']),
                h('li', {}, ['✅ Pure Virtual DOM'])
            ])
        ]);
    }
    
    /**
     * Render game results
     */
    renderGameResults(results, currentPlayerId) {
        return h('div', { className: 'game-results' }, [
            results.winner ? h('div', { className: 'winner-info' }, [
                h('h2', {}, [`Winner: ${results.winner.nickname || 'Unknown'}`]),
                h('div', { className: 'winner-stats' }, [
                    `Final Lives: ${results.winner.lives || 0}`,
                    ` | Game Duration: ${results.formattedDuration || this.formatTime(results.duration || 0)}`
                ])
            ]) : h('div', { className: 'draw-info' }, [
                h('h2', {}, ['Draw - No Winner!']),
                h('div', { className: 'draw-stats' }, [
                    `Game Duration: ${results.formattedDuration || this.formatTime(results.duration || 0)}`
                ])
            ]),
            
            h('div', { className: 'final-standings' }, [
                h('h3', {}, ['Final Standings']),
                h('table', { className: 'standings-table' }, [
                    h('thead', {}, [
                        h('tr', {}, [
                            h('th', {}, ['Player']),
                            h('th', {}, ['Lives']),
                            h('th', {}, ['Status'])
                        ])
                    ]),
                    h('tbody', {}, 
                        (results.finalScores || [])
                            .sort((a, b) => (b.lives || 0) - (a.lives || 0))
                            .map(player => 
                                h('tr', { 
                                    key: player.id,
                                    className: player.id === results.winner?.id ? 'winner-row' : ''
                                }, [
                                    h('td', {}, [player.id === currentPlayerId ? 'YOU' : (player.nickname || 'Player')]),
                                    h('td', {}, [(player.lives || 0).toString()]),
                                    h('td', {}, [player.isAlive ? 'Alive' : 'Eliminated'])
                                ])
                            )
                    )
                ])
            ])
        ]);
    }
    
    // Event handlers
    
    handleNicknameChange(nickname) {
        this.uiState.nickname = nickname;
        this.app.setState({ nickname });
    }
    
    /**
     *  Handle chat input with proper state synchronization
     *  Debounced state updates to prevent excessive re-renders
     */
    handleChatInput(message) {
        // Update UI state immediately for responsive typing
        this.uiState.currentChatMessage = message;
        
        // Debounced state update to prevent excessive renders
        clearTimeout(this.chatInputTimeout);
        this.chatInputTimeout = setTimeout(() => {
            this.app.setState({ currentChatMessage: message });
            
            // Also update StateManager for consistency
            if (this.stateManager) {
                this.stateManager.updateCurrentChatMessage(message);
            }
        }, 16); // ~60fps debounce
    }
    clearChatInputForced() {
        // STEP 1: Clear Virtual DOM state
        this.app.setState({ currentChatMessage: '' });
        this.uiState.currentChatMessage = '';
        
        // STEP 2: Force clear actual DOM input (failsafe)
        setTimeout(() => {
            const chatInput = document.querySelector('.chat-input');
            if (chatInput) {
                chatInput.value = '';
                chatInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, 0);
        
        this.logger.debug('Chat input force cleared');
    }

    
    handleEscapeKey() {
        const state = this.app.getState();
        
        if (state.gameState === GAME_STATES.QUEUE) {
            this.leaveQueue();
        }
    }

    handleChatKeyDown(event) {
        switch (event.key) {
            case 'Enter':
                event.preventDefault();
                this.sendChatMessage();
                // Keep focus for continuous chatting
                setTimeout(() => {
                    const chatInput = document.querySelector('.chat-input');
                    if (chatInput) chatInput.focus();
                }, 50);
                break;
                
            case 'Escape':
                event.preventDefault();
                event.target.blur();
                this.clearChatInputForced();
                break;
        }
    }
    
    
    // Actions
    
    canSubmitNickname(state) {
        const nickname = state.nickname || this.uiState.nickname;
        return nickname && nickname.length >= 2 && nickname.length <= 16 && 
               /^[a-zA-Z0-9_]+$/.test(nickname);
    }
    
    submitNickname() {
        const nickname = this.uiState.nickname;
        if (this.canSubmitNickname({ nickname })) {
            this.emitEvent('setNickname', nickname);
        }
    }
    
    joinQueue() {
        this.emitEvent('joinQueue');
    }
    
    leaveQueue() {
        window.location.reload();
    }
    
    /**
     * Send chat message with proper state clearing and error handling
     */
    sendChatMessage() {
        const message = this.uiState.currentChatMessage?.trim();
        
        // Validation
        if (!message || message.length === 0) {
            this.logger.warn('Cannot send empty chat message');
            return;
        }
        
        if (message.length > 200) {
            this.showNotification('Message too long! (Max 200 characters)', 'warning');
            return;
        }
        
        try {
            // Clear input immediately for responsive UI
            this.clearChatInputForced();
            
            
            // Send through event system
            this.emitEvent('sendChatMessage', message);
            
            this.logger.debug('Chat message sent:', message);
            
        } catch (error) {
            this.logger.error('Error sending chat message:', error);
            
            // Restore message on error
            this.handleChatInput(message);
            this.showNotification('Failed to send message', 'error');
        }
    }

    
    returnToMenu() {
        this.emitEvent('returnToMenu');
    }
    
    refreshPage() {
        window.location.reload();
    }
     
    showComingSoon(feature) {
        this.showNotification(`${feature} coming soon!`, 'info');
    }
    
    toggleDebugInfo() {
        this.uiState.showDebugInfo = !this.uiState.showDebugInfo;
        this.app.setState({ showDebugInfo: this.uiState.showDebugInfo });
    }
    
    showNotification(message, type = 'info') {
        // Clear any existing notifications to prevent stacking
        this.uiState.notifications = [];

        const notification = {
            id: Date.now() + Math.random(),
            message,
            type,
            timestamp: Date.now()
        };

        this.uiState.notifications.push(notification);

        // Update app state to trigger re-render
        if (this.app) {
            this.app.setState({ notifications: [...this.uiState.notifications] });
        }

        // Auto-remove after 5 seconds
        setTimeout(() => {
            this.removeNotification(notification.id);
        }, 5000);

        this.logger.debug('Notification shown:', message);
    }
    
    removeNotification(id) {
        this.uiState.notifications = this.uiState.notifications.filter(n => n.id !== id);

        // Update app state to trigger re-render
        if (this.app) {
            this.app.setState({ notifications: [...this.uiState.notifications] });
        }
    }
    
    removeEventListeners() {
        // Remove state manager listeners
        if (this.stateManager) {
            this.stateManager.off('stateChanged', this.handleStateChange);
            this.stateManager.off('gameStateChanged', this.handleGameStateChange);
            this.stateManager.off('playerUpdate', this.handlePlayerUpdate);
            this.stateManager.off('chatMessage', this.handleChatMessage);
        }
        
        // Remove input system listeners
        if (this.inputSystem) {
            this.inputSystem.off('move', this.handleMovement);
            this.inputSystem.off('placeBomb', this.handleBombPlacement);
            this.inputSystem.off('openChat', this.handleChatOpen);
        }
        
        // Remove network manager listeners
        if (this.networkManager) {
            this.networkManager.off('connected', this.handleNetworkConnected);
            this.networkManager.off('disconnected', this.handleNetworkDisconnected);
            this.networkManager.off('error', this.handleNetworkError);
        }
        
        // Clear stored listener references
        this.boundHandlers = null;
    }
    
    /**
     * Emit event to game engine
     */
    emitEvent(event, data) {
        if (this.onEvent) {
            this.onEvent(event, data);
        } else {
            this.logger.warn('No event handler set for UI event:', event);
        }
    }
    /**
     * NEW: Clear chat input with proper state synchronization
     * Ensures all state managers are updated consistently
     */
    clearChatInput() {
        // Clear UI state
        this.uiState.currentChatMessage = '';
        
        // Clear timeout if pending
        clearTimeout(this.chatInputTimeout);
        
        // Update app state immediately
        this.app.setState({ currentChatMessage: '' });

        
        // Update StateManager for consistency
        if (this.stateManager) {
            this.stateManager.updateCurrentChatMessage('');
            this.stateManager.clearChatInput();
        }
        
        this.logger.debug('Chat input cleared');
    }
    /**
     * Set callback with better error handling
     */
    setGameAreaCallback(callback) {
        this.onGameAreaCreated = callback;
        
        // If we're already in the playing state, try to find the game area
        if (this.gameAreaMounted && this.lastNotifiedGameArea) {
            this.logger.debug('Game area callback set, element already exists');
            try {
                callback(this.lastNotifiedGameArea);
            } catch (error) {
                this.logger.error('Error in game area callback:', error);
            }
        }
    }
    
    /**
     * PUBLIC API: Get game area (for RenderSystem)
     */
    getGameArea() {
        return document.getElementById('game-area');
    }
    
    /**
     * Update method called by game engine
     */
    update(deltaTime) {
        // Update UI animations, remove old notifications, etc.
        const now = Date.now();
        
        // Remove old notifications
        const oldCount = this.uiState.notifications.length;
        this.uiState.notifications = this.uiState.notifications.filter(
            notification => now - notification.timestamp < 5000
        );
        
        // Check for game area mounting (if in playing state)
        const state = this.app?.getState();
        if (state?.gameState === GAME_STATES.PLAYING && !this.gameAreaMounted) {
            this.scheduleGameAreaNotification();
        }
        
        // Reset game area flag when leaving playing state
        if (state?.gameState !== GAME_STATES.PLAYING && this.gameAreaMounted) {
            this.logger.debug('Leaving playing state, resetting game area flags');
            this.gameAreaMounted = false;
            this.lastNotifiedGameArea = null;
            this.pendingGameAreaNotification = false;
        }
    }
    
    /**
     * Get current UI state with deduplication info
     */
    getUIState() {
        return {
            ...this.uiState,
            isInitialized: this.isInitialized,
            currentScreen: this.currentScreen,
            gameAreaMounted: this.gameAreaMounted,
            hasGameArea: !!this.getGameArea(),
            gameAreaNotificationCount: this.gameAreaNotificationCount,
            pendingGameAreaNotification: this.pendingGameAreaNotification,
            lastNotifiedGameAreaExists: !!this.lastNotifiedGameArea
        };
    }
    
    /**
     * Cleanup UI manager
     */
    cleanup() {
        // Reset game area flags
        this.gameAreaMounted = false;
        this.lastNotifiedGameArea = null;
        this.gameAreaNotificationCount = 0;
        this.pendingGameAreaNotification = false;

        // Remove event listeners
        this.removeEventListeners();
        
        // Stop UI app
        if (this.app) {
            this.app.stop();
            this.app = null;
        }
        
        // Remove main container
        if (this.gameContainer && this.gameContainer.parentNode) {
            this.gameContainer.parentNode.removeChild(this.gameContainer);
            this.gameContainer = null;
        }
        
  
        this.isInitialized = false;
        this.uiState.notifications = [];
        
        this.logger.info('UI Manager cleaned up - ready for reinitialization');
    }
    
}

export default UIManager;
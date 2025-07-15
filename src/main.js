// src/main.js
// Main game initialization and entry point

import { GameEngine } from './core/GameEngine.js';
import { Logger } from './utils/Logger.js';
import { DEBUG_CONFIG } from './utils/Constants.js';

/**
 * Bomberman Game Initializer
 *
 * Responsibilities:
 * - Browser compatibility checking
 * - Game engine initialization and startup
 * - Debug tools setup and configuration
 * - Error handling and user feedback
 * - Coordination between core game systems
 */
class BombermanGameInitializer {
    constructor() {
        this.logger = new Logger('GameInit');
        this.gameEngine = null;
        this.isInitialized = false;

        this.logger.info('Bomberman game initializer created');
    }

    /**
     * Initialize the complete game system
     */
    async initialize(container) {
        try {
            this.logger.info('🎮 Initializing Bomberman Game...');

            // Step 1: Browser compatibility check
            if (!this.checkBrowserCompatibility()) {
                throw new Error('Browser compatibility check failed');
            }

            // Step 2: Wait for DOM readiness
            await this.waitForDOM();

            // Step 3: Initialize game engine
            this.gameEngine = new GameEngine(container);
            this.logger.info('GameEngine initialized');

            // Step 4: Start the game engine
            await this.gameEngine.start();

            // Step 5: Setup debug tools
            this.setupDebugTools();

            this.isInitialized = true;
            this.logger.info('✅ Bomberman initialized successfully!');

            return {
                gameEngine: this.gameEngine,
                version: '2.1.0',
                features: [
                    'Real-time multiplayer gameplay',
                    'DOM-based rendering system',
                    'Centralized UI management',
                    'Performance-optimized rendering'
                ]
            };

        } catch (error) {
            this.logger.error('Failed to initialize game:', error);
            this.showErrorScreen({
                title: 'Initialization Error',
                message: 'Failed to start the game. Please refresh the page.',
                details: error.message
            });
            throw error;
        }
    }

    /**
     * Wait for DOM to be ready
     */
    async waitForDOM() {
        return new Promise((resolve) => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', resolve);
            } else {
                setTimeout(resolve, 50);
            }
        });
    }

    /**
     * Browser compatibility check
     */
    checkBrowserCompatibility() {
        const features = {
            WebSocket: typeof WebSocket !== 'undefined',
            RequestAnimationFrame: typeof requestAnimationFrame !== 'undefined',
            ES6Modules: typeof Symbol !== 'undefined',
            Performance: typeof performance !== 'undefined',
            Map: typeof Map !== 'undefined',
            Set: typeof Set !== 'undefined'
        };

        const missingFeatures = Object.entries(features)
            .filter(([name, supported]) => !supported)
            .map(([name]) => name);

        if (missingFeatures.length > 0) {
            this.logger.error('Browser missing required features:', missingFeatures);
            this.showErrorScreen({
                title: 'Browser Compatibility Issue',
                message: 'Your browser doesn\'t support some required features.',
                details: `Missing: ${missingFeatures.join(', ')}`
            });
            return false;
        }

        return true;
    }

    /**
     * Show error screen with basic styling (fallback only)
     */
    showErrorScreen(errorInfo) {
        const errorHtml = `
            <div style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: linear-gradient(135deg, #d32f2f 0%, #b71c1c 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                font-family: 'Segoe UI', sans-serif;
                color: white;
            ">
                <div style="
                    background: rgba(0, 0, 0, 0.9);
                    padding: 40px;
                    border-radius: 20px;
                    text-align: center;
                    max-width: 500px;
                    width: 90%;
                ">
                    <h1 style="font-size: 2em; margin-bottom: 20px; color: #ffcdd2;">
                        ⚠️ ${errorInfo.title}
                    </h1>
                    <p style="font-size: 1.1em; margin-bottom: 15px; color: #ffebee;">
                        ${errorInfo.message}
                    </p>
                    ${errorInfo.details ? `
                        <div style="
                            font-size: 0.9em;
                            margin-bottom: 30px;
                            opacity: 0.8;
                            font-family: monospace;
                            background: rgba(255, 255, 255, 0.1);
                            padding: 10px;
                            border-radius: 5px;
                        ">
                            ${errorInfo.details}
                        </div>
                    ` : ''}
                    <button onclick="window.location.reload()" style="
                        padding: 12px 24px;
                        background: #f44336;
                        color: white;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 1em;
                    ">
                        🔄 Refresh Page
                    </button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', errorHtml);
    }

    /**
     * Setup debug tools (configurable)
     */
    setupDebugTools() {
        // Only setup debug tools if enabled
        if (!DEBUG_CONFIG.ENABLE_DEBUG_TOOLS) {
            this.logger.info('Debug tools disabled via configuration');
            return;
        }

        // Global debug object
        window.bombermanDebug = {
            gameEngine: this.gameEngine,
            getGameState: () => this.gameEngine?.stateManager?.getCurrentState(),
            getPerformanceStats: () => this.gameEngine?.getGameStats(),
            getPlayers: () => this.gameEngine?.stateManager?.getPlayers(),
            forceReconnect: () => this.gameEngine?.networkManager?.reconnect(),
            validateState: () => this.gameEngine?.stateManager?.validateState(),
            logger: this.logger,
            getUIState: () => this.gameEngine?.uiManager?.getUIState(),
            testConnection: () => {
                const networkManager = this.gameEngine?.networkManager;
                if (networkManager) {
                    console.log('Connection Status:', {
                        isConnected: networkManager.isConnected,
                        connectionState: networkManager.connectionState,
                        lastPing: networkManager.lastPing
                    });
                }
            }
        };

        // Debug keyboard shortcuts (configurable)
        if (DEBUG_CONFIG.ENABLE_DEBUG_SHORTCUTS) {
            document.addEventListener('keydown', (e) => {
                if (!DEBUG_CONFIG.ENABLED) return;

                if (e.key === 'F9') {
                    e.preventDefault();
                    console.log('🎮 Current Game State:', window.bombermanDebug.getGameState());
                }

                if (e.key === 'F10') {
                    e.preventDefault();
                    console.log('📊 Performance Stats:', window.bombermanDebug.getPerformanceStats());
                }

                if (e.key === 'F11') {
                    e.preventDefault();
                    console.log('👥 Players:', window.bombermanDebug.getPlayers());
                }

                if (e.key === 'F12') {
                    e.preventDefault();
                    console.log('🔌 Connection Test:');
                    window.bombermanDebug.testConnection();
                }
            });
        }

        this.logger.info('🔧 Debug tools available via window.bombermanDebug');
        console.log(`
🎮 BOMBERMAN DOM - MULTIPLAYER EDITION
=====================================
✅ Real-time multiplayer gameplay
✅ DOM-based rendering system
✅ Centralized UI management
✅ Performance-optimized rendering
✅ 60fps DOM-based rendering
✅ WebSocket multiplayer (2-4 players)
✅ Real-time chat system
✅ 8 power-up types + bonus features
✅ Lives system (3 lives per player)
✅ Performance optimized for all devices

🔧 Debug Tools:
- F9: Log current game state
- F10: Log performance stats
- F11: Log players data
- F12: Test connection status
- window.bombermanDebug.*: Debug functions

📊 Performance Target: 60fps (16.67ms/frame)
🌐 WebSocket connection: Auto-reconnect enabled
🎯 Ready for competitive multiplayer gaming!
        `);
    }

    /**
     * Cleanup and stop the game
     */
    destroy() {
        if (this.gameEngine) {
            this.gameEngine.stop();
            this.gameEngine = null;
        }

        this.isInitialized = false;
        this.logger.info('Game destroyed');
    }
}

/**
 * Main initialization function
 * This is the entry point called from index.html
 */
export async function initializeEnhancedBomberman(container) {
    const initializer = new BombermanGameInitializer();
    return await initializer.initialize(container);
}

// Export for module use
export { BombermanGameInitializer };
export default initializeEnhancedBomberman;
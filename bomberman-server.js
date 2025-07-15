// bomberman-server.js
// High-performance multiplayer Bomberman game server with WebSocket support

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

// Import game room management
import { GameRoom } from './src/core/GameRoom.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * High-Performance Bomberman Game Server
 *
 * Features:
 * - WebSocket-based real-time multiplayer communication
 * - Automatic matchmaking and game room management
 * - Player connection health monitoring with ping/pong
 * - Graceful server shutdown and cleanup
 * - Static file serving for game client
 * - Comprehensive error handling and logging
 * - Support for 2-4 players per game
 */
class BombermanServer {
    constructor(port = 8080) {
        this.port = port;
        
        // Server state
        this.isShuttingDown = false;
        this.shutdownHandlersAdded = false;
        
        // Game state management
        this.games = new Map();
        this.players = new Map();
        this.waitingQueue = new Set();
        
        // Performance optimization constants
        this.GAME_CONFIG = {
            MAP_WIDTH: 15,
            MAP_HEIGHT: 13,
            TILE_SIZE: 32,
            MAX_PLAYERS: 4,
            MIN_PLAYERS: 2,
            COUNTDOWN_TIME: 10,
            BOMB_TIMER: 3000,
            LIVES_PER_PLAYER: 3,
            TICK_RATE: 60,
            MAX_GAMES: 100,
            WAITING_TIME: 20000,    // 20 seconds waiting period
            COUNTDOWN_DURATION: 10000, // 10 seconds countdown
            PING_INTERVAL: 30000,   // 30 seconds ping interval
            CONNECTION_TIMEOUT: 60000 // 1 minute timeout
        };
        
        // Server statistics
        this.stats = {
            totalConnections: 0,
            currentConnections: 0,
            totalGames: 0,
            activeGames: 0,
            startTime: Date.now()
        };


        this.queueTimer = null;
        this.queueWaitStartTime = null;
        this.queueCountdown = 20; // 20 seconds
        this.queueCountdownInterval = null;
        
        // Cleanup tracking for proper resource management
        this.cleanupIntervals = new Set();

        this.setupServer();
        console.log(`🎮 Bomberman Server starting on port ${port}`);
        console.log(`🔧 Server ready for multiplayer connections`);
    }
    
    setupServer() {
        // HTTP server for static files with enhanced error handling
        this.httpServer = createServer((req, res) => {
            try {
                this.handleHttpRequest(req, res);
            } catch (error) {
                console.error(`❌ HTTP request error: ${error.message}`);
                res.writeHead(500, {'Content-Type': 'text/plain'});
                res.end('Internal Server Error');
            }
        });
        
        // Configure max listeners for optimal performance
        this.httpServer.setMaxListeners(20);
        
        // WebSocket server with optimization and error handling
        this.wss = new WebSocketServer({ 
            server: this.httpServer,
            perMessageDeflate: {
                zlibDeflateOptions: {
                    chunkSize: 1024,
                    windowBits: 13,
                    compressionLevel: 3
                }
            }
        });
        
        // Configure max listeners for WebSocket server
        this.wss.setMaxListeners(20);
        
        this.wss.on('connection', (ws, req) => {
            try {
                this.handleConnection(ws, req);
            } catch (error) {
                console.error(`❌ WebSocket connection error: ${error.message}`);
                if (ws.readyState === ws.OPEN) {
                    ws.close(1011, 'Server Error');
                }
            }
        });
        
        // Enhanced error handling for server
        this.httpServer.on('error', (error) => {
            console.error(`🚨 HTTP Server Error: ${error.message}`);
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${this.port} is already in use. Please use a different port.`);
                process.exit(1);
            }
        });
        
        this.wss.on('error', (error) => {
            console.error(`🚨 WebSocket Server Error: ${error.message}`);
        });
        
        this.httpServer.listen(this.port, () => {
            console.log(`✅ Server running on http://localhost:${this.port}`);
            console.log(`📊 Optimized for ${this.GAME_CONFIG.TICK_RATE}fps gameplay`);
            console.log(`🎯 Ready for ${this.GAME_CONFIG.MAX_PLAYERS} players per game`);
            console.log(`💓 Heartbeat: ${this.GAME_CONFIG.PING_INTERVAL/1000}s ping interval`);
        });
        
        // Initialize graceful shutdown handling
        this.setupShutdownHandlers();
        
        // Start performance monitoring
        this.startPerformanceMonitoring();
    }
    
    /**
     * Set up graceful shutdown handlers for proper resource cleanup
     */
    setupShutdownHandlers() {
        if (this.shutdownHandlersAdded) {
            return; // Prevent adding multiple handlers
        }
        
        this.shutdownHandlersAdded = true;
        
        // Single SIGINT handler
        const shutdownHandler = () => {
            if (this.isShuttingDown) {
                console.log('🚨 Force shutdown requested');
                process.exit(1);
            }
            
            this.gracefulShutdown();
        };
        
        process.once('SIGINT', shutdownHandler);
        process.once('SIGTERM', shutdownHandler);
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('🚨 Uncaught Exception:', error);
            this.gracefulShutdown();
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
            // Don't exit on unhandled rejections, just log them
        });
    }
    
    async gracefulShutdown() {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        console.log('\n🛑 Received shutdown signal, shutting down gracefully...');
        
        try {
            // Stop accepting new connections
            this.wss.close();
            
            // Close all game rooms
            console.log(`🎮 Closing ${this.games.size} active games...`);
            for (const [gameId, game] of this.games) {
                try {
                    // Clean up game resources
                    if (game && typeof game.destroy === 'function') {
                        game.destroy();
                    } else {
                        console.warn(`⚠️ Game ${gameId} does not have destroy method`);
                    }
                } catch (error) {
                    console.error(`❌ Error destroying game ${gameId}:`, error.message);
                }
            }
            this.games.clear();
            
            // Close all player connections
            console.log(`👥 Disconnecting ${this.players.size} players...`);
            for (const [playerId, player] of this.players) {
                try {
                    if (player.pingInterval) {
                        clearInterval(player.pingInterval);
                        this.cleanupIntervals.delete(player.pingInterval);
                    }
                    if (player.ws && player.ws.readyState === 1) {
                        player.ws.close(1001, 'Server shutting down');
                    }
                } catch (error) {
                    console.error(`❌ Error closing connection for ${playerId}:`, error.message);
                }
            }
            this.players.clear();
            
            // Clear all intervals
            this.cleanupIntervals.forEach(interval => {
                try {
                    clearInterval(interval);
                    clearTimeout(interval);
                } catch (error) {
                    console.error('❌ Error clearing interval:', error.message);
                }
            });
            this.cleanupIntervals.clear();
            
            // Close HTTP server
            this.httpServer.close(() => {
                console.log('✅ Server shut down gracefully');
                process.exit(0);
            });
            
            // Force exit after 5 seconds if graceful shutdown fails
            setTimeout(() => {
                console.log('⚠️ Forced shutdown after timeout');
                process.exit(1);
            }, 5000);
            
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
            process.exit(1);
        }
    }
    
    handleHttpRequest(req, res) {
        let filePath = req.url === '/' ? '/index.html' : req.url;
        
        // Security: prevent directory traversal
        if (filePath.includes('..')) {
            res.writeHead(403, {'Content-Type': 'text/plain'});
            res.end('Forbidden');
            return;
        }
        
        const fullPath = join(__dirname, filePath);
        
        // Check if file exists
        if (!existsSync(fullPath)) {
            // Handle file not found with informative response
            console.log(`⚠️ File not found: ${filePath}`);
            res.writeHead(404, {'Content-Type': 'text/html'});
            res.end(`
                <h1>404 - File Not Found</h1>
                <p>The requested file <code>${filePath}</code> was not found.</p>
                <p><a href="/">Return to Home</a></p>
            `);
            return;
        }
        
        try {
            const content = readFileSync(fullPath);
            const ext = extname(filePath);
            
            // Set appropriate content type
            const contentTypes = {
                '.html': 'text/html',
                '.js': 'application/javascript',
                '.css': 'text/css',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.gif': 'image/gif',
                '.ico': 'image/x-icon',
                '.svg': 'image/svg+xml',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2'
            };
            
            const contentType = contentTypes[ext] || 'text/plain';
            
            // Development-friendly cache headers
            let cacheControl;
            if (ext === '.html' || ext === '.js') {
                // Disable caching for HTML and JS files during development
                cacheControl = 'no-cache, no-store, must-revalidate';
            } else {
                // Cache other assets (CSS, images, fonts) for better performance
                cacheControl = 'public, max-age=3600'; // 1 hour instead of 1 year
            }

            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': cacheControl,
                'Pragma': 'no-cache', // HTTP/1.0 compatibility
                'Expires': ext === '.html' || ext === '.js' ? '0' : new Date(Date.now() + 3600000).toUTCString(),
                'Access-Control-Allow-Origin': '*' // Enable CORS if needed
            });
            res.end(content);
            
        } catch (error) {
            console.error(`❌ Error reading file ${filePath}: ${error.message}`);
            res.writeHead(500, {'Content-Type': 'text/plain'});
            res.end('Internal Server Error');
        }
    }
    
    handleConnection(ws, req) {
        if (this.isShuttingDown) {
            ws.close(1012, 'Server is shutting down');
            return;
        }
        
        const playerId = this.generateId('player');
        const clientIP = req.socket.remoteAddress;
        
        console.log(`👤 Player ${playerId} connected from ${clientIP}`);
        
        // Update statistics
        this.stats.totalConnections++;
        this.stats.currentConnections++;
        
        // Store player connection
        const player = {
            id: playerId,
            ws: ws,
            nickname: null,
            gameId: null,
            connectedAt: Date.now(),
            lastPing: Date.now(),
            lastActivity: Date.now(),
            isAlive: true,
            pingInterval: null
        };
        
        this.players.set(playerId, player);
        
        // Set up WebSocket event handlers with enhanced error handling
        ws.on('message', (data) => {
            try {
                player.lastActivity = Date.now();
                this.handleMessage(playerId, data);
            } catch (error) {
                console.error(`❌ Invalid message from ${playerId}: ${error.message}`);
                console.error(error.stack);
                this.sendToPlayer(playerId, {
                    type: 'error',
                    message: 'Invalid message format',
                    code: 'INVALID_MESSAGE'
                });
            }
        });
        
        ws.on('close', (code, reason) => {
            console.log(`🚪 Player ${playerId} disconnected (${code}: ${reason || 'No reason'})`);
            this.handleDisconnection(playerId);
        });
        
        ws.on('error', (error) => {
            console.error(`🚨 WebSocket error for ${playerId}: ${error.message}`);
            this.handleDisconnection(playerId);
        });
        
        // Send connection confirmation
        this.sendToPlayer(playerId, {
            type: 'connected',
            playerId: playerId,
            serverVersion: '2.2.0',
            gameConfig: this.GAME_CONFIG,
            serverTime: Date.now()
        });

        // Initialize connection health monitoring
        this.setupPlayerHeartbeat(playerId);
    }

    /**
     * Set up heartbeat monitoring for player connection health
     */
    setupPlayerHeartbeat(playerId) {
        const player = this.players.get(playerId);
        if (!player) return;

        // Clear any existing heartbeat interval
        if (player.pingInterval) {
            clearInterval(player.pingInterval);
            this.cleanupIntervals.delete(player.pingInterval);
        }
        
        // Send ping every 30 seconds
        const pingInterval = setInterval(() => {
            const currentPlayer = this.players.get(playerId);
            if (!currentPlayer || !currentPlayer.isAlive) {
                clearInterval(pingInterval);
                this.cleanupIntervals.delete(pingInterval);
                return;
            }
            
            // Check if player is responsive
            const timeSinceLastActivity = Date.now() - currentPlayer.lastActivity;
            if (timeSinceLastActivity > this.GAME_CONFIG.CONNECTION_TIMEOUT) {
                console.log(`⏰ Player ${playerId} timed out (${timeSinceLastActivity}ms)`);
                clearInterval(pingInterval);
                this.cleanupIntervals.delete(pingInterval);
                this.handleDisconnection(playerId);
                return;
            }
            
            // Send ping
            const success = this.sendToPlayer(playerId, {
                type: 'ping',
                timestamp: Date.now()
            });
            
            if (!success) {
                clearInterval(pingInterval);
                this.cleanupIntervals.delete(pingInterval);
                this.handleDisconnection(playerId);
            }
            
        }, this.GAME_CONFIG.PING_INTERVAL);

        // Store interval reference for proper cleanup
        player.pingInterval = pingInterval;
        this.cleanupIntervals.add(pingInterval);
    }
    
    handleMessage(playerId, data) {
        const player = this.players.get(playerId);
        if (!player || !player.isAlive) {
            console.warn(`📤 Message from inactive player ${playerId}`);
            return;
        }
        
        // Parse message with error handling
        let message;
        try {
            message = JSON.parse(data.toString());
        } catch (error) {
            throw new Error(`JSON parse error: ${error.message}`);
        }

        // Log message processing for monitoring
        console.log(`📥 Received message from ${playerId}:`, message.type, message.action?.type || 'no action');
        
        // Route message based on type
        try {
            switch (message.type) {
                case 'setNickname':
                    this.handleSetNickname(playerId, message);
                    break;
                    
                case 'joinQueue':
                    this.handleJoinQueue(playerId, message);
                    break;
                    
                case 'leaveQueue':
                    this.handleLeaveQueue(playerId, message);
                    break;
                    
                case 'playerMove':
                    this.handlePlayerMove(playerId, message);
                    break;
                    
                case 'placeBomb':
                    this.handlePlaceBomb(playerId, message);
                    break;
                    
                // Handle power-up collection events
                case 'powerUpCollected':
                    this.handlePowerUpCollected(playerId, message);
                    break;
                    
                case 'chatMessage':
                    this.handleChatMessage(playerId, message);
                    break;
                    
                case 'ping':
                    this.handlePing(playerId, message);
                    break;
                    
                case 'pong':
                    this.handlePong(playerId, message);
                    break;
                case 'playerAction':
                    this.handlePlayerAction(playerId, message);
                    break;

                case 'playerActionBatch':
                    this.handlePlayerActionBatch(playerId, message);
                    break;

                case 'playerHitByExplosion':
                    this.handlePlayerHitByExplosion(playerId, message);
                    break;

                default:
                    console.warn(`⚠️ Unknown message type: ${message.type} from ${playerId}`);
                    this.sendToPlayer(playerId, {
                        type: 'error',
                        message: `Unknown message type: ${message.type}`,
                        code: 'UNKNOWN_MESSAGE_TYPE'
                    });
            }
        } catch (error) {
            console.error(`❌ Error handling ${message.type} from ${playerId}: ${error.message}`);
            this.sendToPlayer(playerId, {
                type: 'error',
                message: 'Error processing message',
                code: 'PROCESSING_ERROR'
            });
        }
    }
    
    
    /**
     * Handle pong response from client for connection health monitoring
     */
    handlePong(playerId, message) {
        const player = this.players.get(playerId);
        if (!player) return;
        
        // Update last ping time
        player.lastPing = Date.now();
        
        // Calculate round-trip time if timestamp provided
        if (message.timestamp) {
            const rtt = Date.now() - message.timestamp;
            console.log(`💓 Pong from ${playerId} (RTT: ${rtt}ms)`);
        }
        
        // Player is responsive, no further action needed
    }
    handlePlayerAction(playerId, message) {
        const player = this.players.get(playerId);
        if (!player) return;

        const action = message.action;
        if (!action || !action.type) {
            console.warn(`Invalid player action from ${playerId}:`, action);
            return;
        }

        // Log player actions for monitoring
        if (action.type === 'move') {
            console.log(`🎮 Player ${playerId} move action: ${action.direction}`);
        }

        // Find the game this player is in
        const game = Array.from(this.games.values()).find(g => g.players.has(playerId));
        if (!game) {
            console.warn(`Player ${playerId} not in any game`);
            return;
        }

        // Forward action to game room
        switch (action.type) {
            case 'move':
                console.log(`🎮 Forwarding move to game: ${playerId} -> ${action.direction}`);
                game.handlePlayerMovement(playerId, action.direction, action);
                break;

            case 'placeBomb':
                game.handleBombPlacement(playerId);
                break;

            case 'openChat':
                // Chat opening is handled client-side
                break;

            default:
                console.warn(`Unknown player action type: ${action.type}`);
        }

        // console.log(`🎮 Player ${playerId} action: ${action.type}`);
    }

    /**
     * Handle batched player actions for performance optimization
     */
    handlePlayerActionBatch(playerId, message) {
        const player = this.players.get(playerId);
        if (!player) return;

        const actions = message.actions;
        if (!actions || !Array.isArray(actions)) {
            console.warn(`Invalid player action batch from ${playerId}:`, actions);
            return;
        }

        // Find the game this player is in
        const game = Array.from(this.games.values()).find(g => g.players.has(playerId));
        if (!game) {
            console.warn(`Player ${playerId} not in any game for batch actions`);
            return;
        }

        // Process each action in the batch
        actions.forEach(action => {
            if (!action || !action.type) {
                console.warn(`Invalid action in batch from ${playerId}:`, action);
                return;
            }

            // Forward action to game room
            switch (action.type) {
                case 'move':
                    game.handlePlayerMovement(playerId, action.direction, action);
                    break;

                case 'placeBomb':
                    game.handleBombPlacement(playerId);
                    break;

                case 'openChat':
                    // Chat opening is handled client-side
                    break;

                default:
                    console.warn(`Unknown player action type in batch: ${action.type}`);
            }
        });

        // console.log(`🎮 Player ${playerId} batch: ${actions.length} actions`);
    }

    handleSetNickname(playerId, message) {
        const player = this.players.get(playerId);
        if (!player) return;
        
        // Validate nickname
        const nickname = message.nickname?.trim();
        if (!nickname || nickname.length < 1 || nickname.length > 20) {
            this.sendToPlayer(playerId, {
                type: 'error',
                message: 'Nickname must be 1-20 characters',
                code: 'INVALID_NICKNAME'
            });
            return;
        }
        
        // Check for duplicate nicknames
        const existingPlayer = Array.from(this.players.values())
            .find(p => p.nickname === nickname && p.id !== playerId);
        
        if (existingPlayer) {
            this.sendToPlayer(playerId, {
                type: 'error',
                message: 'Nickname already taken',
                code: 'NICKNAME_TAKEN'
            });
            return;
        }
        
        player.nickname = nickname;
        console.log(`📝 Player ${playerId} set nickname: ${nickname}`);
        
        this.sendToPlayer(playerId, {
            type: 'nicknameSet',
            nickname: nickname,
            playerId: playerId
        });
    }
    
    handleJoinQueue(playerId, message) {
        const player = this.players.get(playerId);
        if (!player) return;
        
        // Validate player has nickname
        if (!player.nickname) {
            this.sendToPlayer(playerId, {
                type: 'error',
                message: 'Set nickname before joining queue',
                code: 'NICKNAME_REQUIRED'
            });
            return;
        }
        
        // Check if already in queue or game
        if (this.waitingQueue.has(playerId) || player.gameId) {
            console.warn(`⚠️ Player ${playerId} already in queue or game`);
            return;
        }
        
        // Add to waiting queue
        this.waitingQueue.add(playerId);
        console.log(`🎯 ${player.nickname} joined queue (${this.waitingQueue.size}/${this.GAME_CONFIG.MAX_PLAYERS})`);

        // Send queue join confirmation with current state
        this.sendToPlayer(playerId, {
            type: 'queueJoined',
            queueSize: this.waitingQueue.size,
            maxPlayers: this.GAME_CONFIG.MAX_PLAYERS,
            players: Array.from(this.waitingQueue).map(id => {
                const p = this.players.get(id);
                return { id: id, nickname: p?.nickname || 'Unknown' };
            })
        });

        // If queue countdown is active, send current state to new player
        if (this.queueTimer && this.queueTimer !== 'expired') {
            this.sendToPlayer(playerId, {
                type: 'queueCountdown',
                countdown: this.queueCountdown,
                queueSize: this.waitingQueue.size,
                maxPlayers: this.GAME_CONFIG.MAX_PLAYERS,
                players: Array.from(this.waitingQueue).map(id => {
                    const p = this.players.get(id);
                    return { id: id, nickname: p?.nickname || 'Unknown' };
                })
            });
        } else {
            // Regular queue update
            this.broadcastQueueUpdate();
        }
        
        // Attempt to start game (will handle queue logic)
        this.attemptGameStart();
    }
    
    handleLeaveQueue(playerId, message) {
        if (this.waitingQueue.has(playerId)) {
            this.waitingQueue.delete(playerId);
            
            const player = this.players.get(playerId);
            console.log(`🚪 ${player?.nickname || playerId} left queue`);
            
            // If we drop below minimum players, cancel queue countdown
            if (this.waitingQueue.size < this.GAME_CONFIG.MIN_PLAYERS) {
                console.log(`⏰ Queue dropped below minimum players - cancelling countdown`);
                this.clearQueueTimer();
            }
            
            // Update remaining players
            if (this.queueTimer && this.queueTimer !== 'expired') {
                this.broadcastQueueCountdown();
            } else {
                this.broadcastQueueUpdate();
            }
        }
    }
    
    handlePlayerMove(playerId, message) {
        const player = this.players.get(playerId);
        if (!player || !player.gameId) return;
        
        const game = this.games.get(player.gameId);
        if (!game) return;
        
        // Forward movement to game room
        game.handlePlayerMovement(playerId, message.direction, message);
    }
    
    handlePlaceBomb(playerId, message) {
        const player = this.players.get(playerId);
        if (!player || !player.gameId) return;
        
        const game = this.games.get(player.gameId);
        if (!game) return;
        
        // Forward bomb placement to game room
        game.handleBombPlacement(playerId);
    }

    handlePowerUpCollected(playerId, message) {
        const player = this.players.get(playerId);
        if (!player || !player.gameId) return;
        
        const game = this.games.get(player.gameId);
        if (!game) return;
        
        // Forward power-up collection to game room
        game.handlePlayerCollectedPowerUp({
            player: game.players.get(playerId),
            powerUp: message.powerUp
        });
        
        console.log(`🎁 Player ${playerId} collected power-up: ${message.powerUp?.type}`);
    }
    
    handleChatMessage(playerId, message) {
        const player = this.players.get(playerId);
        if (!player) return;
        
        // Validate message
        const chatText = message.message?.trim();
        if (!chatText || chatText.length > 200) {
            return; // Ignore invalid messages
        }
        
        // Simple spam protection
        const now = Date.now();
        player.lastChatTime = player.lastChatTime || 0;
        if (now - player.lastChatTime < 1000) { // 1 second cooldown
            this.sendToPlayer(playerId, {
                type: 'error',
                message: 'Please wait before sending another message',
                code: 'CHAT_COOLDOWN'
            });
            return;
        }
        player.lastChatTime = now;
        
        // Broadcast to game or queue
        const chatMessage = {
            type: 'chatMessage',
            playerId: playerId,
            nickname: player.nickname,
            message: chatText,
            timestamp: Date.now()
        };
        
        if (player.gameId) {
            this.broadcastToGame(player.gameId, chatMessage);
        } else {
            this.broadcastToQueue(chatMessage);
        }
        
        console.log(`💬 ${player.nickname}: ${chatText}`);
    }

    handlePlayerHitByExplosion(playerId, message) {
        const player = this.players.get(playerId);
        if (!player || !player.gameId) return;

        const game = this.games.get(player.gameId);
        if (!game) return;

        // Apply damage through the game room's damage system
        game.damagePlayer(playerId);

        console.log(`💥 Player ${playerId} hit by explosion`);
    }


    handlePing(playerId, message) {
        const player = this.players.get(playerId);
        if (!player) return;
        
        player.lastPing = Date.now();
        
        this.sendToPlayer(playerId, {
            type: 'pong',
            timestamp: message.timestamp,
            serverTime: Date.now()
        });
    }
    
    handleDisconnection(playerId) {
        console.log(`🔌 Player ${playerId} disconnecting with cleanup...`);
        
        const player = this.players.get(playerId);
        if (player) {
            // Clean up player-specific timers and intervals
            if (player.pingInterval) {
                clearInterval(player.pingInterval);
                this.cleanupIntervals.delete(player.pingInterval);
                player.pingInterval = null;
            }
            
            // Remove from game if in one
            if (player.gameId) {
                const game = this.games.get(player.gameId);
                if (game) {
                    game.removePlayer(playerId);
                    
                    // Clean up empty games
                    if (game.players.size === 0) {
                        try {
                            game.destroy();
                            this.games.delete(player.gameId);
                            this.stats.activeGames--;
                            console.log(`🎮 Empty game ${player.gameId} destroyed`);
                        } catch (error) {
                            console.error(`❌ Error destroying game ${player.gameId}:`, error.message);
                            // Still remove the game even if cleanup fails
                            this.games.delete(player.gameId);
                            this.stats.activeGames--;
                        }
                    }
                }
            }
            
            // Remove from waiting queue
            this.waitingQueue.delete(playerId);

            // Mark player as disconnected for cleanup tracking
            player.isAlive = false;
            player.disconnectedAt = Date.now();
        }

        // IMPORTANT: Remove player data completely to allow rejoining with same nickname
        this.players.delete(playerId);

        // Update connection stats
        this.stats.currentConnections--;

        // Broadcast queue update
        this.broadcastQueueUpdate();

        console.log(`🔌 Player ${playerId} cleanup completed`);
    }
    
    broadcastQueueUpdate() {
        const queueData = {
            type: 'queueUpdate',
            queueSize: this.waitingQueue.size,
            maxPlayers: this.GAME_CONFIG.MAX_PLAYERS,
            players: Array.from(this.waitingQueue).map(id => {
                const player = this.players.get(id);
                return {
                    id: id,
                    nickname: player?.nickname || 'Unknown'
                };
            })
        };
        
        // Send to all players in queue
        this.waitingQueue.forEach(playerId => {
            this.sendToPlayer(playerId, queueData);
        });
    }
    
    broadcastToQueue(message) {
        this.waitingQueue.forEach(playerId => {
            this.sendToPlayer(playerId, message);
        });
    }
    
    /**
     * Attempt to start a new game with queued players
     */
    attemptGameStart() {
        const queueSize = this.waitingQueue.size;
        
        // Check minimum players
        if (queueSize < this.GAME_CONFIG.MIN_PLAYERS) {
            console.log(`⏳ Waiting for more players (${queueSize}/${this.GAME_CONFIG.MIN_PLAYERS})`);
            return;
        }
        
        // Check maximum games limit
        if (this.games.size >= this.GAME_CONFIG.MAX_GAMES) {
            console.warn(`⚠️ Maximum games limit reached (${this.games.size}/${this.GAME_CONFIG.MAX_GAMES})`);
            this.broadcastToQueue({
                type: 'error',
                message: 'Server is at capacity. Please try again later.',
                code: 'SERVER_FULL'
            });
            return;
        }
        
        // NEW: Handle queue-level waiting logic
        if (queueSize === this.GAME_CONFIG.MIN_PLAYERS && !this.queueTimer) {
            // First time we have minimum players - start queue countdown
            console.log(`⏰ Starting 20-second queue countdown with ${queueSize} players`);
            this.startQueueWaitingPeriod();
            return;
        }
        
        // Create game immediately if we have max players OR timer expired
        if (queueSize >= this.GAME_CONFIG.MAX_PLAYERS || this.queueTimer === 'expired') {
            console.log(`🎮 Creating game: ${queueSize} players (${this.queueTimer === 'expired' ? 'timer expired' : 'max players reached'})`);
            this.clearQueueTimer();
            this.startNewGame();
        }
    }

    // NEW: Start queue-level 20-second waiting period
    startQueueWaitingPeriod() {
        this.queueWaitStartTime = Date.now();
        this.queueCountdown = 20;
        
        console.log(`⏰ Queue countdown started: ${this.queueCountdown} seconds`);
        
        // Broadcast initial queue countdown to all waiting players
        this.broadcastQueueCountdown();
        
        // Set up main timer (20 seconds)
        this.queueTimer = setTimeout(() => {
            console.log(`⏰ Queue countdown completed - creating game with ${this.waitingQueue.size} players`);
            this.queueTimer = 'expired';
            this.attemptGameStart(); // This will create the game
        }, 20000);
        
        // Update countdown every second
        this.queueCountdownInterval = setInterval(() => {
            this.queueCountdown--;
            
            if (this.queueCountdown >= 0) {
                this.broadcastQueueCountdown();
            }
            
            if (this.queueCountdown <= 0) {
                clearInterval(this.queueCountdownInterval);
                this.queueCountdownInterval = null;
            }
        }, 1000);
    }

    // NEW: Broadcast queue countdown to waiting players
    broadcastQueueCountdown() {
        const queueData = {
            type: 'queueCountdown',
            countdown: this.queueCountdown,
            queueSize: this.waitingQueue.size,
            maxPlayers: this.GAME_CONFIG.MAX_PLAYERS,
            players: Array.from(this.waitingQueue).map(id => {
                const player = this.players.get(id);
                return {
                    id: id,
                    nickname: player?.nickname || 'Unknown'
                };
            })
        };
        
        // Send to all players in queue
        this.waitingQueue.forEach(playerId => {
            this.sendToPlayer(playerId, queueData);
        });
    }

    // NEW: Clear queue timer and intervals
    clearQueueTimer() {
        if (this.queueTimer && this.queueTimer !== 'expired') {
            clearTimeout(this.queueTimer);
        }
        
        if (this.queueCountdownInterval) {
            clearInterval(this.queueCountdownInterval);
            this.queueCountdownInterval = null;
        }
        
        this.queueTimer = null;
        this.queueWaitStartTime = null;
        this.queueCountdown = 20;
    }

    
    /**
     * Create and start a new game with queued players
     */
    startNewGame() {
        if (this.games.size >= this.GAME_CONFIG.MAX_GAMES) {
            console.warn('⚠️ Maximum games limit reached');
            return;
        }
        
        // Get players from queue (up to MAX_PLAYERS)
        const playerIds = Array.from(this.waitingQueue).slice(0, this.GAME_CONFIG.MAX_PLAYERS);
        const gameId = this.generateId('game');

        // Get player data with nicknames
        const playerData = playerIds.map(playerId => {
            const player = this.players.get(playerId);
            return {
                id: playerId,
                nickname: player?.nickname || `Player${playerId}`
            };
        });

        console.log(`🎮 Creating new game ${gameId} with players: ${playerIds.join(', ')}`);

        try {
            // Create new game room instance
            const gameRoom = new GameRoom(gameId, playerData, this.GAME_CONFIG);
            
            // Set up broadcast callback for the game room
            gameRoom.setBroadcastCallback((message) => {
                this.broadcastToGame(gameId, message);
            });

            // Set up end game callback for the game room
            gameRoom.setEndGameCallback((gameId, reason) => {
                this.endGame(gameId, reason);
            });
            
            // Store the game
            this.games.set(gameId, gameRoom);
            
            // Move players from queue to game
            playerIds.forEach(playerId => {
                const player = this.players.get(playerId);
                if (player) {
                    player.gameId = gameId;
                    this.waitingQueue.delete(playerId);
                }
            });
            
            // Update statistics
            this.stats.totalGames++;
            this.stats.activeGames++;
            
            // Update queue for remaining players
            this.broadcastQueueUpdate();
            
            console.log(`✅ Game ${gameId} created successfully with ${playerData.length} players`);
            console.log(`📊 Server stats: ${this.stats.activeGames} active games, ${this.waitingQueue.size} players in queue`);

        } catch (error) {
            console.error(`❌ Failed to create game ${gameId}: ${error.message}`);
            console.error(error.stack);

            // Return players to queue on error
            playerIds.forEach(playerId => {
                const player = this.players.get(playerId);
                if (player) {
                    player.gameId = null;
                    this.sendToPlayer(playerId, {
                        type: 'error',
                        message: 'Failed to create game. Try again.',
                        code: 'GAME_CREATION_FAILED'
                    });
                }
            });
        }
    }
    
    endGame(gameId, reason = 'completed') {
        const game = this.games.get(gameId);
        if (!game) {
            console.warn(`⚠️ Attempted to end non-existent game: ${gameId}`);
            return;
        }
        
        console.log(`🏁 Ending game ${gameId} (${reason})`);
        
        try {
            // Notify all players in the game
            if (game.players && game.players.forEach) {
                game.players.forEach((player, playerId) => {
                    const playerConnection = this.players.get(playerId);
                    if (playerConnection) {
                        playerConnection.gameId = null;
                        this.sendToPlayer(playerId, {
                            type: 'gameEnded',
                            reason: reason,
                            timestamp: Date.now()
                        });
                    }
                });
            }
            
            // Clean up game resources
            if (typeof game.destroy === 'function') {
                game.destroy();
            } else {
                console.warn(`⚠️ Game ${gameId} does not have destroy method`);
            }
            
            this.games.delete(gameId);
            
            // Update statistics
            this.stats.activeGames = Math.max(0, this.stats.activeGames - 1);
            
            console.log(`✅ Game ${gameId} ended and cleaned up`);
            
        } catch (error) {
            console.error(`❌ Error ending game ${gameId}:`, error.message);
            
            // Force cleanup even if there was an error
            this.games.delete(gameId);
            this.stats.activeGames = Math.max(0, this.stats.activeGames - 1);
        }
    }
    
    broadcastToGame(gameId, message) {
        const game = this.games.get(gameId);
        if (!game) return;
        
        // Send message to all players in the game
        game.players.forEach((gamePlayer, playerId) => {
            this.sendToPlayer(playerId, message);
        });
    }
    
    sendToPlayer(playerId, message) {
        const player = this.players.get(playerId);
        if (!player || !player.ws || player.ws.readyState !== 1) {
            return false;
        }

        try {
            // Log queue-related messages for monitoring
            if (message.type === 'queueUpdate' || message.type === 'queueCountdown' || message.type === 'queueJoined') {
                console.log(`📤 Sending ${message.type} to ${player.nickname || playerId}:`, {
                    type: message.type,
                    queueSize: message.queueSize,
                    countdown: message.countdown,
                    playersCount: message.players?.length || 0,
                    fullMessage: message
                });
            }

            const messageStr = JSON.stringify(message);
            player.ws.send(messageStr);

            if (message.type === 'error' || message.type === 'gameStart' || message.type === 'gameEnd') {
                console.log(`📤 Sent ${message.type} to ${player.nickname || playerId}: ${message.message || 'no message'}`);
            }
            return true;
        } catch (error) {
            console.error(`❌ Failed to send message to ${playerId}: ${error.message}`);
            this.handleDisconnection(playerId);
            return false;
        }
    }
    
    startPerformanceMonitoring() {
        const monitoringInterval = setInterval(() => {
            if (this.isShuttingDown) {
                clearInterval(monitoringInterval);
                return;
            }
            
            const uptime = Date.now() - this.stats.startTime;
            const memUsage = process.memoryUsage();
            
            console.log(`📊 Server Stats:
            ├── Uptime: ${Math.floor(uptime / 1000)}s
            ├── Connections: ${this.stats.currentConnections} (${this.stats.totalConnections} total)
            ├── Active Games: ${this.stats.activeGames} (${this.stats.totalGames} total)
            ├── Queue Size: ${this.waitingQueue.size}
            └── Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
            
        }, 60000); // Every minute
        
        this.cleanupIntervals.add(monitoringInterval);
    }
    
    generateId(prefix = 'id') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    }
}

// Start the server
const server = new BombermanServer(8080);

export default BombermanServer;
// src/core/NetworkManager.js
// Handles all WebSocket communication with the server

import { GAME_CONFIG, EVENT_TYPES } from '../utils/Constants.js';
import { Logger } from '../utils/Logger.js';
import { eventManager, EventCleanupMixin } from '../utils/EventManager.js';

/**
 * Enhanced Network Manager with Delta Compression and Client-Side Prediction
 * Implements message prioritization, delta compression, and server reconciliation
 * Uses NetworkWorker for off-main-thread processing to maintain 60+ FPS
 */
export class NetworkManager extends EventCleanupMixin {
    constructor(workerManager = null) {
        super(); // Initialize EventCleanupMixin
        this.logger = new Logger('NetworkManager');

        //  Set up event manager
        this.setEventManager(eventManager);

        // Worker integration
        this.workerManager = workerManager;
        this.useWorkers = !!workerManager;

        // Connection state
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = GAME_CONFIG.RECONNECT_ATTEMPTS;
        this.reconnectDelay = GAME_CONFIG.RECONNECT_DELAY;

        // Message handling
        this.messageQueue = [];
        this.listeners = new Map();
        this.lastPingTime = 0;
        this.latency = 0;

        //  Delta compression and state tracking
        this.deltaCompression = {
            enabled: true,
            lastGameState: null,
            compressionRatio: 0,
            stateHistory: [],
            maxHistorySize: 10
        };

        //  Client-side prediction system
        this.prediction = {
            enabled: true,
            sequenceNumber: 0,
            pendingActions: new Map(),
            lastServerUpdate: Date.now(),
            reconciliationThreshold: 50 // ms
        };

        //  Message prioritization
        this.messagePriorities = {
            'move': 0,              // CRITICAL - Player movement actions
            'placeBomb': 0,         // CRITICAL
            'playerAction': 0,      // CRITICAL
            'gameState': 1,         // HIGH
            'playerUpdate': 1,      // HIGH
            'chatMessage': 2,       // MEDIUM
            'statistics': 3         // LOW
        };

        this.lastGameStateHash = null;

        //  Message batching for performance
        this.messageBatch = {
            actions: [],
            batchTimeout: null,
            batchInterval: 16, // ~60fps batching
            maxBatchSize: 10
        };

        //  Rate limiting for different message types
        this.rateLimits = {
            move: { lastSent: 0, interval: 16 }, // ~60fps movement rate limiting
            placeBomb: { lastSent: 0, interval: 200 }, // 200ms between bomb placements
            chatMessage: { lastSent: 0, interval: 1000 } // 1 second between chat messages
        };
        
        // Heartbeat
        this.heartbeatInterval = null;
        this.connectionTimeout = null;
        
        this.logger.info('Network manager created');
    }

    /**
     * Set worker manager for off-main-thread processing
     */
    setWorkerManager(workerManager) {
        this.workerManager = workerManager;
        this.useWorkers = !!workerManager;
        this.logger.info('NetworkManager worker integration enabled');
    }

    /**
     * Set performance monitor for worker tracking
     */
    setPerformanceMonitor(performanceMonitor) {
        this.performanceMonitor = performanceMonitor;
    }

    /**
     * Connect to the game server
     */
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}`;
        
        this.logger.info('Connecting to server:', wsUrl);
        
        try {
            this.ws = new WebSocket(wsUrl);
            this.setupEventHandlers();
        } catch (error) {
            this.logger.error('Failed to create WebSocket connection:', error);
            this.handleConnectionError();
        }
    }
    
    /**
     * Setup WebSocket event handlers
     */
    setupEventHandlers() {
        this.ws.onopen = (event) => {
            this.handleConnectionOpen(event);
        };
        
        this.ws.onmessage = (event) => {
            this.handleMessage(event);
        };
        
        this.ws.onclose = (event) => {
            this.handleConnectionClose(event);
        };
        
        this.ws.onerror = (event) => {
            this.handleConnectionError(event);
        };
    }
    
    /**
     * Handle connection opened
     */
    handleConnectionOpen() {
        this.logger.info('✅ Connected to server');
        
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Send queued messages
        this.flushMessageQueue();
        
        // Emit connection event
        this.emit(EVENT_TYPES.CONNECTED, {
            timestamp: Date.now()
        });
    }
    
    /**
     * Handle incoming message with delta decompression and prediction reconciliation
     */
    handleMessage(event) {
        try {
            const message = JSON.parse(event.data);

            this.logger.network('received', message.type, message);

            // Handle ping/pong for latency measurement
            if (message.type === 'pong') {
                this.latency = Date.now() - this.lastPingTime;
                return;
            }

            if (message.type === 'ping') {
                this.send({ type: 'pong' });
                return;
            }

            if (this.useWorkers && this.workerManager) {
                // Send to network worker for processing
                this.sendMessageToWorker([message]);
            } else {
                // Fallback to main thread processing
                this.processMessageMainThread(message);
            }

        } catch (error) {
            this.logger.error('Failed to parse message:', error, event.data);
        }
    }

    /**
     * Send messages to network worker for processing
     */
    sendMessageToWorker(messages) {
        try {
            const startTime = performance.now();

            const success = this.workerManager.sendToWorker('network', {
                type: 'PROCESS_INCOMING',
                data: {
                    messages: messages,
                    timestamp: startTime
                }
            });

            if (!success) {
                this.logger.warn('Failed to send messages to worker - falling back to main thread');
                this.recordWorkerFallback('network', 'incoming message send failed');
                messages.forEach(message => this.processMessageMainThread(message));
            } else {
                // Record successful message send
                const processingTime = performance.now() - startTime;
                this.recordWorkerMessage('network', processingTime, true);
            }

        } catch (error) {
            this.logger.error('Error sending messages to worker:', error);
            this.recordWorkerFallback('network', 'incoming message send error');
            messages.forEach(message => this.processMessageMainThread(message));
        }
    }

    /**
     * Process message on main thread (fallback)
     */
    processMessageMainThread(message) {
        try {
            //  Handle delta-compressed game state
            if (message.type === 'gameState' && message.compressionType === 'delta') {
                const decompressedState = this.decompressGameState(message.data);
                if (decompressedState) {
                    message.data = decompressedState;
                    this.updateDeltaCompressionState(decompressedState);
                }
            }

            //  Handle server reconciliation for predicted actions
            if (message.type === 'actionConfirmation') {
                this.handleActionConfirmation(message);
                return;
            }

            //  Update prediction system with server data
            if (message.type === 'gameState' || message.type === 'playerUpdate') {
                this.updatePredictionSystem(message);
            }

            // DEBUGGING: Log specific message types that are causing issues
            if (message.type === 'countdownUpdate' || message.type === 'gameStart' ||
                message.type === 'queueUpdate' || message.type === 'queueCountdown' || message.type === 'queueJoined') {
                this.logger.info(`NetworkManager routing ${message.type}:`, {
                    messageType: message.type,
                    hasData: !!message,
                    dataKeys: Object.keys(message || {}),
                    queueSize: message.queueSize,
                    countdown: message.countdown,
                    playersCount: message.players?.length || 0,
                    fullMessage: message
                });
            }

            // Route message to appropriate handler
            this.emit(message.type, message);

        } catch (error) {
            this.logger.error('Error processing message on main thread:', error);
        }
    }

    /**
     * Decompress delta-compressed game state
     */
    decompressGameState(deltaData) {
        if (!this.deltaCompression.lastGameState) {
            this.logger.warn('Cannot decompress delta without base state');
            return null;
        }

        try {
            const baseState = this.deltaCompression.lastGameState;
            const decompressedState = { ...baseState };

            // Apply player deltas
            if (deltaData.players) {
                Object.entries(deltaData.players).forEach(([playerId, playerDelta]) => {
                    if (playerDelta.type === 'new') {
                        decompressedState.players[playerId] = playerDelta.data;
                    } else if (playerDelta.type === 'update') {
                        if (decompressedState.players[playerId]) {
                            Object.assign(decompressedState.players[playerId], playerDelta.data);
                        }
                    } else if (playerDelta.type === 'removed') {
                        delete decompressedState.players[playerId];
                    }
                });
            }

            // Apply bomb deltas
            if (deltaData.bombs) {
                Object.entries(deltaData.bombs).forEach(([bombId, bombDelta]) => {
                    if (bombDelta.type === 'new') {
                        decompressedState.bombs.set(bombId, bombDelta.data);
                    } else if (bombDelta.type === 'update') {
                        const bomb = decompressedState.bombs.get(bombId);
                        if (bomb) {
                            Object.assign(bomb, bombDelta.data);
                        }
                    } else if (bombDelta.type === 'removed') {
                        decompressedState.bombs.delete(bombId);
                    }
                });
            }

            // Apply explosion deltas
            if (deltaData.explosions) {
                Object.entries(deltaData.explosions).forEach(([explosionId, explosionDelta]) => {
                    if (explosionDelta.type === 'new') {
                        decompressedState.explosions.set(explosionId, explosionDelta.data);
                    } else if (explosionDelta.type === 'removed') {
                        decompressedState.explosions.delete(explosionId);
                    }
                });
            }

            return decompressedState;

        } catch (error) {
            this.logger.error('Failed to decompress game state:', error);
            return null;
        }
    }

    /**
     *  Update delta compression state
     */
    updateDeltaCompressionState(gameState) {
        this.deltaCompression.lastGameState = gameState;

        // Add to history for rollback
        this.deltaCompression.stateHistory.push({
            state: { ...gameState },
            timestamp: Date.now()
        });

        // Limit history size
        if (this.deltaCompression.stateHistory.length > this.deltaCompression.maxHistorySize) {
            this.deltaCompression.stateHistory.shift();
        }
    }
    
    /**
     * Handle connection closed
     */
    handleConnectionClose(event) {
        this.logger.warn('Connection closed:', event.code, event.reason);
        
        this.isConnected = false;
        this.stopHeartbeat();
        
        // Emit disconnection event
        this.emit(EVENT_TYPES.DISCONNECTED, {
            code: event.code,
            reason: event.reason,
            timestamp: Date.now()
        });
        
        // Attempt reconnection if not intentional
        if (event.code !== 1000) { // 1000 = normal closure
            this.attemptReconnection();
        }
    }
    
    /**
     * Handle connection error
     */
    handleConnectionError(event) {
        this.logger.error('WebSocket error:', event);
        
        if (!this.isConnected) {
            this.attemptReconnection();
        }
    }
    
    /**
     * Attempt to reconnect
     */
    attemptReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.logger.error('❌ Max reconnection attempts reached');
            this.emit('connectionFailed', {
                attempts: this.reconnectAttempts,
                maxAttempts: this.maxReconnectAttempts
            });
            return;
        }
        
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        
        this.logger.info(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        this.emit(EVENT_TYPES.RECONNECTING, {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            delay
        });
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }

    updateConnectionState(newState) {
        const oldState = this.connectionState;
        this.connectionState = newState;
        
        // Update the connected flag
        this.isConnected = (newState === 'connected');
        
        // Notify StateManager about connection change
        if (this.stateManager) {
            this.stateManager.updateState({
                isConnected: this.isConnected,
                connectionState: this.connectionState
            });
        }
        
        // Notify UIManager about connection change
        if (this.uiManager) {
            this.uiManager.updateConnectionState(this.isConnected, this.connectionState);
        }
        
        // Emit connection event
        this.emit('connectionStateChanged', {
            oldState,
            newState,
            isConnected: this.isConnected
        });
        
    }
    
    
    /**
     * Send message to server
     */
    send(message) {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            // Queue message for later
            this.messageQueue.push(message);
            // Only log occasionally to avoid spam
            if (this.messageQueue.length % 10 === 0) {
                this.logger.debug(`${this.messageQueue.length} messages queued (not connected)`);
            }
            return false;
        }
        
        try {
            const messageStr = JSON.stringify(message);
            this.ws.send(messageStr);
            
            this.logger.network('sent', message.type, message);
            return true;
        } catch (error) {
            this.logger.error('Failed to send message:', error);
            return false;
        }
    }
    
    /**
     * Send queued messages
     */
    flushMessageQueue() {
        while (this.messageQueue.length > 0 && this.isConnected) {
            const message = this.messageQueue.shift();
            this.send(message);
        }
        
        // Only log if queue is getting large
        if (this.messageQueue.length > 10) {
            this.logger.debug(`${this.messageQueue.length} messages still queued`);
        }
    }
    
    /**
     * Send player action with client-side prediction and enhanced batching
     */
    sendPlayerAction(action) {
        const now = Date.now();
        const actionType = action.type;

        // DEBUGGING: Log movement actions to debug the issue
        if (actionType === 'move') {
            this.logger.info('NetworkManager sending move action:', {
                actionType: actionType,
                direction: action.direction,
                timestamp: now,
                isConnected: this.isConnected,
                wsState: this.ws?.readyState
            });
        }

        //  Client-side prediction for immediate feedback
        if (this.prediction.enabled) {
            const sequenceNumber = ++this.prediction.sequenceNumber;

            // Store action for server reconciliation
            this.prediction.pendingActions.set(sequenceNumber, {
                action: action,
                timestamp: now,
                sequenceNumber: sequenceNumber
            });

            // Add sequence number to action
            action.sequenceNumber = sequenceNumber;
        }

        if (actionType === 'move') {
            this.logger.info('DEBUGGING priority lookup:', {
                actionType: actionType,
                messagePriorities: this.messagePriorities,
                movePriority: this.messagePriorities?.move,
                hasPriorities: !!this.messagePriorities,
                prioritiesKeys: this.messagePriorities ? Object.keys(this.messagePriorities) : 'undefined'
            });
        }

        //  Rate limiting based on action type with priority
        const priority = actionType in this.messagePriorities 
            ? this.messagePriorities[actionType] 
            : 3;

        if (this.rateLimits[actionType]) {
            const rateLimit = this.rateLimits[actionType];
            if (now - rateLimit.lastSent < rateLimit.interval && priority > 1) {
                // Add to batch for later sending (only for non-critical actions)
                this.addToBatch(action);
                return false;
            }
            rateLimit.lastSent = now;
        }


        //  Prioritized sending - critical actions bypass batching
        if (priority === 0) { // CRITICAL
            // DEBUGGING: Log critical actions being sent immediately
            if (actionType === 'move') {
                this.logger.info('Sending move action immediately (priority 0):', {
                    actionType: actionType,
                    direction: action.direction,
                    priority: priority
                });
            }
            return this.send({
                type: 'playerAction',
                action: action,
                timestamp: now,
                priority: priority
            });
        }

        //  Batch non-critical actions for efficiency
        if (priority > 0) {
            this.addToBatch(action);
            return true;
        }

        // Send immediately for other actions
        return this.send({
            type: 'playerAction',
            action: action,
            timestamp: now,
            priority: priority
        });
    }

    /**
     *  Handle action confirmation from server
     */
    handleActionConfirmation(message) {
        const { sequenceNumber, success, correctedState } = message.data;

        // Remove confirmed action from pending
        const pendingAction = this.prediction.pendingActions.get(sequenceNumber);
        if (pendingAction) {
            this.prediction.pendingActions.delete(sequenceNumber);

            // If action was rejected or corrected, emit correction event
            if (!success || correctedState) {
                eventManager.emit('serverMovementConfirmation', {
                    sequenceNumber: sequenceNumber,
                    success: success,
                    correctedState: correctedState,
                    originalAction: pendingAction.action,
                    timestamp: Date.now()
                });
            }
        }
    }

    /**
     *  Update prediction system with server data
     */
    updatePredictionSystem() {
        this.prediction.lastServerUpdate = Date.now();

        // Clean up old pending actions (older than 1 second)
        const cutoffTime = Date.now() - 1000;
        this.prediction.pendingActions.forEach((action, sequenceNumber) => {
            if (action.timestamp < cutoffTime) {
                this.prediction.pendingActions.delete(sequenceNumber);
            }
        });
    }

    /**
     *  Add action to batch for efficient sending
     */
    addToBatch(action) {
        this.messageBatch.actions.push(action);

        // Send batch if it's full
        if (this.messageBatch.actions.length >= this.messageBatch.maxBatchSize) {
            this.sendBatch();
            return;
        }

        // Schedule batch send if not already scheduled
        if (!this.messageBatch.batchTimeout) {
            this.messageBatch.batchTimeout = setTimeout(() => {
                this.sendBatch();
            }, this.messageBatch.batchInterval);
        }
    }

    /**
     *  Send batched actions
     */
    sendBatch() {
        if (this.messageBatch.actions.length === 0) return;

        // Clear timeout
        if (this.messageBatch.batchTimeout) {
            clearTimeout(this.messageBatch.batchTimeout);
            this.messageBatch.batchTimeout = null;
        }

        // Send batch
        const batch = [...this.messageBatch.actions];
        this.messageBatch.actions = [];

        const message = {
            type: 'playerActionBatch',
            actions: batch,
            timestamp: Date.now()
        };

        if (this.useWorkers && this.workerManager) {
            // Send to worker for compression/processing
            this.sendOutgoingToWorker([message]);
        } else {
            // Send directly
            return this.send(message);
        }
    }

    /**
     * Send outgoing messages to worker for processing
     */
    sendOutgoingToWorker(messages) {
        try {
            const startTime = performance.now();

            const success = this.workerManager.sendToWorker('network', {
                type: 'QUEUE_OUTGOING',
                data: {
                    messages: messages
                }
            });

            if (!success) {
                this.logger.warn('Failed to send outgoing messages to worker - sending directly');
                this.recordWorkerFallback('network', 'outgoing message send failed');
                messages.forEach(message => this.send(message));
            } else {
                // Record successful message send
                const processingTime = performance.now() - startTime;
                this.recordWorkerMessage('network', processingTime, true);
            }

        } catch (error) {
            this.logger.error('Error sending outgoing messages to worker:', error);
            this.recordWorkerFallback('network', 'outgoing message send error');
            messages.forEach(message => this.send(message));
        }
    }

    /**
     * Record worker message processing
     */
    recordWorkerMessage(workerType, processingTime, success = true) {
        if (this.performanceMonitor) {
            this.performanceMonitor.recordWorkerMessage(workerType, processingTime, success);
        }
    }

    /**
     * Record worker fallback usage
     */
    recordWorkerFallback(workerType, reason = 'unknown') {
        if (this.performanceMonitor) {
            this.performanceMonitor.recordWorkerFallback(workerType, reason);
        }
    }

    /**
     * Send batch of messages (called by worker)
     */
    sendBatchFromWorker(messages) {
        messages.forEach(message => this.send(message));
    }
    
    /**
     * Send chat message
     */
    sendChatMessage(message) {
        return this.send({
            type: 'chatMessage',
            message: message,
            timestamp: Date.now()
        });
    }
    
    /**
     * Set nickname
     */
    setNickname(nickname) {
        return this.send({
            type: 'setNickname',
            nickname: nickname
        });
    }
    
    /**
     * Join matchmaking queue
     */
    joinQueue() {
        return this.send({
            type: 'joinQueue'
        });
    }
    
    /**
     * Leave matchmaking queue
     */
    leaveQueue() {
        return this.send({
            type: 'leaveQueue'
        });
    }
    
    /**
     * Start heartbeat to keep connection alive
     */
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected) {
                this.lastPingTime = Date.now();
                this.send({ type: 'ping', timestamp: this.lastPingTime });
            }
        }, GAME_CONFIG.PING_INTERVAL);
        
        // Connection timeout
        this.connectionTimeout = setInterval(() => {
            if (this.isConnected && Date.now() - this.lastPingTime > GAME_CONFIG.TIMEOUT_DURATION) {
                this.logger.warn('Connection timeout detected');
                this.ws.close();
            }
        }, GAME_CONFIG.TIMEOUT_DURATION / 2);
    }
    
    /**
     * Stop heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.connectionTimeout) {
            clearInterval(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }
    
    /**
     * Disconnect from server
     */
    disconnect() {
        this.logger.info('Disconnecting...');
        
        this.isConnected = false;
        this.isConnecting = false;
        
        // Clear all connection timers
        this.clearAllConnectionTimers();
        
        // Close WebSocket connection
        if (this.ws) {
            // Remove event listeners before closing
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close(1000, 'Client disconnect');
            }
            this.ws = null;
        }
        
        // Clear message queues
        if (this.messageQueue) {
            this.messageQueue.length = 0;
        }
        
        // Clear event listeners
        this.removeAllListeners();
        
        this.logger.info('Network manager disconnected and cleaned up');
    }

    clearAllConnectionTimers() {
        // Clear reconnection timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        // Clear ping interval
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        // Clear connection timeout
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        
        // Clear heartbeat timer
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    
    
    
    /**
     * Force reconnection
     */
    reconnect() {
        this.logger.info('Forcing reconnection');
        
        if (this.ws) {
            this.ws.close();
        }
        
        this.reconnectAttempts = 0;
        setTimeout(() => this.connect(), 100);
    }
    
    /**
     * Update network manager with enhanced processing
     */
    update() {
        //  Process prediction system cleanup
        this.cleanupPredictionSystem();

        //  Update delta compression statistics
        this.updateCompressionStats();

        // Process any pending network tasks
        this.processPendingTasks();
    }

    /**
     *  Clean up prediction system
     */
    cleanupPredictionSystem() {
        const now = Date.now();
        const cutoffTime = now - 2000; // 2 second timeout

        // Clean up old pending actions
        let cleanedCount = 0;
        this.prediction.pendingActions.forEach((action, sequenceNumber) => {
            if (action.timestamp < cutoffTime) {
                this.prediction.pendingActions.delete(sequenceNumber);
                cleanedCount++;
            }
        });

        // Only log if significant cleanup occurred
        if (cleanedCount > 5) {
            this.logger.debug(`Cleaned up ${cleanedCount} old pending actions`);
        }
    }

    /**
     *  Update compression statistics
     */
    updateCompressionStats() {
        // Calculate compression efficiency
        if (this.deltaCompression.stateHistory.length > 1) {
            const recent = this.deltaCompression.stateHistory.slice(-2);
            const oldSize = JSON.stringify(recent[0].state).length;
            const newSize = JSON.stringify(recent[1].state).length;

            if (oldSize > 0) {
                this.deltaCompression.compressionRatio = newSize / oldSize;
            }
        }
    }

    /**
     *  Process pending network tasks
     */
    processPendingTasks() {
        // Flush any pending batches if they're getting old
        if (this.messageBatch.actions.length > 0) {
            const oldestAction = this.messageBatch.actions[0];
            if (oldestAction && Date.now() - oldestAction.timestamp > 50) { // 50ms max delay
                this.sendBatch();
            }
        }
    }
    
    /**
     * Get comprehensive connection statistics
     */
    getStats() {
        return {
            isConnected: this.isConnected,
            latency: this.latency,
            reconnectAttempts: this.reconnectAttempts,
            queuedMessages: this.messageQueue.length,
            connectionState: this.ws ? this.ws.readyState : -1,

            //  Enhanced statistics
            deltaCompression: {
                enabled: this.deltaCompression.enabled,
                compressionRatio: this.deltaCompression.compressionRatio,
                stateHistorySize: this.deltaCompression.stateHistory.length
            },
            prediction: {
                enabled: this.prediction.enabled,
                pendingActions: this.prediction.pendingActions.size,
                sequenceNumber: this.prediction.sequenceNumber,
                lastServerUpdate: this.prediction.lastServerUpdate
            },
            batching: {
                pendingActions: this.messageBatch.actions.length,
                maxBatchSize: this.messageBatch.maxBatchSize,
                batchInterval: this.messageBatch.batchInterval
            }
        };
    }
    
    /**
     * Get current latency
     */
    getLatency() {
        return this.latency;
    }
    
    /**
     * Check if connected
     */
    checkConnection() {
        return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }
    
    /**
     * Add event listener
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        
        return () => {
            const callbacks = this.listeners.get(event);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index > -1) {
                    callbacks.splice(index, 1);
                }
            }
        };
    }
    
    /**
     * Emit event to listeners
     */
    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    this.logger.error('Error in network event callback:', error);
                }
            });
        }
    }
    
    /**
     * Remove all listeners
     */
    removeAllListeners() {
        this.listeners.clear();
    }
    
    /**
     * Cleanup network manager
     */
    cleanup() {
        this.disconnect();
        
        // Clear all stored references
        this.messageQueue = null;
        this.listeners = null;
        this.reconnectAttempts = 0;

        //  Clean up prediction system
        if (this.prediction) {
            this.prediction.pendingActions.clear();
        }

        //  Clean up delta compression
        if (this.deltaCompression) {
            this.deltaCompression.stateHistory.length = 0;
            this.deltaCompression.lastGameState = null;
        }

        //  Clean up all event listeners
        this.cleanupEvents();

        this.logger.info('Network manager cleanup completed');
    }
}

export default NetworkManager;
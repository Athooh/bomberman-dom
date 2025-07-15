/**
 * NetworkWorker - Off-main-thread network message processing
 * Handles delta compression, message prioritization, and batch processing
 * Reduces main thread network I/O blocking for stable 60+ FPS
 */

// Network state
let messageQueue = [];
let outgoingQueue = [];
let lastGameState = null;
let compressionEnabled = true;
let batchSize = 10;
let batchTimeout = 16; // ~60fps batching

// Message priorities
const MESSAGE_PRIORITIES = {
    CRITICAL: 0,    // Player input, bomb placement
    HIGH: 1,        // Game state updates
    MEDIUM: 2,      // Chat messages
    LOW: 3          // Statistics, non-essential data
};

// Delta compression state
let deltaCompressionCache = new Map();
let compressionRatio = 0;

/**
 * Delta compression for game state
 */
function compressGameState(currentState, previousState) {
    if (!previousState || !compressionEnabled) {
        return { type: 'full', data: currentState };
    }
    
    const delta = {};
    let hasChanges = false;
    
    // Compare players
    if (currentState.players && previousState.players) {
        const playerDeltas = {};
        
        Object.keys(currentState.players).forEach(playerId => {
            const current = currentState.players[playerId];
            const previous = previousState.players[playerId];
            
            if (!previous) {
                playerDeltas[playerId] = { type: 'new', data: current };
                hasChanges = true;
            } else {
                const playerDelta = {};
                let playerChanged = false;
                
                ['x', 'y', 'direction', 'isMoving', 'isAlive', 'lives'].forEach(prop => {
                    if (current[prop] !== previous[prop]) {
                        playerDelta[prop] = current[prop];
                        playerChanged = true;
                    }
                });
                
                if (playerChanged) {
                    playerDeltas[playerId] = { type: 'update', data: playerDelta };
                    hasChanges = true;
                }
            }
        });
        
        // Check for removed players
        Object.keys(previousState.players).forEach(playerId => {
            if (!currentState.players[playerId]) {
                playerDeltas[playerId] = { type: 'removed' };
                hasChanges = true;
            }
        });
        
        if (Object.keys(playerDeltas).length > 0) {
            delta.players = playerDeltas;
        }
    }
    
    // Compare bombs
    if (currentState.bombs && previousState.bombs) {
        const bombDeltas = {};
        
        currentState.bombs.forEach((bomb, bombId) => {
            const previous = previousState.bombs.get ? previousState.bombs.get(bombId) : null;
            
            if (!previous) {
                bombDeltas[bombId] = { type: 'new', data: bomb };
                hasChanges = true;
            } else if (bomb.timer !== previous.timer) {
                bombDeltas[bombId] = { type: 'update', data: { timer: bomb.timer } };
                hasChanges = true;
            }
        });
        
        if (Object.keys(bombDeltas).length > 0) {
            delta.bombs = bombDeltas;
        }
    }
    
    // Compare explosions
    if (currentState.explosions && previousState.explosions) {
        const explosionDeltas = {};
        
        currentState.explosions.forEach((explosion, explosionId) => {
            const previous = previousState.explosions.get ? previousState.explosions.get(explosionId) : null;
            
            if (!previous) {
                explosionDeltas[explosionId] = { type: 'new', data: explosion };
                hasChanges = true;
            }
        });
        
        if (Object.keys(explosionDeltas).length > 0) {
            delta.explosions = explosionDeltas;
        }
    }
    
    if (hasChanges) {
        return { type: 'delta', data: delta, timestamp: Date.now() };
    }
    
    return null; // No changes
}

/**
 * Prioritize messages based on type and content
 */
function prioritizeMessage(message) {
    switch (message.type) {
        case 'move':
        case 'placeBomb':
        case 'playerAction':
            return MESSAGE_PRIORITIES.CRITICAL;
            
        case 'gameState':
        case 'playerUpdate':
        case 'bombUpdate':
        case 'explosionUpdate':
            return MESSAGE_PRIORITIES.HIGH;
            
        case 'chatMessage':
        case 'playerJoined':
        case 'playerLeft':
            return MESSAGE_PRIORITIES.MEDIUM;
            
        default:
            return MESSAGE_PRIORITIES.LOW;
    }
}

/**
 * Batch messages for efficient processing
 */
function batchMessages(messages) {
    const batches = {
        [MESSAGE_PRIORITIES.CRITICAL]: [],
        [MESSAGE_PRIORITIES.HIGH]: [],
        [MESSAGE_PRIORITIES.MEDIUM]: [],
        [MESSAGE_PRIORITIES.LOW]: []
    };
    
    messages.forEach(message => {
        const priority = prioritizeMessage(message);
        batches[priority].push(message);
    });
    
    return batches;
}

/**
 * Process incoming messages
 */
function processIncomingMessages(messages) {
    const processedMessages = [];
    const batches = batchMessages(messages);
    
    // Process in priority order
    [MESSAGE_PRIORITIES.CRITICAL, MESSAGE_PRIORITIES.HIGH, MESSAGE_PRIORITIES.MEDIUM, MESSAGE_PRIORITIES.LOW]
        .forEach(priority => {
            if (batches[priority].length > 0) {
                processedMessages.push(...batches[priority]);
            }
        });
    
    return processedMessages;
}

/**
 * Process outgoing messages with compression
 */
function processOutgoingMessages() {
    if (outgoingQueue.length === 0) return [];
    
    const messages = outgoingQueue.splice(0, batchSize);
    const processedMessages = [];
    
    messages.forEach(message => {
        if (message.type === 'gameState' && lastGameState) {
            const compressed = compressGameState(message.data, lastGameState);
            
            if (compressed) {
                processedMessages.push({
                    ...message,
                    data: compressed.data,
                    compressionType: compressed.type,
                    timestamp: compressed.timestamp || Date.now()
                });
                
                // Update compression ratio
                const originalSize = JSON.stringify(message.data).length;
                const compressedSize = JSON.stringify(compressed.data).length;
                compressionRatio = compressedSize / originalSize;
            }
            
            lastGameState = message.data;
        } else {
            processedMessages.push({
                ...message,
                timestamp: Date.now()
            });
        }
    });
    
    return processedMessages;
}

/**
 * Message handler
 */
self.onmessage = function(e) {
    const { type, data } = e.data;
    
    try {
        switch (type) {
            case 'PROCESS_INCOMING':
                const processedIncoming = processIncomingMessages(data.messages);
                
                self.postMessage({
                    type: 'INCOMING_PROCESSED',
                    data: {
                        messages: processedIncoming,
                        processingTime: performance.now() - data.timestamp
                    }
                });
                break;
                
            case 'QUEUE_OUTGOING':
                outgoingQueue.push(...data.messages);
                
                // Process immediately if queue is getting full
                if (outgoingQueue.length >= batchSize) {
                    const processed = processOutgoingMessages();
                    
                    if (processed.length > 0) {
                        self.postMessage({
                            type: 'OUTGOING_READY',
                            data: {
                                messages: processed,
                                compressionRatio: compressionRatio
                            }
                        });
                    }
                }
                break;
                
            case 'FLUSH_OUTGOING':
                const flushed = processOutgoingMessages();
                
                if (flushed.length > 0) {
                    self.postMessage({
                        type: 'OUTGOING_READY',
                        data: {
                            messages: flushed,
                            compressionRatio: compressionRatio
                        }
                    });
                }
                break;
                
            case 'SET_COMPRESSION':
                compressionEnabled = data.enabled;
                self.postMessage({
                    type: 'COMPRESSION_SET',
                    data: { enabled: compressionEnabled }
                });
                break;
                
            case 'SET_BATCH_SIZE':
                batchSize = Math.max(1, Math.min(50, data.size));
                self.postMessage({
                    type: 'BATCH_SIZE_SET',
                    data: { size: batchSize }
                });
                break;
                
            case 'GET_STATS':
                self.postMessage({
                    type: 'NETWORK_STATS',
                    data: {
                        incomingQueueSize: messageQueue.length,
                        outgoingQueueSize: outgoingQueue.length,
                        compressionRatio: compressionRatio,
                        compressionEnabled: compressionEnabled,
                        batchSize: batchSize
                    }
                });
                break;
                
            case 'CLEANUP':
                messageQueue.length = 0;
                outgoingQueue.length = 0;
                lastGameState = null;
                deltaCompressionCache.clear();
                compressionRatio = 0;
                
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

// Periodic batch processing
setInterval(() => {
    if (outgoingQueue.length > 0) {
        const processed = processOutgoingMessages();
        
        if (processed.length > 0) {
            self.postMessage({
                type: 'OUTGOING_READY',
                data: {
                    messages: processed,
                    compressionRatio: compressionRatio
                }
            });
        }
    }
}, batchTimeout);

// Handle worker errors
self.onerror = function(error) {
    self.postMessage({
        type: 'ERROR',
        error: error.message,
        filename: error.filename,
        lineno: error.lineno
    });
};

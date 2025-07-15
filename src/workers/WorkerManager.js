/**
 * WorkerManager - Coordinates all Web Workers for maximum performance
 * Manages CollisionWorker, PhysicsWorker, and NetworkWorker
 * Implements proper error handling and worker lifecycle management
 */

import { Logger } from '../utils/Logger.js';

export class WorkerManager {
    constructor() {
        this.logger = new Logger('WorkerManager');
        
        // Worker instances
        this.workers = {
            collision: null,
            physics: null,
            network: null
        };
        
        // Worker states
        this.workerStates = {
            collision: 'stopped',
            physics: 'stopped',
            network: 'stopped'
        };
        
        // Message queues for when workers are not ready
        this.messageQueues = {
            collision: [],
            physics: [],
            network: []
        };
        
        // Event listeners
        this.eventListeners = new Map();
        
        // Performance tracking
        this.performanceStats = {
            collision: { messagesProcessed: 0, averageTime: 0, errors: 0 },
            physics: { messagesProcessed: 0, averageTime: 0, errors: 0 },
            network: { messagesProcessed: 0, averageTime: 0, errors: 0 }
        };
        
        // Worker cleanup functions
        this.cleanupFunctions = [];
        
        this.logger.info('WorkerManager initialized');
    }
    
    /**
     * Initialize all workers
     */
    async initializeWorkers() {
        try {
            this.logger.info('Initializing Web Workers...');
            
            // Initialize CollisionWorker
            await this.initializeCollisionWorker();
            
            // Initialize PhysicsWorker
            await this.initializePhysicsWorker();
            
            // Initialize NetworkWorker
            await this.initializeNetworkWorker();
            
            this.logger.info('All Web Workers initialized successfully');
            return true;
            
        } catch (error) {
            this.logger.error('Failed to initialize workers:', error);
            return false;
        }
    }
    
    /**
     * Initialize CollisionWorker
     */
    async initializeCollisionWorker() {
        return new Promise((resolve, reject) => {
            try {
                this.workers.collision = new Worker('/src/workers/CollisionWorker.js');
                this.workerStates.collision = 'initializing';
                
                this.workers.collision.onmessage = (e) => {
                    this.handleCollisionWorkerMessage(e.data);
                };
                
                this.workers.collision.onerror = (error) => {
                    this.handleWorkerError('collision', error);
                    reject(error);
                };
                
                // Wait for initialization
                const initTimeout = setTimeout(() => {
                    reject(new Error('CollisionWorker initialization timeout'));
                }, 5000);
                
                this.addEventListener('collision', 'GRID_INITIALIZED', () => {
                    clearTimeout(initTimeout);
                    this.workerStates.collision = 'ready';
                    this.logger.info('CollisionWorker initialized');
                    resolve();
                });
                
                // Initialize spatial grid
                this.workers.collision.postMessage({
                    type: 'INIT_GRID',
                    data: { width: 800, height: 600 } // Game area size
                });
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Initialize PhysicsWorker
     */
    async initializePhysicsWorker() {
        return new Promise((resolve, reject) => {
            try {
                this.workers.physics = new Worker('/src/workers/PhysicsWorker.js');
                this.workerStates.physics = 'ready';
                
                this.workers.physics.onmessage = (e) => {
                    this.handlePhysicsWorkerMessage(e.data);
                };
                
                this.workers.physics.onerror = (error) => {
                    this.handleWorkerError('physics', error);
                    reject(error);
                };
                
                this.logger.info('PhysicsWorker initialized');
                resolve();
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Initialize NetworkWorker
     */
    async initializeNetworkWorker() {
        return new Promise((resolve, reject) => {
            try {
                this.workers.network = new Worker('/src/workers/NetworkWorker.js');
                this.workerStates.network = 'ready';
                
                this.workers.network.onmessage = (e) => {
                    this.handleNetworkWorkerMessage(e.data);
                };
                
                this.workers.network.onerror = (error) => {
                    this.handleWorkerError('network', error);
                    reject(error);
                };
                
                this.logger.info('NetworkWorker initialized');
                resolve();
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Handle CollisionWorker messages
     */
    handleCollisionWorkerMessage(data) {
        const startTime = performance.now();
        
        try {
            this.emit('collision', data.type, data);
            
            // Update performance stats
            const processingTime = performance.now() - startTime;
            this.updatePerformanceStats('collision', processingTime);
            
        } catch (error) {
            this.logger.error('Error handling collision worker message:', error);
            this.performanceStats.collision.errors++;
        }
    }
    
    /**
     * Handle PhysicsWorker messages
     */
    handlePhysicsWorkerMessage(data) {
        const startTime = performance.now();
        
        try {
            this.emit('physics', data.type, data);
            
            // Update performance stats
            const processingTime = performance.now() - startTime;
            this.updatePerformanceStats('physics', processingTime);
            
        } catch (error) {
            this.logger.error('Error handling physics worker message:', error);
            this.performanceStats.physics.errors++;
        }
    }
    
    /**
     * Handle NetworkWorker messages
     */
    handleNetworkWorkerMessage(data) {
        const startTime = performance.now();
        
        try {
            this.emit('network', data.type, data);
            
            // Update performance stats
            const processingTime = performance.now() - startTime;
            this.updatePerformanceStats('network', processingTime);
            
        } catch (error) {
            this.logger.error('Error handling network worker message:', error);
            this.performanceStats.network.errors++;
        }
    }
    
    /**
     * Handle worker errors
     */
    handleWorkerError(workerType, error) {
        this.logger.error(`${workerType} worker error:`, error);
        this.workerStates[workerType] = 'error';
        this.performanceStats[workerType].errors++;
        
        // Emit error event
        this.emit(workerType, 'ERROR', { error: error.message });
        
        // Attempt to restart worker
        this.restartWorker(workerType);
    }
    
    /**
     * Restart a worker
     */
    async restartWorker(workerType) {
        this.logger.warn(`Restarting ${workerType} worker...`);
        
        try {
            // Terminate existing worker
            if (this.workers[workerType]) {
                this.workers[workerType].terminate();
                this.workers[workerType] = null;
            }
            
            // Reinitialize worker
            switch (workerType) {
                case 'collision':
                    await this.initializeCollisionWorker();
                    break;
                case 'physics':
                    await this.initializePhysicsWorker();
                    break;
                case 'network':
                    await this.initializeNetworkWorker();
                    break;
            }
            
            this.logger.info(`${workerType} worker restarted successfully`);
            
        } catch (error) {
            this.logger.error(`Failed to restart ${workerType} worker:`, error);
        }
    }
    
    /**
     * Send message to worker
     */
    sendToWorker(workerType, message) {
        const worker = this.workers[workerType];
        const state = this.workerStates[workerType];
        
        if (!worker || state !== 'ready') {
            // Queue message for later
            this.messageQueues[workerType].push(message);
            this.logger.debug(`Queued message for ${workerType} worker (state: ${state})`);
            return false;
        }
        
        try {
            worker.postMessage(message);
            return true;
        } catch (error) {
            this.logger.error(`Failed to send message to ${workerType} worker:`, error);
            return false;
        }
    }
    
    /**
     * Process queued messages
     */
    processQueuedMessages(workerType) {
        const queue = this.messageQueues[workerType];
        
        while (queue.length > 0 && this.workerStates[workerType] === 'ready') {
            const message = queue.shift();
            this.sendToWorker(workerType, message);
        }
    }
    
    /**
     * Add event listener
     */
    addEventListener(workerType, eventType, callback) {
        const key = `${workerType}:${eventType}`;
        
        if (!this.eventListeners.has(key)) {
            this.eventListeners.set(key, []);
        }
        
        this.eventListeners.get(key).push(callback);
        
        // Add to cleanup functions
        this.cleanupFunctions.push(() => {
            const listeners = this.eventListeners.get(key);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        });
    }
    
    /**
     * Emit event to listeners
     */
    emit(workerType, eventType, data) {
        const key = `${workerType}:${eventType}`;
        const listeners = this.eventListeners.get(key);
        
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    this.logger.error('Event listener error:', error);
                }
            });
        }
    }
    
    /**
     * Update performance statistics
     */
    updatePerformanceStats(workerType, processingTime) {
        const stats = this.performanceStats[workerType];
        stats.messagesProcessed++;
        stats.averageTime = (stats.averageTime * 0.9) + (processingTime * 0.1);
    }
    
    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        return {
            ...this.performanceStats,
            workerStates: { ...this.workerStates }
        };
    }
    
    /**
     * Cleanup all workers and resources
     */
    cleanup() {
        this.logger.info('Cleaning up WorkerManager...');
        
        // Terminate all workers
        Object.entries(this.workers).forEach(([type, worker]) => {
            if (worker) {
                worker.terminate();
                this.workers[type] = null;
                this.workerStates[type] = 'stopped';
            }
        });
        
        // Clear message queues
        Object.keys(this.messageQueues).forEach(type => {
            this.messageQueues[type].length = 0;
        });
        
        // Run cleanup functions
        this.cleanupFunctions.forEach(cleanup => cleanup());
        this.cleanupFunctions.length = 0;
        
        // Clear event listeners
        this.eventListeners.clear();
        
        this.logger.info('WorkerManager cleaned up');
    }
}

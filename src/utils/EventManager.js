/**
 * EventManager - Comprehensive event system with proper cleanup patterns
 * Ensures all event listeners are properly registered and removed
 * Implements performance events for system coordination and zero memory leaks
 */

import { Logger } from './Logger.js';

export class EventManager {
    constructor() {
        this.logger = new Logger('EventManager');
        
        // Event listener tracking
        this.listeners = new Map(); // eventType -> Set of listeners
        this.cleanupFunctions = new Map(); // listenerId -> cleanup function
        this.listenerCounter = 0;
        
        // Performance event tracking
        this.performanceEvents = new Set([
            'frameBudgetExceeded',
            'emergencyOptimization', 
            'qualityLevelChanged',
            'predictedMovement',
            'serverMovementConfirmation',
            'collisionResultsReady',
            'workerReady',
            'workerError',
            'workerPerformanceUpdate'
        ]);
        
        // Event statistics
        this.stats = {
            totalListeners: 0,
            activeListeners: 0,
            eventsEmitted: 0,
            cleanupOperations: 0
        };
        
        this.logger.info('EventManager initialized');
    }
    
    /**
     * Register event listener with automatic cleanup tracking
     */
    addEventListener(target, eventType, handler, options = {}) {
        const listenerId = ++this.listenerCounter;
        
        try {
            // Add event listener
            target.addEventListener(eventType, handler, options);
            
            // Track listener for cleanup
            if (!this.listeners.has(eventType)) {
                this.listeners.set(eventType, new Set());
            }
            
            const listenerInfo = {
                id: listenerId,
                target: target,
                handler: handler,
                options: options,
                timestamp: Date.now()
            };
            
            this.listeners.get(eventType).add(listenerInfo);
            
            // Store cleanup function
            this.cleanupFunctions.set(listenerId, () => {
                target.removeEventListener(eventType, handler, options);
                this.listeners.get(eventType)?.delete(listenerInfo);
            });
            
            this.stats.totalListeners++;
            this.stats.activeListeners++;
            
            this.logger.debug(`Event listener registered: ${eventType} (ID: ${listenerId})`);
            
            return listenerId;
            
        } catch (error) {
            this.logger.error(`Failed to register event listener for ${eventType}:`, error);
            return null;
        }
    }
    
    /**
     * Remove specific event listener
     */
    removeEventListener(listenerId) {
        const cleanup = this.cleanupFunctions.get(listenerId);
        
        if (cleanup) {
            try {
                cleanup();
                this.cleanupFunctions.delete(listenerId);
                this.stats.activeListeners--;
                this.stats.cleanupOperations++;
                
                this.logger.debug(`Event listener removed (ID: ${listenerId})`);
                return true;
                
            } catch (error) {
                this.logger.error(`Failed to remove event listener (ID: ${listenerId}):`, error);
                return false;
            }
        }
        
        return false;
    }
    
    /**
     * Emit event with performance tracking
     */
    emit(eventType, detail = {}) {
        try {
            if (typeof window !== 'undefined' && window.dispatchEvent) {
                const event = new CustomEvent(eventType, { detail });
                window.dispatchEvent(event);
                
                this.stats.eventsEmitted++;
                
                // Log performance events
                if (this.performanceEvents.has(eventType)) {
                    this.logger.debug(`Performance event emitted: ${eventType}`, detail);
                }
                
                return true;
            }
            
            return false;
            
        } catch (error) {
            this.logger.error(`Failed to emit event ${eventType}:`, error);
            return false;
        }
    }
    
    /**
     * Remove all listeners for specific event type
     */
    removeAllListeners(eventType) {
        const listeners = this.listeners.get(eventType);
        
        if (listeners) {
            let removedCount = 0;
            
            listeners.forEach(listenerInfo => {
                if (this.removeEventListener(listenerInfo.id)) {
                    removedCount++;
                }
            });
            
            this.listeners.delete(eventType);
            this.logger.info(`Removed ${removedCount} listeners for event: ${eventType}`);
            
            return removedCount;
        }
        
        return 0;
    }
    
    /**
     * Clean up all event listeners
     */
    cleanup() {
        this.logger.info('Cleaning up all event listeners...');
        
        let cleanedCount = 0;
        
        // Execute all cleanup functions
        this.cleanupFunctions.forEach((cleanup, listenerId) => {
            try {
                cleanup();
                cleanedCount++;
            } catch (error) {
                this.logger.error(`Error during cleanup of listener ${listenerId}:`, error);
            }
        });
        
        // Clear all tracking
        this.listeners.clear();
        this.cleanupFunctions.clear();
        
        this.stats.activeListeners = 0;
        this.stats.cleanupOperations += cleanedCount;
        
        this.logger.info(`EventManager cleanup complete: ${cleanedCount} listeners removed`);
    }
    
    /**
     * Get event system statistics
     */
    getStats() {
        return {
            ...this.stats,
            activeListenersByType: this.getActiveListenersByType(),
            memoryUsage: this.estimateMemoryUsage()
        };
    }
    
    /**
     * Get active listeners grouped by event type
     */
    getActiveListenersByType() {
        const byType = {};
        
        this.listeners.forEach((listeners, eventType) => {
            byType[eventType] = listeners.size;
        });
        
        return byType;
    }
    
    /**
     * Estimate memory usage of event system
     */
    estimateMemoryUsage() {
        const listenerCount = this.stats.activeListeners;
        const cleanupFunctionCount = this.cleanupFunctions.size;
        
        // Rough estimation: each listener ~100 bytes, each cleanup function ~50 bytes
        const estimatedBytes = (listenerCount * 100) + (cleanupFunctionCount * 50);
        
        return {
            estimatedBytes: estimatedBytes,
            estimatedKB: (estimatedBytes / 1024).toFixed(2),
            activeListeners: listenerCount,
            cleanupFunctions: cleanupFunctionCount
        };
    }
    
    /**
     * Log current event system status
     */
    logStatus() {
        const stats = this.getStats();
        
        this.logger.info('Event System Status:', {
            activeListeners: stats.activeListeners,
            totalRegistered: stats.totalListeners,
            eventsEmitted: stats.eventsEmitted,
            cleanupOperations: stats.cleanupOperations,
            memoryUsage: stats.memoryUsage.estimatedKB + ' KB',
            listenersByType: stats.activeListenersByType
        });
    }
}

/**
 * Mixin for classes that need event cleanup patterns
 */
export class EventCleanupMixin {
    constructor() {
        this.eventCleanupFunctions = [];
        this.eventManager = null;
    }
    
    /**
     * Set event manager for this instance
     */
    setEventManager(eventManager) {
        this.eventManager = eventManager;
    }
    
    /**
     * Register event with automatic cleanup tracking
     */
    registerEvent(target, eventType, handler, options = {}) {
        if (this.eventManager) {
            const listenerId = this.eventManager.addEventListener(target, eventType, handler, options);
            
            if (listenerId) {
                this.eventCleanupFunctions.push(() => {
                    this.eventManager.removeEventListener(listenerId);
                });
            }
            
            return listenerId;
        } else {
            // Fallback to manual tracking
            target.addEventListener(eventType, handler, options);
            this.eventCleanupFunctions.push(() => {
                target.removeEventListener(eventType, handler, options);
            });
            
            return null;
        }
    }
    
    /**
     * Clean up all registered events
     */
    cleanupEvents() {
        this.eventCleanupFunctions.forEach(cleanup => {
            try {
                cleanup();
            } catch (error) {
                console.error('Error during event cleanup:', error);
            }
        });
        
        this.eventCleanupFunctions = [];
    }
}

// Export singleton instance
export const eventManager = new EventManager();

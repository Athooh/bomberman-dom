/**
 * ObjectPool - Comprehensive object pooling system for zero GC pressure
 * Manages pools for collision results, position vectors, AABB boxes, and raycast results
 * Implements automatic pool sizing and memory management for stable 60+ FPS
 */

import { Logger } from './Logger.js';

/**
 * Generic object pool for any type of object
 */
class GenericPool {
    constructor(createFn, resetFn, initialSize = 10, maxSize = 100) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.maxSize = maxSize;
        this.pool = [];
        this.activeCount = 0;
        this.totalCreated = 0;
        
        // Pre-populate pool
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.createFn());
            this.totalCreated++;
        }
    }
    
    /**
     * Get object from pool or create new one
     */
    get() {
        let obj;
        
        if (this.pool.length > 0) {
            obj = this.pool.pop();
        } else {
            obj = this.createFn();
            this.totalCreated++;
        }
        
        this.activeCount++;
        return obj;
    }
    
    /**
     * Return object to pool
     */
    release(obj) {
        if (!obj) return;
        
        // Reset object state
        if (this.resetFn) {
            this.resetFn(obj);
        }
        
        // Add back to pool if not at max capacity
        if (this.pool.length < this.maxSize) {
            this.pool.push(obj);
        }
        
        this.activeCount = Math.max(0, this.activeCount - 1);
    }
    
    /**
     * Get pool statistics
     */
    getStats() {
        return {
            poolSize: this.pool.length,
            activeCount: this.activeCount,
            totalCreated: this.totalCreated,
            maxSize: this.maxSize
        };
    }
    
    /**
     * Clear pool
     */
    clear() {
        this.pool.length = 0;
        this.activeCount = 0;
    }
}

/**
 * Comprehensive object pooling system
 */
export class ObjectPool {
    constructor() {
        this.logger = new Logger('ObjectPool');
        
        // Initialize all required pools
        this.pools = {
            // Collision system pools
            collisionResult: new GenericPool(
                () => ({ 
                    hasCollision: false, 
                    entityA: null, 
                    entityB: null, 
                    type: '', 
                    x: 0, 
                    y: 0,
                    timestamp: 0
                }),
                (obj) => {
                    obj.hasCollision = false;
                    obj.entityA = null;
                    obj.entityB = null;
                    obj.type = '';
                    obj.x = 0;
                    obj.y = 0;
                    obj.timestamp = 0;
                },
                100, 200
            ),
            
            // Position vector pool
            positionVector: new GenericPool(
                () => ({ x: 0, y: 0, z: 0 }),
                (obj) => {
                    obj.x = 0;
                    obj.y = 0;
                    obj.z = 0;
                },
                50, 100
            ),
            
            // AABB (Axis-Aligned Bounding Box) pool
            aabbBox: new GenericPool(
                () => ({ 
                    minX: 0, 
                    minY: 0, 
                    maxX: 0, 
                    maxY: 0,
                    width: 0,
                    height: 0
                }),
                (obj) => {
                    obj.minX = 0;
                    obj.minY = 0;
                    obj.maxX = 0;
                    obj.maxY = 0;
                    obj.width = 0;
                    obj.height = 0;
                },
                200, 400
            ),
            
            // Raycast result pool
            raycastResult: new GenericPool(
                () => ({ 
                    hit: false, 
                    distance: 0, 
                    x: 0, 
                    y: 0, 
                    normal: { x: 0, y: 0 },
                    entity: null
                }),
                (obj) => {
                    obj.hit = false;
                    obj.distance = 0;
                    obj.x = 0;
                    obj.y = 0;
                    obj.normal.x = 0;
                    obj.normal.y = 0;
                    obj.entity = null;
                },
                100, 200
            ),
            
            // Movement delta pool
            movementDelta: new GenericPool(
                () => ({ 
                    deltaX: 0, 
                    deltaY: 0, 
                    direction: '', 
                    speed: 0,
                    timestamp: 0
                }),
                (obj) => {
                    obj.deltaX = 0;
                    obj.deltaY = 0;
                    obj.direction = '';
                    obj.speed = 0;
                    obj.timestamp = 0;
                },
                30, 60
            ),
            
            // Explosion tile pool
            explosionTile: new GenericPool(
                () => ({ 
                    x: 0, 
                    y: 0, 
                    type: '', 
                    direction: '',
                    destroysBlock: false,
                    timestamp: 0
                }),
                (obj) => {
                    obj.x = 0;
                    obj.y = 0;
                    obj.type = '';
                    obj.direction = '';
                    obj.destroysBlock = false;
                    obj.timestamp = 0;
                },
                50, 100
            ),
            
            // Network message pool
            networkMessage: new GenericPool(
                () => ({ 
                    type: '', 
                    data: null, 
                    timestamp: 0,
                    priority: 0,
                    sequenceNumber: 0
                }),
                (obj) => {
                    obj.type = '';
                    obj.data = null;
                    obj.timestamp = 0;
                    obj.priority = 0;
                    obj.sequenceNumber = 0;
                },
                20, 50
            )
        };
        
        this.logger.info('ObjectPool initialized with comprehensive pools');
    }
    
    /**
     * Get object from specific pool
     */
    get(poolName) {
        const pool = this.pools[poolName];
        if (!pool) {
            this.logger.error(`Pool '${poolName}' not found`);
            return null;
        }
        
        return pool.get();
    }
    
    /**
     * Return object to specific pool
     */
    release(poolName, obj) {
        const pool = this.pools[poolName];
        if (!pool) {
            this.logger.error(`Pool '${poolName}' not found`);
            return;
        }
        
        pool.release(obj);
    }
    
    /**
     * Get collision result from pool
     */
    getCollisionResult() {
        return this.get('collisionResult');
    }
    
    /**
     * Release collision result to pool
     */
    releaseCollisionResult(result) {
        this.release('collisionResult', result);
    }
    
    /**
     * Get position vector from pool
     */
    getPositionVector() {
        return this.get('positionVector');
    }
    
    /**
     * Release position vector to pool
     */
    releasePositionVector(vector) {
        this.release('positionVector', vector);
    }
    
    /**
     * Get AABB box from pool
     */
    getAABBBox() {
        return this.get('aabbBox');
    }
    
    /**
     * Release AABB box to pool
     */
    releaseAABBBox(box) {
        this.release('aabbBox', box);
    }
    
    /**
     * Get raycast result from pool
     */
    getRaycastResult() {
        return this.get('raycastResult');
    }
    
    /**
     * Release raycast result to pool
     */
    releaseRaycastResult(result) {
        this.release('raycastResult', result);
    }
    
    /**
     * Get movement delta from pool
     */
    getMovementDelta() {
        return this.get('movementDelta');
    }
    
    /**
     * Release movement delta to pool
     */
    releaseMovementDelta(delta) {
        this.release('movementDelta', delta);
    }
    
    /**
     * Get explosion tile from pool
     */
    getExplosionTile() {
        return this.get('explosionTile');
    }
    
    /**
     * Release explosion tile to pool
     */
    releaseExplosionTile(tile) {
        this.release('explosionTile', tile);
    }
    
    /**
     * Get network message from pool
     */
    getNetworkMessage() {
        return this.get('networkMessage');
    }
    
    /**
     * Release network message to pool
     */
    releaseNetworkMessage(message) {
        this.release('networkMessage', message);
    }
    
    /**
     * Get comprehensive pool statistics
     */
    getStats() {
        const stats = {};
        
        Object.entries(this.pools).forEach(([name, pool]) => {
            stats[name] = pool.getStats();
        });
        
        return stats;
    }
    
    /**
     * Clear all pools
     */
    clearAll() {
        Object.values(this.pools).forEach(pool => pool.clear());
        this.logger.info('All object pools cleared');
    }
    
    /**
     * Log pool statistics
     */
    logStats() {
        const stats = this.getStats();
        
        this.logger.info('Object Pool Statistics:');
        Object.entries(stats).forEach(([name, poolStats]) => {
            this.logger.info(`  ${name}: ${poolStats.activeCount}/${poolStats.poolSize} (created: ${poolStats.totalCreated})`);
        });
    }
}

// Export singleton instance
export const objectPool = new ObjectPool();

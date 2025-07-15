// src/entities/Bomb.js
// Bomb entity with timer, explosion logic, and special abilities

import { GAME_CONFIG } from '../utils/Constants.js';
import { Logger } from '../utils/Logger.js';

/**
 * Bomb Entity
 * Handles bomb timing, explosion creation, and special bomb abilities
 */
export class Bomb {
    constructor(id, data = {}) {
        this.logger = new Logger(`Bomb:${id}`);
        
        // Identity
        this.id = id;
        this.playerId = data.playerId;
        
        // Position
        this.x = data.x || 0;
        this.y = data.y || 0;
        this.tileX = Math.floor(this.x);
        this.tileY = Math.floor(this.y);
        
        // Timing
        this.timer = data.timer || GAME_CONFIG.BOMB_TIMER;
        this.createTime = Date.now();
        this.explodeTime = this.createTime + this.timer;
        
        // Properties
        this.range = data.range || 1;
        this.power = data.power || 1;
        
        // State
        this.isActive = true;
        this.hasExploded = false;
        this.isPaused = false;
        this.pauseTime = 0;
        
        // Special abilities
        this.abilities = {
            pierce: data.pierce || false,      // Pierce through blocks
            remote: data.remote || false,     // Remote detonation
            sticky: data.sticky || false,     // Stick to walls
            bouncy: data.bouncy || false,     // Bounce off walls
            cluster: data.cluster || false    // Create multiple smaller explosions
        };
        
        // Visual properties
        this.size = GAME_CONFIG.TILE_SIZE;
        this.pulseRate = 1.0; // Speed of pulsing animation
        this.glowIntensity = 0.5;
        
        // Physics (for bouncy bombs)
        this.velocity = { x: 0, y: 0 };
        this.friction = 0.9;
        
        this.logger.debug('Bomb created', {
            id: this.id,
            position: { x: this.x, y: this.y },
            timer: this.timer,
            range: this.range
        });
    }
    
    /**
     * Update bomb state
     */
    update(deltaTime) {
        if (!this.isActive || this.hasExploded) {
            return null;
        }
        
        // Handle pause state
        if (this.isPaused) {
            return null;
        }
        
        // Update physics for bouncy bombs
        if (this.abilities.bouncy) {
            this.updatePhysics(deltaTime);
        }
        
        // Update visual effects
        this.updateVisuals(deltaTime);
        
        // Check explosion timer
        const now = Date.now();
        if (now >= this.explodeTime) {
            return this.explode();
        }
        
        return null;
    }
    
    /**
     * Update physics for bouncy bombs
     */
    updatePhysics(deltaTime) {
        if (this.velocity.x === 0 && this.velocity.y === 0) {
            return;
        }
        
        // Update position
        this.x += this.velocity.x * deltaTime / 16.67; // Normalize for 60fps
        this.y += this.velocity.y * deltaTime / 16.67;
        
        // Apply friction
        this.velocity.x *= this.friction;
        this.velocity.y *= this.friction;
        
        // Stop very slow movement
        if (Math.abs(this.velocity.x) < 0.1) this.velocity.x = 0;
        if (Math.abs(this.velocity.y) < 0.1) this.velocity.y = 0;
        
        // Update tile position
        this.tileX = Math.floor(this.x / GAME_CONFIG.TILE_SIZE);
        this.tileY = Math.floor(this.y / GAME_CONFIG.TILE_SIZE);
        
        // Bounce off walls (simplified)
        if (this.tileX <= 0 || this.tileX >= GAME_CONFIG.MAP_WIDTH - 1) {
            this.velocity.x *= -0.8;
            this.x = Math.max(1, Math.min(GAME_CONFIG.MAP_WIDTH - 2, this.x));
        }
        
        if (this.tileY <= 0 || this.tileY >= GAME_CONFIG.MAP_HEIGHT - 1) {
            this.velocity.y *= -0.8;
            this.y = Math.max(1, Math.min(GAME_CONFIG.MAP_HEIGHT - 2, this.y));
        }
    }
    
    /**
     * Update visual effects
     */
    updateVisuals(deltaTime) {
        const timeRemaining = Math.max(0, this.explodeTime - Date.now());
        const timeElapsed = this.timer - timeRemaining;
        
        // Increase pulse rate as explosion approaches
        this.pulseRate = 1.0 + (timeElapsed / this.timer) * 3.0;
        
        // Increase glow intensity near explosion
        this.glowIntensity = 0.5 + (timeElapsed / this.timer) * 0.5;
        
        // Flash rapidly in final seconds
        if (timeRemaining < 1000) {
            this.pulseRate = 8.0;
            this.glowIntensity = 1.0;
        }
    }
    
    /**
     * Explode the bomb
     */
    explode() {
        if (this.hasExploded) {
            return null;
        }
        
        this.logger.debug('Bomb exploding', { id: this.id, position: { x: this.tileX, y: this.tileY } });
        
        this.hasExploded = true;
        this.isActive = false;
        
        // Create explosion based on bomb type
        if (this.abilities.cluster) {
            return this.createClusterExplosion();
        } else {
            return this.createStandardExplosion();
        }
    }
    
    /**
     * Create standard cross-shaped explosion
     */
    createStandardExplosion() {
        const explosion = {
            id: `explosion_${this.id}_${Date.now()}`,
            bombId: this.id,
            playerId: this.playerId,
            centerX: this.tileX,
            centerY: this.tileY,
            range: this.range,
            power: this.power,
            abilities: { ...this.abilities },
            tiles: [],
            createTime: Date.now(),
            duration: GAME_CONFIG.EXPLOSION_DURATION
        };
        
        // Calculate explosion tiles
        const directions = [
            { dx: 0, dy: 0 },   // Center
            { dx: 0, dy: -1 },  // Up
            { dx: 0, dy: 1 },   // Down
            { dx: -1, dy: 0 },  // Left
            { dx: 1, dy: 0 }    // Right
        ];
        
        directions.forEach(({ dx, dy }) => {
            const maxDistance = (dx === 0 && dy === 0) ? 1 : this.range;
            
            for (let i = 0; i < maxDistance; i++) {
                const tileX = this.tileX + (dx * i);
                const tileY = this.tileY + (dy * i);
                
                // Check bounds
                if (tileX < 0 || tileX >= GAME_CONFIG.MAP_WIDTH ||
                    tileY < 0 || tileY >= GAME_CONFIG.MAP_HEIGHT) {
                    break;
                }
                
                // Add explosion tile
                explosion.tiles.push({
                    x: tileX,
                    y: tileY,
                    distance: i,
                    direction: dx === 0 ? (dy === 0 ? 'center' : (dy > 0 ? 'down' : 'up')) :
                              (dx > 0 ? 'right' : 'left'),
                    intensity: Math.max(0.2, 1.0 - (i / this.range) * 0.6)
                });
                
                // Check if explosion should stop
                if (!this.abilities.pierce && this.shouldStopExplosion(tileX, tileY)) {
                    break;
                }
            }
        });
        
        return explosion;
    }
    

    /**
     * Reinitialize bomb from pool
     */
    reinitialize(id, data = {}) {
        // Reset identity
        this.id = id;
        this.playerId = data.playerId;
        
        // Reset position
        this.x = data.x || 0;
        this.y = data.y || 0;
        this.tileX = Math.floor(this.x);
        this.tileY = Math.floor(this.y);
        
        // Reset timing
        this.timer = data.timer || GAME_CONFIG.BOMB_TIMER;
        this.createTime = Date.now();
        this.explodeTime = this.createTime + this.timer;
        
        // Reset properties
        this.range = data.range || 1;
        this.power = data.power || 1;
        
        // Reset state
        this.isActive = true;
        this.hasExploded = false;
        this.isPaused = false;
        this.pauseTime = 0;
        
        // Reset abilities
        this.abilities = {
            pierce: data.pierce || false,
            remote: data.remote || false,
            sticky: data.sticky || false,
            bouncy: data.bouncy || false,
            cluster: data.cluster || false
        };
        
        // Reset physics
        this.velocity = { x: 0, y: 0 };
        this.size = GAME_CONFIG.BOMB_SIZE || 24;
        
        this.logger.debug(`Bomb ${this.id} reinitialized from pool`);
    }

    /**
     * Reset bomb for pool storage
     */
    resetForPool() {
        // Clear all references
        this.id = null;
        this.playerId = null;
        
        // Reset position
        this.x = 0;
        this.y = 0;
        this.tileX = 0;
        this.tileY = 0;
        
        // Reset timing
        this.createTime = 0;
        this.explodeTime = 0;
        this.pauseTime = 0;
        
        // Reset state
        this.isActive = false;
        this.hasExploded = false;
        this.isPaused = false;
        
        // Clear abilities object
        Object.keys(this.abilities).forEach(key => {
            this.abilities[key] = false;
        });
        
        // Reset velocity
        this.velocity.x = 0;
        this.velocity.y = 0;
        
        this.logger.debug('Bomb reset for pool storage');
    }

    /**
     * Create cluster explosion (multiple smaller explosions)
     */
    createClusterExplosion() {
        const explosions = [];
        
        // Main explosion
        const mainExplosion = this.createStandardExplosion();
        mainExplosion.id = `cluster_main_${this.id}`;
        explosions.push(mainExplosion);
        
        // Sub-explosions around the main explosion
        const subExplosionPositions = [
            { x: this.tileX - 1, y: this.tileY - 1 },
            { x: this.tileX + 1, y: this.tileY - 1 },
            { x: this.tileX - 1, y: this.tileY + 1 },
            { x: this.tileX + 1, y: this.tileY + 1 }
        ];
        
        subExplosionPositions.forEach((pos, index) => {
            if (pos.x >= 0 && pos.x < GAME_CONFIG.MAP_WIDTH &&
                pos.y >= 0 && pos.y < GAME_CONFIG.MAP_HEIGHT) {
                
                const subExplosion = {
                    id: `cluster_sub_${this.id}_${index}`,
                    bombId: this.id,
                    playerId: this.playerId,
                    centerX: pos.x,
                    centerY: pos.y,
                    range: Math.max(1, this.range - 1),
                    power: this.power * 0.7,
                    abilities: { ...this.abilities },
                    tiles: [{ x: pos.x, y: pos.y, distance: 0, direction: 'center', intensity: 0.7 }],
                    createTime: Date.now() + 100, // Slight delay
                    duration: GAME_CONFIG.EXPLOSION_DURATION
                };
                
                explosions.push(subExplosion);
            }
        });
        
        return explosions;
    }
    
    /**
     * Check if explosion should stop at this tile
     */
    shouldStopExplosion(x, y) {
        // This would normally check against walls/blocks
        // For now, return false to continue explosion
        // The actual collision checking is done by the collision system
        return false;
    }
    
    /**
     * Trigger remote detonation
     */
    remoteDetonate() {
        if (!this.abilities.remote || this.hasExploded) {
            return null;
        }
        
        this.logger.debug('Remote detonation triggered', { id: this.id });
        
        // Immediate explosion
        this.explodeTime = Date.now();
        return this.explode();
    }
    
    /**
     * Push bomb in direction (for bomb push ability)
     */
    push(direction, force = 1) {
        if (!this.abilities.bouncy && !this.canBePushed()) {
            return false;
        }
        
        const pushVelocity = force * 3;
        
        switch (direction) {
            case 'up':
                this.velocity.y -= pushVelocity;
                break;
            case 'down':
                this.velocity.y += pushVelocity;
                break;
            case 'left':
                this.velocity.x -= pushVelocity;
                break;
            case 'right':
                this.velocity.x += pushVelocity;
                break;
        }
        
        this.logger.debug('Bomb pushed', { id: this.id, direction, force });
        return true;
    }
    
    /**
     * Check if bomb can be pushed
     */
    canBePushed() {
        // Can be pushed if not stuck to wall and not too close to explosion
        return !this.abilities.sticky && this.getTimeRemaining() > 500;
    }
    
    /**
     * Pause bomb timer (for time stop ability)
     */
    pause() {
        if (!this.isPaused) {
            this.isPaused = true;
            this.pauseTime = Date.now();
            this.logger.debug('Bomb paused', { id: this.id });
        }
    }
    
    /**
     * Resume bomb timer
     */
    resume() {
        if (this.isPaused) {
            const pauseDuration = Date.now() - this.pauseTime;
            this.explodeTime += pauseDuration;
            this.isPaused = false;
            this.logger.debug('Bomb resumed', { id: this.id, pauseDuration });
        }
    }
    
    /**
     * Get time remaining until explosion
     */
    getTimeRemaining() {
        if (this.hasExploded) return 0;
        return Math.max(0, this.explodeTime - Date.now());
    }
    
    /**
     * Get explosion progress (0 to 1)
     */
    getExplosionProgress() {
        const elapsed = Date.now() - this.createTime;
        return Math.min(1, elapsed / this.timer);
    }
    
    /**
     * Check if bomb should explode
     */
    shouldExplode() {
        return !this.hasExploded && Date.now() >= this.explodeTime;
    }
    
    /**
     * Get bomb's current animation frame
     */
    getAnimationFrame() {
        const progress = this.getExplosionProgress();
        const pulsePhase = (Date.now() * this.pulseRate / 1000) % (Math.PI * 2);
        
        return {
            scale: 1.0 + Math.sin(pulsePhase) * 0.1,
            glow: this.glowIntensity * (0.5 + Math.sin(pulsePhase) * 0.5),
            rotation: progress * 360,
            opacity: 1.0
        };
    }
    
    /**
     * Get visual properties for rendering
     */
    getVisualProperties() {
        const animation = this.getAnimationFrame();
        const timeRemaining = this.getTimeRemaining();
        
        return {
            x: this.x,
            y: this.y,
            tileX: this.tileX,
            tileY: this.tileY,
            size: this.size,
            scale: animation.scale,
            glow: animation.glow,
            rotation: animation.rotation,
            opacity: animation.opacity,
            color: this.getBombColor(),
            pulseRate: this.pulseRate,
            timeRemaining: timeRemaining,
            isUrgent: timeRemaining < 1000
        };
    }
    
    /**
     * Get bomb color based on abilities and state
     */
    getBombColor() {
        if (this.abilities.cluster) return '#FF6B35'; // Orange
        if (this.abilities.remote) return '#4ECDC4'; // Cyan
        if (this.abilities.pierce) return '#9B59B6'; // Purple
        if (this.abilities.bouncy) return '#F39C12'; // Yellow
        if (this.abilities.sticky) return '#E74C3C'; // Red
        
        return '#2C3E50'; // Default dark blue
    }
    
    /**
     * Serialize bomb data for network transmission
     */
    serialize() {
        return {
            id: this.id,
            playerId: this.playerId,
            x: this.x,
            y: this.y,
            tileX: this.tileX,
            tileY: this.tileY,
            timer: this.timer,
            range: this.range,
            power: this.power,
            createTime: this.createTime,
            explodeTime: this.explodeTime,
            isActive: this.isActive,
            hasExploded: this.hasExploded,
            abilities: { ...this.abilities },
            velocity: { ...this.velocity }
        };
    }
    
    /**
     * Update from network data
     */
    updateFromNetwork(data) {
        this.x = data.x;
        this.y = data.y;
        this.tileX = data.tileX;
        this.tileY = data.tileY;
        this.explodeTime = data.explodeTime;
        this.isActive = data.isActive;
        this.hasExploded = data.hasExploded;
        
        if (data.velocity) {
            this.velocity = { ...data.velocity };
        }
        
        this.logger.verbose('Updated from network data');
    }
    
    /**
     * Create bomb from network data
     */
    static fromNetworkData(data) {
        const bomb = new Bomb(data.id, data);
        bomb.updateFromNetwork(data);
        return bomb;
    }
    
    /**
     * Get collision bounds
     */
    getBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this.size,
            height: this.size,
            centerX: this.x + this.size / 2,
            centerY: this.y + this.size / 2,
            radius: this.size / 2
        };
    }
    
    /**
     * Check if point is within bomb
     */
    containsPoint(x, y) {
        const bounds = this.getBounds();
        return x >= bounds.x && x <= bounds.x + bounds.width &&
               y >= bounds.y && y <= bounds.y + bounds.height;
    }
    
    /**
     * Get distance to point
     */
    getDistanceTo(x, y) {
        const bounds = this.getBounds();
        const dx = bounds.centerX - x;
        const dy = bounds.centerY - y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    /**
     * Cleanup bomb resources
     */
    cleanup() {
        // Clear any pending timers
        if (this._explosionTimer) {
            clearTimeout(this._explosionTimer);
            this._explosionTimer = null;
        }
        
        // Reset state
        this.isActive = false;
        this.hasExploded = true;
        
        // Clear references for GC
        this.playerId = null;
        this.abilities = null;
        this.velocity = null;
        
        this.logger.debug('Bomb cleaned up completely', { id: this.id });
    }
}

export default Bomb;
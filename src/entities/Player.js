// src/entities/Player.js
// Player entity class with all player-related logic

import { GAME_CONFIG, PLAYER_CONFIG } from '../utils/Constants.js';
import { Logger } from '../utils/Logger.js';

/**
 * Player entity class
 * Handles player state, movement, abilities, and power-ups
 */
export class Player {
    constructor(id, data = {}) {
        this.logger = new Logger(`Player:${id}`);
        
        // Identity
        this.id = id;
        this.nickname = data.nickname || `Player${id}`;
        this.isLocal = false;
        this.index = data.index || 0;
        
        // Position
        this.x = data.x || 0;
        this.y = data.y || 0;
        this.tileX = Math.floor(this.x / GAME_CONFIG.TILE_SIZE);
        this.tileY = Math.floor(this.y / GAME_CONFIG.TILE_SIZE);
        
        //  Enhanced position tracking for smooth interpolation
        this.prevX = this.x;
        this.prevY = this.y;
        this.targetX = this.x;
        this.targetY = this.y;

        //  Client-side prediction and server reconciliation
        this.prediction = {
            enabled: true,
            predictedX: this.x,
            predictedY: this.y,
            serverX: this.x,
            serverY: this.y,
            interpolationAlpha: 0,
            lastServerUpdate: Date.now(),
            reconciliationThreshold: 5 // pixels
        };

        //  Smooth movement interpolation
        this.interpolation = {
            enabled: true,
            smoothingFactor: 0.15,
            velocityX: 0,
            velocityY: 0,
            lastUpdateTime: Date.now()
        };

        // Movement
        this.speed = data.speed || PLAYER_CONFIG.DEFAULT_SPEED;
        this.direction = null;
        this.isMoving = false;
        
        // Health and state
        this.lives = data.lives || GAME_CONFIG.LIVES_PER_PLAYER;
        this.maxLives = GAME_CONFIG.LIVES_PER_PLAYER;
        this.isAlive = data.isAlive !== undefined ? data.isAlive : true;
        this.isInvulnerable = data.isInvulnerable || false;
        this.invulnerabilityEndTime = 0;
        
        // Bomb abilities
        this.maxBombs = data.maxBombs || PLAYER_CONFIG.DEFAULT_BOMB_COUNT;
        this.bombRange = data.bombRange || PLAYER_CONFIG.DEFAULT_BOMB_RANGE;
        this.placedBombs = data.placedBombs || 0;
        
        // Power-ups
        this.powerUps = {
            bombs: data.powerUps?.bombs || 0,
            flames: data.powerUps?.flames || 0,
            speed: data.powerUps?.speed || 0,
            oneUp: data.powerUps?.oneUp || 0,
            // Special abilities
            bombPush: data.powerUps?.bombPush || false,
            bombPass: data.powerUps?.bombPass || false,
            blockPass: data.powerUps?.blockPass || false,
            detonator: data.powerUps?.detonator || false
        };
        
        // Visual
        this.color = PLAYER_CONFIG.COLORS[this.index] || '#999';
        this.animations = {
            walking: false,
            invulnerable: false
        };
        
        // Performance
        this.lastUpdateTime = 0;
        this.interpolationEnabled = true;
        
        this.logger.debug('Player created', { id, nickname: this.nickname, position: { x: this.x, y: this.y } });
    }
    
    /**
     * Update player state with smooth interpolation
     */
    update(deltaTime) {
        this.lastUpdateTime += deltaTime;

        // Update invulnerability
        if (this.isInvulnerable && Date.now() >= this.invulnerabilityEndTime) {
            this.isInvulnerable = false;
            this.animations.invulnerable = false;
            this.logger.debug('Invulnerability ended');
        }

        //  Update smooth movement interpolation
        this.updateMovementInterpolation(deltaTime);

        //  Update client-side prediction
        this.updatePrediction(deltaTime);

        // Update animations
        this.updateAnimations(deltaTime);
    }

    /**
     *  Update smooth movement interpolation for 60+ FPS
     */
    updateMovementInterpolation(deltaTime) {
        if (!this.interpolation.enabled) return;

        const now = Date.now();
        const timeDelta = now - this.interpolation.lastUpdateTime;
        this.interpolation.lastUpdateTime = now;

        // Calculate velocity for smooth movement
        if (timeDelta > 0) {
            const deltaX = this.targetX - this.x;
            const deltaY = this.targetY - this.y;

            // Apply smooth interpolation
            if (Math.abs(deltaX) > 0.1 || Math.abs(deltaY) > 0.1) {
                const smoothing = this.interpolation.smoothingFactor;

                this.x += deltaX * smoothing;
                this.y += deltaY * smoothing;

                // Update velocity for animation
                this.interpolation.velocityX = deltaX * smoothing;
                this.interpolation.velocityY = deltaY * smoothing;

                // Update tile coordinates
                this.tileX = Math.floor(this.x / GAME_CONFIG.TILE_SIZE);
                this.tileY = Math.floor(this.y / GAME_CONFIG.TILE_SIZE);
            }
        }
    }

    /**
     *  Update client-side prediction system
     */
    updatePrediction(deltaTime) {
        if (!this.prediction.enabled) return;

        const now = Date.now();
        const timeSinceServerUpdate = now - this.prediction.lastServerUpdate;

        // Interpolate towards server position if we haven't received updates recently
        if (timeSinceServerUpdate > 100) { // 100ms threshold
            const serverDeltaX = this.prediction.serverX - this.prediction.predictedX;
            const serverDeltaY = this.prediction.serverY - this.prediction.predictedY;

            // Apply correction if difference is significant
            if (Math.abs(serverDeltaX) > this.prediction.reconciliationThreshold ||
                Math.abs(serverDeltaY) > this.prediction.reconciliationThreshold) {

                // Smooth correction towards server position
                this.prediction.predictedX += serverDeltaX * 0.1;
                this.prediction.predictedY += serverDeltaY * 0.1;

                // Update target position for interpolation
                this.targetX = this.prediction.predictedX;
                this.targetY = this.prediction.predictedY;
            }
        }
    }
    
    /**
     * Update player animations
     */
    updateAnimations(deltaTime) {
        // Walking animation
        this.animations.walking = this.isMoving;
        
        // Invulnerability animation
        this.animations.invulnerable = this.isInvulnerable;
    }
    
    /**
     * Set player position with smooth interpolation support
     */
    setPosition(x, y, fromServer = false) {
        // Store previous position for interpolation
        this.prevX = this.x;
        this.prevY = this.y;

        if (fromServer) {
            //  Server position update - update prediction state
            this.prediction.serverX = x;
            this.prediction.serverY = y;
            this.prediction.lastServerUpdate = Date.now();

            // Check if we need to apply server correction
            const deltaX = Math.abs(x - this.prediction.predictedX);
            const deltaY = Math.abs(y - this.prediction.predictedY);

            if (deltaX > this.prediction.reconciliationThreshold ||
                deltaY > this.prediction.reconciliationThreshold) {
                // Apply server correction
                this.applyServerCorrection(x, y);
            } else {
                // Small difference, just update target for smooth interpolation
                this.targetX = x;
                this.targetY = y;
            }
        } else {
            //  Local/predicted position update
            this.prediction.predictedX = x;
            this.prediction.predictedY = y;
            this.targetX = x;
            this.targetY = y;
        }

        // Update position (will be smoothly interpolated)
        this.x = x;
        this.y = y;
        this.tileX = Math.floor(x / GAME_CONFIG.TILE_SIZE);
        this.tileY = Math.floor(y / GAME_CONFIG.TILE_SIZE);

        // Check if player is moving
        this.isMoving = this.prevX !== this.x || this.prevY !== this.y;

        if (this.isMoving) {
            // Determine direction
            const dx = this.x - this.prevX;
            const dy = this.y - this.prevY;

            if (Math.abs(dx) > Math.abs(dy)) {
                this.direction = dx > 0 ? 'right' : 'left';
            } else if (dy !== 0) {
                this.direction = dy > 0 ? 'down' : 'up';
            }
        }
    }

    /**
     *  Apply server correction with smooth transition
     */
    applyServerCorrection(serverX, serverY) {
        this.logger.debug(`Applying server correction: (${this.x}, ${this.y}) -> (${serverX}, ${serverY})`);

        // Update prediction state
        this.prediction.predictedX = serverX;
        this.prediction.predictedY = serverY;

        // Set target for smooth interpolation
        this.targetX = serverX;
        this.targetY = serverY;

        // Immediate position update for critical corrections
        const deltaX = Math.abs(serverX - this.x);
        const deltaY = Math.abs(serverY - this.y);

        if (deltaX > 20 || deltaY > 20) {
            // Large correction - snap immediately
            this.x = serverX;
            this.y = serverY;
        }
        // Otherwise let interpolation handle the smooth transition
    }

    /**
     *  Predict movement for immediate visual feedback
     */
    predictMovement(direction, distance) {
        if (!this.prediction.enabled) return;

        let newX = this.prediction.predictedX;
        let newY = this.prediction.predictedY;

        switch (direction) {
            case 'up':
                newY -= distance;
                break;
            case 'down':
                newY += distance;
                break;
            case 'left':
                newX -= distance;
                break;
            case 'right':
                newX += distance;
                break;
        }

        // Update predicted position
        this.prediction.predictedX = newX;
        this.prediction.predictedY = newY;

        // Set as target for interpolation
        this.setPosition(newX, newY, false);
        this.direction = direction;
        this.isMoving = true;
    }
    
    /**
     * Get interpolated position for ultra-smooth rendering
     */
    getInterpolatedPosition(alpha = 1.0) {
        if (!this.interpolation.enabled) {
            return { x: this.x, y: this.y };
        }

        //  Use prediction for local player, interpolation for others
        if (this.isLocal && this.prediction.enabled) {
            // For local player, use predicted position for immediate feedback
            return {
                x: this.prediction.predictedX,
                y: this.prediction.predictedY
            };
        }

        //  Enhanced interpolation with velocity smoothing
        const deltaX = this.targetX - this.x;
        const deltaY = this.targetY - this.y;

        // Apply velocity-based smoothing for more natural movement
        const velocityFactor = Math.min(1.0, Math.sqrt(
            this.interpolation.velocityX * this.interpolation.velocityX +
            this.interpolation.velocityY * this.interpolation.velocityY
        ) / 10);

        const smoothedAlpha = alpha * (0.5 + velocityFactor * 0.5);

        return {
            x: this.x + deltaX * smoothedAlpha,
            y: this.y + deltaY * smoothedAlpha
        };
    }

    /**
     *  Get render position optimized for 60+ FPS
     */
    getRenderPosition() {
        // Use interpolated position for smooth rendering
        return this.getInterpolatedPosition();
    }
    
    /**
     * Move player in direction
     */
    move(direction, distance) {
        let newX = this.x;
        let newY = this.y;
        
        switch (direction) {
            case 'up':
                newY -= distance;
                break;
            case 'down':
                newY += distance;
                break;
            case 'left':
                newX -= distance;
                break;
            case 'right':
                newX += distance;
                break;
        }
        
        this.setPosition(newX, newY);
        this.direction = direction;
        
        this.logger.verbose(`Moved ${direction} to (${newX}, ${newY})`);
    }
    
    /**
     * Check if player can place a bomb
     */
    canPlaceBomb() {
        return this.isAlive && this.placedBombs < this.maxBombs;
    }
    
    /**
     * Place a bomb
     */
    placeBomb() {
        if (!this.canPlaceBomb()) {
            this.logger.debug('Cannot place bomb', { 
                isAlive: this.isAlive, 
                placedBombs: this.placedBombs, 
                maxBombs: this.maxBombs 
            });
            return null;
        }
        
        this.placedBombs++;
        
        const bomb = {
            id: `${this.id}-${Date.now()}`,
            playerId: this.id,
            x: this.tileX,
            y: this.tileY,
            range: this.bombRange,
            timer: GAME_CONFIG.BOMB_TIMER
        };
        
        this.logger.debug('Bomb placed', bomb);
        return bomb;
    }
    
    /**
     * Bomb exploded (decrease count)
     */
    bombExploded() {
        if (this.placedBombs > 0) {
            this.placedBombs--;
            this.logger.debug('Bomb exploded, count decreased', { placedBombs: this.placedBombs });
        }
    }
    
    /**
     * Apply power-up effect
     */
    applyPowerUp(type) {
        switch (type) {
            case 'bombs':
                if (this.maxBombs < PLAYER_CONFIG.MAX_BOMB_COUNT) {
                    this.maxBombs++;
                    this.powerUps.bombs++;
                    this.logger.debug('Bomb power-up applied', { maxBombs: this.maxBombs });
                }
                break;
                
            case 'flames':
                if (this.bombRange < PLAYER_CONFIG.MAX_BOMB_RANGE) {
                    this.bombRange++;
                    this.powerUps.flames++;
                    this.logger.debug('Flame power-up applied', { bombRange: this.bombRange });
                }
                break;
                
            case 'speed':
                if (this.speed < PLAYER_CONFIG.MAX_SPEED) {
                    this.speed += 0.5;
                    this.powerUps.speed++;
                    this.logger.debug('Speed power-up applied', { speed: this.speed });
                }
                break;
                
            case 'oneUp':
                if (this.lives < 9) {
                    this.lives++;
                    this.powerUps.oneUp++;
                    this.logger.debug('Life power-up applied', { lives: this.lives });
                }
                break;
                
            case 'bombPush':
                this.powerUps.bombPush = true;
                this.logger.debug('Bomb push power-up applied');
                break;
                
            case 'bombPass':
                this.powerUps.bombPass = true;
                this.logger.debug('Bomb pass power-up applied');
                break;
                
            case 'blockPass':
                this.powerUps.blockPass = true;
                this.logger.debug('Block pass power-up applied');
                break;
                
            case 'detonator':
                this.powerUps.detonator = true;
                this.logger.debug('Detonator power-up applied');
                break;
                
            default:
                this.logger.warn('Unknown power-up type:', type);
        }
    }
    
    /**
     * Take damage
     */
    takeDamage(amount = 1) {
        if (!this.isAlive || this.isInvulnerable) {
            return false;
        }
        
        this.lives -= amount;
        this.logger.debug('Player took damage', { lives: this.lives, amount });
        
        if (this.lives <= 0) {
            this.eliminate();
            return true; // Player eliminated
        } else {
            // Grant temporary invulnerability
            this.isInvulnerable = true;
            this.invulnerabilityEndTime = Date.now() + GAME_CONFIG.INVULNERABILITY_TIME;
            this.animations.invulnerable = true;
            this.logger.debug('Player damaged, invulnerability granted');
        }
        
        return false; // Player survived
    }
    
    /**
     * Eliminate player
     */
    eliminate() {
        this.isAlive = false;
        this.lives = 0;
        this.isInvulnerable = false;
        this.isMoving = false;
        
        this.logger.info('Player eliminated');
    }
    
    /**
     * Revive player (for ghost mode or respawn)
     */
    revive(lives = 1) {
        this.isAlive = true;
        this.lives = lives;
        this.isInvulnerable = true;
        this.invulnerabilityEndTime = Date.now() + GAME_CONFIG.INVULNERABILITY_TIME;
        
        this.logger.info('Player revived', { lives });
    }
    
    /**
     * Reset player to initial state
     */
    reset() {
        // Reset position to starting position
        const startPos = PLAYER_CONFIG.STARTING_POSITIONS[this.index];
        if (startPos) {
            this.setPosition(startPos.x * GAME_CONFIG.TILE_SIZE, startPos.y * GAME_CONFIG.TILE_SIZE);
        }
        
        // Reset stats
        this.lives = GAME_CONFIG.LIVES_PER_PLAYER;
        this.isAlive = true;
        this.isInvulnerable = false;
        this.invulnerabilityEndTime = 0;
        
        // Reset abilities
        this.speed = PLAYER_CONFIG.DEFAULT_SPEED;
        this.maxBombs = PLAYER_CONFIG.DEFAULT_BOMB_COUNT;
        this.bombRange = PLAYER_CONFIG.DEFAULT_BOMB_RANGE;
        this.placedBombs = 0;
        
        // Reset power-ups
        this.powerUps = {
            bombs: 0,
            flames: 0,
            speed: 0,
            oneUp: 0,
            bombPush: false,
            bombPass: false,
            blockPass: false,
            detonator: false
        };
        
        // Reset animations
        this.animations = {
            walking: false,
            invulnerable: false
        };
        
        this.logger.debug('Player reset to initial state');
    }
    
    /**
     * Get player statistics
     */
    getStats() {
        return {
            id: this.id,
            nickname: this.nickname,
            lives: this.lives,
            isAlive: this.isAlive,
            position: { x: this.x, y: this.y, tileX: this.tileX, tileY: this.tileY },
            abilities: {
                speed: this.speed,
                maxBombs: this.maxBombs,
                bombRange: this.bombRange,
                placedBombs: this.placedBombs
            },
            powerUps: { ...this.powerUps },
            state: {
                isInvulnerable: this.isInvulnerable,
                isMoving: this.isMoving,
                direction: this.direction
            }
        };
    }
    
    /**
     * Serialize player data for network transmission
     */
    serialize() {
        return {
            id: this.id,
            nickname: this.nickname,
            x: this.x,
            y: this.y,
            tileX: this.tileX,
            tileY: this.tileY,
            lives: this.lives,
            isAlive: this.isAlive,
            isInvulnerable: this.isInvulnerable,
            speed: this.speed,
            maxBombs: this.maxBombs,
            bombRange: this.bombRange,
            placedBombs: this.placedBombs,
            powerUps: { ...this.powerUps },
            color: this.color,
            direction: this.direction,
            isMoving: this.isMoving
        };
    }
    
    /**
     * Update from network data with server reconciliation
     */
    updateFromNetwork(data) {
        //  Update position with server reconciliation
        this.setPosition(data.x, data.y, true); // fromServer = true

        // Update state
        this.lives = data.lives;
        this.isAlive = data.isAlive;
        this.isInvulnerable = data.isInvulnerable;

        // Update abilities
        this.speed = data.speed;
        this.maxBombs = data.maxBombs;
        this.bombRange = data.bombRange;
        this.placedBombs = data.placedBombs;

        // Update power-ups
        if (data.powerUps) {
            this.powerUps = { ...data.powerUps };
        }

        // Update visuals
        if (data.direction) {
            this.direction = data.direction;
        }

        this.isMoving = data.isMoving || false;

        this.logger.verbose('Updated from network data with server reconciliation');
    }
    
    /**
     * Check if player is at specific tile position
     */
    isAtTile(tileX, tileY) {
        return this.tileX === tileX && this.tileY === tileY;
    }
    
    /**
     * Get player's current tile key
     */
    getTileKey() {
        return `${this.tileX},${this.tileY}`;
    }
}

export default Player;
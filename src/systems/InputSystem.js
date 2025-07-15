// src/systems/InputSystem.js
// Handles all input processing with rate limiting and conflict resolution

import { GAME_CONFIG } from '../utils/Constants.js';
import { Logger } from '../utils/Logger.js';
import { eventManager, EventCleanupMixin } from '../utils/EventManager.js';

/**
 * Enhanced Input System with Client-Side Prediction
 * Zero input latency through predictive movement and aggressive batching
 * Implements rollback for server corrections and smooth interpolation
 */
export class InputSystem extends EventCleanupMixin {
    constructor() {
        super(); // Initialize EventCleanupMixin
        this.logger = new Logger('InputSystem');

        // Set up event manager
        this.setEventManager(eventManager);

        // Input state
        this.keys = new Set();
        this.lastInputTime = 0;
        this.isEnabled = false;

        // Aggressive rate limiting for maximum responsiveness
        this.lastMovementTime = 0;
        this.lastBombTime = 0;
        this.movementRateLimit = 8; // Reduced to 8ms for better batching
        this.bombRateLimit = 150; // Reduced for faster bomb placement

        // Enhanced input batching with prediction
        this.inputBatch = {
            actions: [],               // Batched input actions
            movement: null,
            lastDirection: null,
            batchTimeout: null,
            batchInterval: 8,          // Aggressive 8ms batching
            pendingMovement: false,
            maxBatchSize: 5            // Maximum actions per batch
        };

        // Client-side prediction system
        this.prediction = {
            enabled: true,
            predictedPosition: { x: 0, y: 0 },
            lastServerPosition: { x: 0, y: 0 },
            predictionHistory: [],     // History for rollback
            maxHistorySize: 30,        // ~500ms of history at 60fps
            sequenceNumber: 0,         // For server reconciliation
            pendingInputs: new Map()   // Inputs awaiting server confirmation
        };

        // Input mapping
        this.keyMapping = {
            // Movement keys
            'ArrowUp': 'move_up',
            'ArrowDown': 'move_down',
            'ArrowLeft': 'move_left',
            'ArrowRight': 'move_right',
            'KeyW': 'move_up',
            'KeyS': 'move_down',
            'KeyA': 'move_left',
            'KeyD': 'move_right',

            // Action keys
            'Space': 'place_bomb',
            'Enter': 'open_chat',
            'Escape': 'close_chat',

        };

        // Movement priority (for simultaneous key presses)
        this.movementPriority = ['move_up', 'move_down', 'move_left', 'move_right'];

        // Enhanced movement state tracking with prediction
        this.movementState = {
            isMoving: false,
            currentDirection: null,
            lastValidDirection: null,
            continuousMovement: false,
            predictedMoving: false,     // Client-side predicted state
            predictedDirection: null    // Client-side predicted direction
        };

        // Event listeners
        this.listeners = new Map();

        // Input processor for batching
        this.inputProcessor = {
            processingQueue: [],
            isProcessing: false,
            lastProcessTime: 0
        };

        this.setupEventHandlers();
        this.logger.info('Enhanced input system with client-side prediction initialized');
    }
    
    /**
     * Setup DOM event handlers
     */
    setupEventHandlers() {
        // Keyboard events
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
        
        // Prevent context menu on right click
        document.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Focus management
        window.addEventListener('focus', () => this.handleWindowFocus());
        window.addEventListener('blur', () => this.handleWindowBlur());
        
        this.logger.debug('Event handlers setup');
    }
    
    /**
     * Handle key down events
     */
    handleKeyDown(event) {
        // Don't process input if disabled
        if (!this.isEnabled) return;
        
        // Don't interfere with chat input
        if (this.isInputFocused()) return;
        
        const action = this.keyMapping[event.code];
        if (!action) return;
        
        // Add to pressed keys
        this.keys.add(event.code);
        
        // Rate limiting
        const now = Date.now();
        if (now - this.lastInputTime < GAME_CONFIG.INPUT_RATE_LIMIT) {
            return;
        }
        
        // Process action
        this.processAction(action, event);
        
        
        
        // Prevent default for game keys
        if (this.shouldPreventDefault(event.code)) {
            event.preventDefault();
        }
        
        this.lastInputTime = now;
    }
    
    /**
     * Handle key up events
     */
    handleKeyUp(event) {
        this.keys.delete(event.code);
    }
    
    /**
     * Process input action
     */
    processAction(action, event) {
        switch (action) {
            case 'move_up':
            case 'move_down':
            case 'move_left':
            case 'move_right':
                this.handleMovement(action);
                break;
                
            case 'place_bomb':
                this.handlePlaceBomb();
                break;
                
            case 'open_chat':
                this.handleOpenChat();
                break;
                
            case 'close_chat':
                this.handleCloseChat();
                break;
                
            default:
                this.logger.debug('Unknown action:', action);
        }
    }
    
    /**
     * Handle movement input with client-side prediction and aggressive batching
     */
    handleMovement(action) {
        const direction = action.replace('move_', '');
        const now = Date.now();

        // Aggressive batching with immediate prediction
        if (now - this.lastMovementTime < this.movementRateLimit) {
            // Add to batch for server processing
            this.addToBatch({
                type: 'move',
                direction: direction,
                timestamp: now,
                sequenceNumber: ++this.prediction.sequenceNumber
            });

            // Immediate client-side prediction for zero latency
            this.applyPredictiveMovement(direction);
            return;
        }

        // Check for conflicting movement keys
        const currentMovement = this.getCurrentMovement();
        if (currentMovement && currentMovement !== direction) {
            // Use movement priority to resolve conflicts
            const currentPriority = this.movementPriority.indexOf(`move_${currentMovement}`);
            const newPriority = this.movementPriority.indexOf(action);

            if (newPriority <= currentPriority) {
                // New movement has higher priority
                this.emitPredictiveMovement(direction);
            }
        } else {
            // No conflict, emit movement with prediction
            this.emitPredictiveMovement(direction);
        }
    }

    /**
     * Add input to batch for efficient processing
     */
    addToBatch(inputAction) {
        this.inputBatch.actions.push(inputAction);

        // Store for server reconciliation
        this.prediction.pendingInputs.set(inputAction.sequenceNumber, inputAction);

        // Process batch if it's getting full
        if (this.inputBatch.actions.length >= this.inputBatch.maxBatchSize) {
            this.processBatchedInputs();
        } else {
            // Schedule batch processing
            this.scheduleBatchProcessing();
        }
    }

    /**
     * Apply immediate client-side prediction
     */
    applyPredictiveMovement(direction) {
        // Update predicted state immediately
        this.movementState.predictedMoving = true;
        this.movementState.predictedDirection = direction;

        // Emit predictive movement for immediate visual feedback
        eventManager.emit('predictedMovement', {
            direction: direction,
            timestamp: Date.now(),
            predicted: true,
            sequenceNumber: this.prediction.sequenceNumber
        });

        // Store prediction in history for rollback
        this.storePredictionHistory(direction);
    }

    /**
     * Enhanced movement emission with prediction
     */
    emitPredictiveMovement(direction) {
        // Apply client-side prediction first
        this.applyPredictiveMovement(direction);

        // Then emit for server processing
        this.movementState.currentDirection = direction;
        this.movementState.isMoving = true;
        this.movementState.lastValidDirection = direction;

        // DEBUGGING: Log movement emission to debug the issue
        this.logger.info('InputSystem emitting move event:', {
            direction: direction,
            isEnabled: this.isEnabled,
            timestamp: Date.now()
        });

        this.emit('move', direction);
        this.lastMovementTime = Date.now();

        // Clear pending movement
        this.inputBatch.pendingMovement = false;
    }

    /**
     * Emit movement with state tracking
     */
    emitMovement(direction) {
        this.movementState.currentDirection = direction;
        this.movementState.isMoving = true;
        this.movementState.lastValidDirection = direction;

        this.emit('move', direction);
        this.lastMovementTime = Date.now();

        // Clear pending movement
        this.inputBatch.pendingMovement = false;
    }
    
    /**
     * Get current movement direction
     */
    getCurrentMovement() {
        for (const priority of this.movementPriority) {
            const keyCode = Object.keys(this.keyMapping).find(key => 
                this.keyMapping[key] === priority
            );
            if (keyCode && this.keys.has(keyCode)) {
                return priority.replace('move_', '');
            }
        }
        return null;
    }
    
    /**
     * Handle bomb placement with rate limiting
     */
    handlePlaceBomb() {
        const now = Date.now();

        // Rate limit bomb placement
        if (now - this.lastBombTime < this.bombRateLimit) {
            return; // Ignore rapid bomb placement attempts
        }

        this.emit('placeBomb');
        this.lastBombTime = now;
    }
    
    /**
     * Handle chat open
     */
    handleOpenChat() {
        this.emit('openChat');
    }
    
    /**
     * Handle chat close
     */
    handleCloseChat() {
        this.emit('closeChat');
    }
    
    
    
    /**
     * Check if input element is focused
     */
    isInputFocused() {
        const activeElement = document.activeElement;
        return activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.contentEditable === 'true'
        );
    }
    
    /**
     * Check if default should be prevented
     */
    shouldPreventDefault(keyCode) {
        const gameKeys = [
            'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'KeyW', 'KeyS', 'KeyA', 'KeyD'
        ];
        return gameKeys.includes(keyCode);
    }
    
    /**
     * Handle window focus
     */
    handleWindowFocus() {
        this.logger.debug('Window focused');
        // Clear keys to prevent stuck keys
        this.keys.clear();
    }
    
    /**
     * Handle window blur
     */
    handleWindowBlur() {
        this.logger.debug('Window blurred');
        // Clear keys to prevent stuck keys
        this.keys.clear();
    }
    
    /**
     * Update input system (called each frame)
     */
    update(deltaTime) {
        if (!this.isEnabled) return;

        // Process continuous input (like movement)
        this.processContinuousInput(deltaTime);

        // Process batched inputs
        this.processBatchedInputs();

        // Update prediction system
        this.updatePredictionSystem(deltaTime);
    }

    /**
     * Process batched inputs for efficient server communication
     */
    processBatchedInputs() {
        if (this.inputBatch.actions.length === 0 || this.inputProcessor.isProcessing) {
            return;
        }

        this.inputProcessor.isProcessing = true;
        const actionsToProcess = [...this.inputBatch.actions];
        this.inputBatch.actions.length = 0; // Clear batch

        try {
            // Group actions by type for efficient processing
            const groupedActions = this.groupActionsByType(actionsToProcess);

            // Process movement actions with deduplication
            if (groupedActions.move && groupedActions.move.length > 0) {
                const latestMove = groupedActions.move[groupedActions.move.length - 1];
                this.emit('move', latestMove.direction);
            }

            // Process other actions
            Object.entries(groupedActions).forEach(([type, actions]) => {
                if (type !== 'move') {
                    actions.forEach(action => {
                        this.emit(type, action);
                    });
                }
            });

        } catch (error) {
            this.logger.error('Error processing batched inputs:', error);
        } finally {
            this.inputProcessor.isProcessing = false;
            this.inputProcessor.lastProcessTime = Date.now();
        }
    }

    /**
     * Group actions by type for efficient processing
     */
    groupActionsByType(actions) {
        return actions.reduce((groups, action) => {
            if (!groups[action.type]) {
                groups[action.type] = [];
            }
            groups[action.type].push(action);
            return groups;
        }, {});
    }

    /**
     * Schedule batch processing
     */
    scheduleBatchProcessing() {
        if (this.inputBatch.batchTimeout) return;

        this.inputBatch.batchTimeout = setTimeout(() => {
            this.processBatchedInputs();
            this.inputBatch.batchTimeout = null;
        }, this.inputBatch.batchInterval);
    }

    /**
     * Update prediction system for rollback and reconciliation
     */
    updatePredictionSystem(deltaTime) {
        if (!this.prediction.enabled) return;

        // Clean up old prediction history
        const now = Date.now();
        this.prediction.predictionHistory = this.prediction.predictionHistory.filter(
            entry => now - entry.timestamp < 500 // Keep 500ms of history
        );

        // Clean up old pending inputs
        this.prediction.pendingInputs.forEach((input, sequenceNumber) => {
            if (now - input.timestamp > 1000) { // 1 second timeout
                this.prediction.pendingInputs.delete(sequenceNumber);
            }
        });
    }

    /**
     * Store prediction history for rollback
     */
    storePredictionHistory(direction) {
        this.prediction.predictionHistory.push({
            direction: direction,
            timestamp: Date.now(),
            sequenceNumber: this.prediction.sequenceNumber,
            position: { ...this.prediction.predictedPosition }
        });

        // Limit history size
        if (this.prediction.predictionHistory.length > this.prediction.maxHistorySize) {
            this.prediction.predictionHistory.shift();
        }
    }

    /**
     * Handle server movement confirmation for reconciliation
     */
    handleServerMovementConfirmation(serverData) {
        const { sequenceNumber, position, timestamp } = serverData;

        // Remove confirmed input from pending
        this.prediction.pendingInputs.delete(sequenceNumber);

        // Update last server position
        this.prediction.lastServerPosition = position;

        // Check if prediction was correct
        const prediction = this.prediction.predictionHistory.find(
            p => p.sequenceNumber === sequenceNumber
        );

        if (prediction) {
            const positionDiff = Math.abs(prediction.position.x - position.x) +
                               Math.abs(prediction.position.y - position.y);

            // If prediction was significantly wrong, apply correction
            if (positionDiff > 5) { // 5px tolerance
                this.applyServerCorrection(position, sequenceNumber);
            }
        }
    }

    /**
     * Apply server correction with rollback
     */
    applyServerCorrection(serverPosition, confirmedSequenceNumber) {
        this.logger.debug('Applying server correction', { serverPosition, confirmedSequenceNumber });

        // Update predicted position to server position
        this.prediction.predictedPosition = { ...serverPosition };

        // Re-apply any inputs that came after the confirmed one
        const subsequentInputs = Array.from(this.prediction.pendingInputs.values())
            .filter(input => input.sequenceNumber > confirmedSequenceNumber)
            .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

        subsequentInputs.forEach(input => {
            // Re-apply prediction for this input
            this.applyPredictiveMovement(input.direction);
        });

        // Emit correction event for smooth interpolation
        eventManager.emit('serverMovementConfirmation', {
            correctedPosition: serverPosition,
            sequenceNumber: confirmedSequenceNumber,
            timestamp: Date.now()
        });
    }
    
    /**
     * Process continuous input (like held movement keys) with optimization
     */
    processContinuousInput(deltaTime) {
        const currentMovement = this.getCurrentMovement();
        const now = Date.now();

        // Handle pending batched movement
        if (this.inputBatch.pendingMovement && this.inputBatch.movement) {
            if (now - this.lastMovementTime >= this.movementRateLimit) {
                this.emitMovement(this.inputBatch.movement);
                this.inputBatch.movement = null;
                this.inputBatch.pendingMovement = false;
            }
        }

        // Continuous movement with improved rate limiting
        if (currentMovement) {
            if (now - this.lastMovementTime >= this.movementRateLimit) {
                // Only emit if direction changed or it's been a while
                if (currentMovement !== this.movementState.currentDirection ||
                    now - this.lastMovementTime > this.movementRateLimit * 2) {
                    this.emitMovement(currentMovement);
                }
            }
        } else {
            // No movement - update state
            if (this.movementState.isMoving) {
                this.movementState.isMoving = false;
                this.movementState.currentDirection = null;
            }
        }
    }
    
   
    
    /**
     * Enable input processing
     */
    enable() {
        this.isEnabled = true;
        this.logger.debug('Input enabled');
    }
    
    /**
     * Disable input processing
     */
    disable() {
        this.isEnabled = false;
        this.keys.clear();
        this.logger.debug('Input disabled');
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
                    this.logger.error('Error in input event callback:', error);
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
     * Cleanup input system
     */
    cleanup() {
        this.disable();
        this.removeAllListeners();
        
        // Clear all input tracking arrays
        this.keys.clear();
        
        // Remove DOM event listeners
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('keyup', this.handleKeyUp);
        document.removeEventListener('contextmenu', () => {});
        
        // Clear all event listeners
        this.listeners.clear();

        // Clean up all event listeners
        this.cleanupEvents();

        this.logger.info('Input system cleaned up with memory leak prevention');
    }
}

export default InputSystem;
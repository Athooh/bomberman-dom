// bomberdMan/src/easy-api.js - Fixed Easy API for MiniFramework
// Corrected import paths and improved API

import { h, render, DOMRenderer } from '../mini-framework/src/core/dom.js';
import { createStore, connectStore } from '../mini-framework/src/core/state.js';
import { createRouter } from '../mini-framework/src/core/router.js';
import { EventBus } from '../mini-framework/src/core/events.js';

/**
 * Easy Framework API - Simplified interface for games
 */
export class EasyFramework {
    constructor(options = {}) {
        this.options = {
            container: options.container || '#app',
            state: options.state || {},
            routes: options.routes || {},
            debug: options.debug || false,
            ...options
        };
        
        this._initialized = false;
        this._components = new Map();
        this._renderFunction = null;
        this._disconnectStore = null;
        
        this._initialize();
    }
    
    _initialize() {
        if (this._initialized) return this;
        
        try {
            // Setup store
            this.store = createStore(this.options.state, {
                debug: this.options.debug
            });
            
            // Setup renderer
            this.renderer = new DOMRenderer(this.options.container);
            
            // Setup router
            this.router = createRouter({ mode: 'hash' });
            
            // Setup event bus
            this.events = new EventBus({ debug: this.options.debug });
            
            this._initialized = true;
            
            if (this.options.debug) {
                console.log('[EasyFramework] Initialized successfully');
            }
        } catch (error) {
            console.error('[EasyFramework] Initialization error:', error);
            throw error;
        }
        
        return this;
    }
    
    /**
     * Set state easily with automatic mutation registration
     */
    setState(updates) {
        if (typeof updates === 'function') {
            const currentState = this.store.getState();
            updates = updates(currentState);
        }
        
        Object.entries(updates).forEach(([key, value]) => {
            const mutationName = `SET_${key.toUpperCase()}`;
            
            // Register mutation if it doesn't exist
            if (!this.store._mutations.has(mutationName)) {
                this.store.registerMutation(mutationName, (state, newValue) => {
                    if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
                        // Merge objects
                        state[key] = { ...state[key], ...newValue };
                    } else {
                        // Direct assignment for primitives and arrays
                        state[key] = newValue;
                    }
                });
            }
            
            this.store.commit(mutationName, value);
        });
        
        return this;
    }
    
    /**
     * Get state easily
     */
    getState(path) {
        return path ? this.store.get(path) : this.store.getState();
    }
    
    /**
     * Register a custom mutation
     */
    registerMutation(name, mutationFn) {
        this.store.registerMutation(name, mutationFn);
        return this;
    }
    
    /**
     * Register a custom action
     */
    registerAction(name, actionFn) {
        this.store.registerAction(name, actionFn);
        return this;
    }
    
    /**
     * Commit a mutation
     */
    commit(mutationName, payload) {
        this.store.commit(mutationName, payload);
        return this;
    }
    
    /**
     * Dispatch an action
     */
    async dispatch(actionName, payload) {
        return await this.store.dispatch(actionName, payload);
    }
    
    /**
     * Subscribe to state changes
     */
    subscribe(callback) {
        return this.store.subscribe(callback);
    }
    
    /**
     * Watch specific state path
     */
    watch(path, callback) {
        return this.store.watch(path, callback);
    }
    
    /**
     * Set render function and connect to store
     */
    render(renderFn) {
        this._renderFunction = renderFn;
        
        // Disconnect previous connection if exists
        if (this._disconnectStore) {
            this._disconnectStore();
        }
        
        // Connect store to renderer for auto-updates
        this._disconnectStore = connectStore(this.store, this.renderer, (state) => {
            try {
                return this._renderFunction(state, this);
            } catch (error) {
                console.error('[EasyFramework] Render error:', error);
                return h('div', { 
                    style: { 
                        color: 'red', 
                        padding: '20px',
                        fontFamily: 'monospace',
                        backgroundColor: '#ffe6e6',
                        border: '2px solid red',
                        borderRadius: '5px',
                        margin: '20px'
                    } 
                }, [
                    h('h3', {}, ['⚠️ Render Error']),
                    h('p', {}, [error.message]),
                    h('pre', {}, [error.stack || 'No stack trace available'])
                ]);
            }
        });
        
        return this;
    }
    
    /**
     * Start the framework
     */
    start() {
        try {
            if (this.router && this.router.routes.length > 0) {
                this.router.start();
            }
            
            if (this.options.debug) {
                console.log('[EasyFramework] Started successfully');
                console.log('State:', this.getState());
            }
        } catch (error) {
            console.error('[EasyFramework] Start error:', error);
            throw error;
        }
        
        return this;
    }
    
    /**
     * Stop the framework and cleanup
     */
    stop() {
        try {
            if (this.router) {
                this.router.stop();
            }
            
            if (this._disconnectStore) {
                this._disconnectStore();
                this._disconnectStore = null;
            }
            
            this.events.off(); // Remove all event listeners
            
            if (this.options.debug) {
                console.log('[EasyFramework] Stopped');
            }
        } catch (error) {
            console.error('[EasyFramework] Stop error:', error);
        }
        
        return this;
    }
    
    /**
     * Add route (if router is being used)
     */
    addRoute(path, handler, options = {}) {
        this.router.addRoute(path, handler, options);
        return this;
    }
    
    /**
     * Navigate to route
     */
    navigate(path) {
        this.router.push(path);
        return this;
    }
    
    /**
     * Emit custom event
     */
    emit(eventName, data) {
        this.events.emit(eventName, data);
        return this;
    }
    
    /**
     * Listen to custom event
     */
    on(eventName, callback) {
        return this.events.on(eventName, callback);
    }
    
    /**
     * Remove event listener
     */
    off(eventName, callback) {
        this.events.off(eventName, callback);
        return this;
    }
}

/**
 * Create app function - main entry point
 */
export function createApp(options = {}) {
    return new EasyFramework(options);
}

// Re-export core functionality for direct use
export { h, render } from '../mini-framework/src/core/dom.js';
export { createStore } from '../mini-framework/src/core/state.js';
export { createRouter } from '../mini-framework/src/core/router.js';
export { EventBus } from '../mini-framework/src/core/events.js';
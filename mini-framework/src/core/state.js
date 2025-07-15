// src/core/state.js
// Reactive State Management System

import { isObject, isFunction, clone, merge } from '../utils/helpers.js';
import { STATE_EVENTS, CONFIG } from '../utils/constants.js';

/**
 * Create a reactive state store
 */
export function createStore(initialState = {}, options = {}) {
    return new Store(initialState, options);
}

/**
 * Main Store class - handles all state operations
 */
class Store {
    constructor(initialState = {}, options = {}) {
        // Internal state (not directly accessible)
        this._state = clone(initialState);
        this._subscribers = new Set();
        this._computedCache = new Map();
        this._computedDeps = new Map();
        this._middleware = [];
        this._mutations = new Map();
        this._actions = new Map();
        
        // Configuration
        this._options = {
            strict: options.strict || CONFIG.STRICT_MODE,
            debug: options.debug || CONFIG.DEBUG,
            middleware: options.middleware || [],
            ...options
        };
        
        // Setup middleware
        this._setupMiddleware();
        
        // Emit initial state
        if (this._options.debug) {
            console.log('[State] Store initialized with state:', this._state);
        }
    }
    
    /**
     * Get current state (read-only)
     */
    getState() {
        return clone(this._state);
    }
    
    /**
     * Subscribe to state changes
     */
    subscribe(callback) {
        if (!isFunction(callback)) {
            throw new Error('Subscriber must be a function');
        }
        
        this._subscribers.add(callback);
        
        // Return unsubscribe function
        return () => {
            this._subscribers.delete(callback);
        };
    }
    
    /**
     * Register a mutation (synchronous state change)
     */
    registerMutation(name, mutationFn) {
        if (!isFunction(mutationFn)) {
            throw new Error('Mutation must be a function');
        }
        
        this._mutations.set(name, mutationFn);
    }
    
    /**
     * Register an action (can be asynchronous)
     */
    registerAction(name, actionFn) {
        if (!isFunction(actionFn)) {
            throw new Error('Action must be a function');
        }
        
        this._actions.set(name, actionFn);
    }
    
    /**
     * Commit a mutation (the only way to change state)
     */
    commit(mutationName, payload) {
        const mutation = this._mutations.get(mutationName);
        if (!mutation) {
            throw new Error(`Mutation '${mutationName}' not found`);
        }
        
        const oldState = clone(this._state);
        
        // Apply middleware (before mutation)
        this._runMiddleware('beforeMutation', {
            type: mutationName,
            payload,
            state: oldState
        });
        
        // Apply mutation
        mutation(this._state, payload);
        
        // Apply middleware (after mutation)
        this._runMiddleware('afterMutation', {
            type: mutationName,
            payload,
            oldState,
            newState: clone(this._state)
        });
        
        // Invalidate computed properties that depend on changed paths
        this._invalidateComputed();
        
        // Notify subscribers
        this._notifySubscribers(oldState, clone(this._state));
        
        if (this._options.debug) {
            console.log(`[State] Mutation '${mutationName}':`, {
                payload,
                oldState,
                newState: clone(this._state)
            });
        }
    }
    
    /**
     * Dispatch an action
     */
    async dispatch(actionName, payload) {
        const action = this._actions.get(actionName);
        if (!action) {
            throw new Error(`Action '${actionName}' not found`);
        }
        
        if (this._options.debug) {
            console.log(`[State] Dispatching action '${actionName}':`, payload);
        }
        
        // Actions receive commit and dispatch functions
        const context = {
            commit: this.commit.bind(this),
            dispatch: this.dispatch.bind(this),
            getState: this.getState.bind(this),
            state: this.getState() // Convenience getter
        };
        
        return await action(context, payload);
    }
    
    /**
     * Create computed property (derived state)
     */
    computed(computeFn, dependencies = []) {
        if (!isFunction(computeFn)) {
            throw new Error('Computed function must be a function');
        }
        
        const computedId = Symbol('computed');
        this._computedDeps.set(computedId, dependencies);
        
        return () => {
            // Check cache first
            if (this._computedCache.has(computedId)) {
                return this._computedCache.get(computedId);
            }
            
            // Compute value
            const value = computeFn(this.getState());
            this._computedCache.set(computedId, value);
            
            return value;
        };
    }
    
    /**
     * Get specific path from state
     */
    get(path) {
        return this._getNestedValue(this._state, path);
    }
    
    /**
     * Set specific path in state (uses mutation internally)
     */
    set(path, value) {
        // Register a temporary mutation if not exists
        const mutationName = `SET_${path.toUpperCase().replace(/\./g, '_')}`;
        if (!this._mutations.has(mutationName)) {
            this.registerMutation(mutationName, (state, newValue) => {
                this._setNestedValue(state, path, newValue);
            });
        }
        
        this.commit(mutationName, value);
    }
    
    /**
     * Watch specific path for changes
     */
    watch(path, callback, options = {}) {
        let oldValue = this.get(path);
        
        return this.subscribe((oldState, newState) => {
            const newValue = this._getNestedValue(newState, path);
            
            if (oldValue !== newValue || options.deep) {
                if (options.immediate || oldValue !== newValue) {
                    callback(newValue, oldValue);
                    oldValue = newValue;
                }
            }
        });
    }
    
    /**
     * Batch multiple mutations
     */
    batch(mutationBatch) {
        if (!Array.isArray(mutationBatch)) {
            throw new Error('Batch must be an array of mutations');
        }
        
        const oldState = clone(this._state);
        
        // Apply all mutations without triggering subscribers
        mutationBatch.forEach(({ mutation, payload }) => {
            const mutationFn = this._mutations.get(mutation);
            if (!mutationFn) {
                throw new Error(`Mutation '${mutation}' not found`);
            }
            mutationFn(this._state, payload);
        });
        
        // Invalidate computed properties
        this._invalidateComputed();
        
        // Notify subscribers once
        this._notifySubscribers(oldState, clone(this._state));
        
        if (this._options.debug) {
            console.log('[State] Batch mutations applied:', mutationBatch);
        }
    }
    
    /**
     * Reset state to initial state
     */
    reset(newInitialState) {
        const oldState = clone(this._state);
        this._state = clone(newInitialState || {});
        this._invalidateComputed();
        this._notifySubscribers(oldState, clone(this._state));
    }
    
    /**
     * Add middleware
     */
    use(middleware) {
        if (!isFunction(middleware)) {
            throw new Error('Middleware must be a function');
        }
        this._middleware.push(middleware);
    }
    
    // Private methods
    
    _setupMiddleware() {
        // Add built-in middleware
        if (this._options.debug) {
            this.use(this._createLogger());
        }
        
        // Add user middleware
        this._options.middleware.forEach(middleware => {
            this.use(middleware);
        });
    }
    
    _createLogger() {
        return (hook, context) => {
            if (hook === 'beforeMutation') {
                console.group(`[State] ${context.type}`);
                console.log('Payload:', context.payload);
                console.log('State (before):', context.state);
            } else if (hook === 'afterMutation') {
                console.log('State (after):', context.newState);
                console.groupEnd();
            }
        };
    }
    
    _runMiddleware(hook, context) {
        this._middleware.forEach(middleware => {
            try {
                middleware(hook, context);
            } catch (error) {
                console.error('[State] Middleware error:', error);
            }
        });
    }
    
    _notifySubscribers(oldState, newState) {
        this._subscribers.forEach(callback => {
            try {
                callback(oldState, newState);
            } catch (error) {
                console.error('[State] Subscriber error:', error);
            }
        });
    }
    
    _invalidateComputed() {
        // For now, invalidate all computed properties
        // In a real implementation, we'd track dependencies more precisely
        this._computedCache.clear();
    }
    
    _getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }
    
    _setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            if (!current[key] || !isObject(current[key])) {
                current[key] = {};
            }
            return current[key];
        }, obj);
        
        target[lastKey] = value;
    }
}

/**
 * Create reactive state that automatically triggers updates
 */
export function reactive(target, onChange) {
    if (!isObject(target)) {
        throw new Error('Reactive target must be an object');
    }
    
    return new Proxy(target, {
        set(obj, prop, value) {
            const oldValue = obj[prop];
            obj[prop] = value;
            
            if (onChange && oldValue !== value) {
                onChange(prop, value, oldValue);
            }
            
            return true;
        },
        
        get(obj, prop) {
            const value = obj[prop];
            
            // If the value is an object, make it reactive too
            if (isObject(value) && !value._isReactive) {
                Object.defineProperty(value, '_isReactive', {
                    value: true,
                    writable: false,
                    enumerable: false
                });
                return reactive(value, onChange);
            }
            
            return value;
        }
    });
}

/**
 * Connect store to DOM renderer for automatic updates (IMPROVED VERSION)
 * This version preserves input focus and cursor position during re-renders
 */
export function connectStore(store, renderer, renderFn) {
    if (!store || !renderer || !isFunction(renderFn)) {
        throw new Error('connectStore requires store, renderer, and render function');
    }
    
    let isUpdating = false;
    let hasQueuedUpdate = false;
    
    const performRender = () => {
        if (isUpdating) {
            hasQueuedUpdate = true;
            return;
        }
        
        isUpdating = true;
        hasQueuedUpdate = false;
        
        // Use requestAnimationFrame for smooth updates
        requestAnimationFrame(() => {
            try {
                const currentState = store.getState();
                const vnode = renderFn(currentState);
                
                // IMPROVED: Preserve focused element and cursor position
                const activeElement = document.activeElement;
                let focusInfo = null;
                
                if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                    focusInfo = {
                        className: activeElement.className,
                        id: activeElement.id,
                        tagName: activeElement.tagName,
                        selectionStart: activeElement.selectionStart,
                        selectionEnd: activeElement.selectionEnd,
                        value: activeElement.value
                    };
                }
                
                // Render the new virtual DOM
                renderer.render(vnode);
                
                // RESTORE FOCUS: Find the same input and restore focus + cursor position
                if (focusInfo) {
                    // Use setTimeout to ensure DOM is fully rendered
                    setTimeout(() => {
                        let targetElement = null;
                        
                        // Try to find by ID first, then by className
                        if (focusInfo.id) {
                            targetElement = document.getElementById(focusInfo.id);
                        } else if (focusInfo.className) {
                            targetElement = document.querySelector(`.${focusInfo.className.split(' ')[0]}`);
                        }
                        
                        // Restore focus and cursor position
                        if (targetElement && targetElement.tagName === focusInfo.tagName) {
                            targetElement.focus();
                            
                            // Restore cursor position if it's still valid
                            if (focusInfo.selectionStart !== null && 
                                focusInfo.selectionStart <= targetElement.value.length) {
                                targetElement.setSelectionRange(
                                    focusInfo.selectionStart,
                                    focusInfo.selectionEnd
                                );
                            }
                        }
                    }, 0);
                } else {
                    // Handle new edit inputs that need focus
                    setTimeout(() => {
                        const editInputs = document.querySelectorAll('.edit');
                        editInputs.forEach(input => {
                            if (!input.dataset.autoFocused) {
                                input.focus();
                                input.select();
                                input.dataset.autoFocused = 'true';
                            }
                        });
                    }, 10);
                }
            } catch (error) {
                console.error('connectStore render error:', error);
            } finally {
                isUpdating = false;
                
                // If another update was queued while we were rendering, process it
                if (hasQueuedUpdate) {
                    setTimeout(performRender, 0);
                }
            }
        });
    };
    
    // Initial render
    performRender();
    
    // Subscribe to changes with intelligent debouncing
    let updateTimeout;
    return store.subscribe((oldState, newState) => {
        // Clear any pending update
        if (updateTimeout) {
            clearTimeout(updateTimeout);
        }
        
        // Smart debouncing - slower for edit inputs to avoid interrupting typing
        const hasEditFocus = document.activeElement && 
                           document.activeElement.classList.contains('edit');
        const hasNewTodoFocus = document.activeElement && 
                              document.activeElement.classList.contains('new-todo');
        
        let debounceTime;
        if (hasEditFocus) {
            debounceTime = 100; // Much slower for edit inputs
        } else if (hasNewTodoFocus) {
            debounceTime = 10; // Fast for new todo input
        } else {
            debounceTime = 16; // Normal for other changes
        }
        
        // Debounce updates to prevent excessive renders
        updateTimeout = setTimeout(() => {
            performRender();
        }, debounceTime);
    });
}
/**
 * Create a simple state hook (similar to useState in React)
 */
export function useState(initialValue) {
    const store = createStore({ value: initialValue });
    
    const getValue = () => store.get('value');
    const setValue = (newValue) => {
        store.registerMutation('SET_VALUE', (state, value) => {
            state.value = isFunction(value) ? value(state.value) : value;
        });
        store.commit('SET_VALUE', newValue);
    };
    
    const subscribe = (callback) => {
        return store.watch('value', callback);
    };
    
    return [getValue, setValue, subscribe];
}
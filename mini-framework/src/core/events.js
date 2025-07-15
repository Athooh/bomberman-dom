// src/core/events.js
// Custom Event System - Framework-specific event handling

import { isFunction, isString, isObject, generateId } from '../utils/helpers.js';
import { DOM_EVENTS, CONFIG } from '../utils/constants.js';

/**
 * Custom Event class for framework events
 */
class CustomEvent {
    constructor(type, detail = {}, options = {}) {
        this.type = type;
        this.detail = detail;
        this.timeStamp = Date.now();
        this.target = options.target || null;
        this.currentTarget = null;
        this.bubbles = options.bubbles !== false;
        this.cancelable = options.cancelable !== false;
        this.defaultPrevented = false;
        this.propagationStopped = false;
        this.immediatePropagationStopped = false;
        this.eventId = generateId('event');
    }
    
    preventDefault() {
        if (this.cancelable) {
            this.defaultPrevented = true;
        }
    }
    
    stopPropagation() {
        this.propagationStopped = true;
    }
    
    stopImmediatePropagation() {
        this.immediatePropagationStopped = true;
        this.propagationStopped = true;
    }
}

/**
 * Event Bus - Global event communication system
 */
export class EventBus {
    constructor(options = {}) {
        this._listeners = new Map();
        this._onceListeners = new Map();
        this._wildcardListeners = new Set();
        this._options = {
            debug: options.debug || CONFIG.DEBUG,
            maxListeners: options.maxListeners || 100,
            ...options
        };
        
        if (this._options.debug) {
            console.log('[EventBus] Created with options:', this._options);
        }
    }
    
    /**
     * Add event listener
     */
    on(eventType, handler, options = {}) {
        if (!isString(eventType) || !isFunction(handler)) {
            throw new Error('Event type must be string and handler must be function');
        }
        
        // Handle wildcard listeners
        if (eventType.includes('*')) {
            this._wildcardListeners.add({ pattern: eventType, handler, options });
            return this._createUnsubscriber('wildcard', eventType, handler);
        }
        
        // Regular listeners
        if (!this._listeners.has(eventType)) {
            this._listeners.set(eventType, new Set());
        }
        
        const listeners = this._listeners.get(eventType);
        
        // Check max listeners
        if (listeners.size >= this._options.maxListeners) {
            console.warn(`[EventBus] Max listeners (${this._options.maxListeners}) reached for event: ${eventType}`);
        }
        
        const listenerData = { handler, options, id: generateId('listener') };
        listeners.add(listenerData);
        
        if (this._options.debug) {
            console.log(`[EventBus] Added listener for '${eventType}', total: ${listeners.size}`);
        }
        
        return this._createUnsubscriber('regular', eventType, listenerData);
    }
    
    /**
     * Add one-time event listener
     */
    once(eventType, handler, options = {}) {
        if (!isString(eventType) || !isFunction(handler)) {
            throw new Error('Event type must be string and handler must be function');
        }
        
        if (!this._onceListeners.has(eventType)) {
            this._onceListeners.set(eventType, new Set());
        }
        
        const onceListeners = this._onceListeners.get(eventType);
        const listenerData = { handler, options, id: generateId('once') };
        onceListeners.add(listenerData);
        
        if (this._options.debug) {
            console.log(`[EventBus] Added once listener for '${eventType}'`);
        }
        
        return this._createUnsubscriber('once', eventType, listenerData);
    }
    
    /**
     * Remove event listener
     */
    off(eventType, handler) {
        if (eventType && !handler) {
            // Remove all listeners for event type
            this._listeners.delete(eventType);
            this._onceListeners.delete(eventType);
            return true;
        }
        
        if (!eventType && !handler) {
            // Remove all listeners
            this._listeners.clear();
            this._onceListeners.clear();
            this._wildcardListeners.clear();
            return true;
        }
        
        // Remove specific listener
        let removed = false;
        
        // Check regular listeners
        const listeners = this._listeners.get(eventType);
        if (listeners) {
            for (const listenerData of listeners) {
                if (listenerData.handler === handler) {
                    listeners.delete(listenerData);
                    removed = true;
                    break;
                }
            }
        }
        
        // Check once listeners
        const onceListeners = this._onceListeners.get(eventType);
        if (onceListeners) {
            for (const listenerData of onceListeners) {
                if (listenerData.handler === handler) {
                    onceListeners.delete(listenerData);
                    removed = true;
                    break;
                }
            }
        }
        
        return removed;
    }
    
    /**
     * Emit event
     */
    emit(eventType, detail = {}, options = {}) {
        if (!isString(eventType)) {
            throw new Error('Event type must be string');
        }
        
        const event = new CustomEvent(eventType, detail, options);
        
        if (this._options.debug) {
            console.log(`[EventBus] Emitting '${eventType}':`, detail);
        }
        
        let handlerCount = 0;
        
        // Handle once listeners first
        const onceListeners = this._onceListeners.get(eventType);
        if (onceListeners) {
            const listenersArray = [...onceListeners];
            this._onceListeners.delete(eventType); // Remove all once listeners
            
            for (const listenerData of listenersArray) {
                if (event.immediatePropagationStopped) break;
                
                try {
                    event.currentTarget = listenerData.options.target || null;
                    listenerData.handler(event);
                    handlerCount++;
                } catch (error) {
                    console.error(`[EventBus] Error in once listener for '${eventType}':`, error);
                }
            }
        }
        
        // Handle regular listeners
        const listeners = this._listeners.get(eventType);
        if (listeners && !event.propagationStopped) {
            for (const listenerData of listeners) {
                if (event.immediatePropagationStopped) break;
                
                try {
                    event.currentTarget = listenerData.options.target || null;
                    listenerData.handler(event);
                    handlerCount++;
                } catch (error) {
                    console.error(`[EventBus] Error in listener for '${eventType}':`, error);
                }
            }
        }
        
        // Handle wildcard listeners
        if (!event.propagationStopped) {
            for (const wildcardListener of this._wildcardListeners) {
                if (event.immediatePropagationStopped) break;
                
                if (this._matchesWildcard(eventType, wildcardListener.pattern)) {
                    try {
                        event.currentTarget = wildcardListener.options.target || null;
                        wildcardListener.handler(event);
                        handlerCount++;
                    } catch (error) {
                        console.error(`[EventBus] Error in wildcard listener:`, error);
                    }
                }
            }
        }
        
        if (this._options.debug && handlerCount === 0) {
            // Only warn for non-test events to reduce noise
            if (!eventType.includes('test') && !eventType.includes('once-event')) {
                console.log(`[EventBus] No listeners for event '${eventType}'`);
            }
        }
        
        return event;
    }
    
    /**
     * Get listener count for event type
     */
    listenerCount(eventType) {
        const regular = this._listeners.get(eventType)?.size || 0;
        const once = this._onceListeners.get(eventType)?.size || 0;
        return regular + once;
    }
    
    /**
     * Get all event types with listeners
     */
    eventTypes() {
        const types = new Set();
        for (const type of this._listeners.keys()) {
            types.add(type);
        }
        for (const type of this._onceListeners.keys()) {
            types.add(type);
        }
        return Array.from(types);
    }
    
    // Private methods
    
    _createUnsubscriber(type, eventType, listenerData) {
        return () => {
            if (type === 'regular') {
                const listeners = this._listeners.get(eventType);
                if (listeners) {
                    listeners.delete(listenerData);
                    if (listeners.size === 0) {
                        this._listeners.delete(eventType);
                    }
                }
            } else if (type === 'once') {
                const onceListeners = this._onceListeners.get(eventType);
                if (onceListeners) {
                    onceListeners.delete(listenerData);
                    if (onceListeners.size === 0) {
                        this._onceListeners.delete(eventType);
                    }
                }
            } else if (type === 'wildcard') {
                this._wildcardListeners.delete(listenerData);
            }
        };
    }
    
    _matchesWildcard(eventType, pattern) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(eventType);
    }
}

/**
 * Global event bus instance
 */
export const globalEventBus = new EventBus({ debug: CONFIG.DEBUG });

/**
 * Framework event helpers
 */
export const FrameworkEvents = {
    // Component events
    COMPONENT_MOUNTED: 'framework:component:mounted',
    COMPONENT_UPDATED: 'framework:component:updated',
    COMPONENT_UNMOUNTED: 'framework:component:unmounted',
    
    // State events
    STATE_CHANGED: 'framework:state:changed',
    STATE_MUTATION: 'framework:state:mutation',
    STATE_ACTION: 'framework:state:action',
    
    // Router events
    ROUTE_CHANGED: 'framework:route:changed',
    ROUTE_BEFORE_CHANGE: 'framework:route:before-change',
    ROUTE_ERROR: 'framework:route:error',
    
    // Application events
    APP_READY: 'framework:app:ready',
    APP_ERROR: 'framework:app:error'
};

/**
 * Event delegation helper
 */
export class EventDelegate {
    constructor(container) {
        this.container = isString(container) 
            ? document.querySelector(container) 
            : container;
        this._delegates = new Map();
        this._setupDelegation();
    }
    
    /**
     * Add delegated event listener
     */
    on(selector, eventType, handler) {
        if (!this._delegates.has(eventType)) {
            this._delegates.set(eventType, new Map());
        }
        
        const eventDelegates = this._delegates.get(eventType);
        if (!eventDelegates.has(selector)) {
            eventDelegates.set(selector, new Set());
        }
        
        eventDelegates.get(selector).add(handler);
    }
    
    /**
     * Remove delegated event listener
     */
    off(selector, eventType, handler) {
        const eventDelegates = this._delegates.get(eventType);
        if (eventDelegates) {
            const selectorHandlers = eventDelegates.get(selector);
            if (selectorHandlers) {
                selectorHandlers.delete(handler);
                if (selectorHandlers.size === 0) {
                    eventDelegates.delete(selector);
                }
            }
        }
    }
    
    _setupDelegation() {
        // Set up delegation for common events
        const commonEvents = ['click', 'change', 'input', 'submit', 'keydown', 'keyup'];
        
        commonEvents.forEach(eventType => {
            this.container.addEventListener(eventType, (e) => {
                const eventDelegates = this._delegates.get(eventType);
                if (!eventDelegates) return;
                
                for (const [selector, handlers] of eventDelegates) {
                    if (e.target.matches(selector) || e.target.closest(selector)) {
                        for (const handler of handlers) {
                            handler(e);
                        }
                    }
                }
            });
        });
    }
    
    destroy() {
        this._delegates.clear();
    }
}

/**
 * Simple event emitter for components
 */
export class EventEmitter {
    constructor() {
        this._events = new Map();
    }
    
    on(event, handler) {
        if (!this._events.has(event)) {
            this._events.set(event, new Set());
        }
        this._events.get(event).add(handler);
        
        return () => this._events.get(event)?.delete(handler);
    }
    
    emit(event, ...args) {
        const handlers = this._events.get(event);
        if (handlers) {
            handlers.forEach(handler => handler(...args));
        }
    }
    
    off(event, handler) {
        if (handler) {
            this._events.get(event)?.delete(handler);
        } else {
            this._events.delete(event);
        }
    }
    
    destroy() {
        this._events.clear();
    }
}
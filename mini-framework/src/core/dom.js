// src/core/dom.js
// DOM abstraction and Virtual DOM implementation

import { isArray, isObject, isString, isFunction } from '../utils/helpers.js';
import { ELEMENT_TYPES } from '../utils/constants.js';

/**
 * Create a virtual DOM element
 */
export function h(tag, attrs = {}, children = []) {
    // Handle different argument patterns
    if (isArray(attrs)) {
        children = attrs;
        attrs = {};
    }
    
    // Normalize children to always be an array
    if (!isArray(children)) {
        children = children === null || children === undefined ? [] : [children];
    }
    
    // Flatten nested arrays of children
    children = children.flat(Infinity).filter(child => 
        child !== null && child !== undefined && child !== false
    );
    
    return {
        tag,
        attrs: attrs || {},
        children: children.map(child => 
            isString(child) || typeof child === 'number' 
                ? createTextNode(child.toString())
                : child
        ),
        key: attrs?.key || null,
        _domNode: null // Reference to actual DOM node
    };
}

/**
 * Create a text node virtual element
 */
export function createTextNode(text) {
    return {
        tag: ELEMENT_TYPES.TEXT,
        attrs: {},
        children: [],
        text: text,
        _domNode: null
    };
}

/**
 * Render virtual DOM to real DOM
 */
export function render(vnode, container) {
    if (isString(container)) {
        container = document.querySelector(container);
    }
    
    if (!container) {
        throw new Error('Container element not found');
    }
    
    // Clear container
    container.innerHTML = '';
    
    // Create and append the DOM tree
    const domNode = createDOMNode(vnode);
    container.appendChild(domNode);
    
    return domNode;
}

/**
 * Create actual DOM node from virtual node
 */
function createDOMNode(vnode) {
    if (!vnode) return document.createTextNode('');
    
    // Handle text nodes
    if (vnode.tag === ELEMENT_TYPES.TEXT) {
        const textNode = document.createTextNode(vnode.text || '');
        vnode._domNode = textNode;
        return textNode;
    }
    
    try {
        // Create element
        const element = document.createElement(vnode.tag);
        vnode._domNode = element;
        
        // Set attributes
        if (vnode.attrs && Object.keys(vnode.attrs).length > 0) {
            setAttributes(element, vnode.attrs);
        }
        
        // Add children
        if (vnode.children && vnode.children.length > 0) {
            vnode.children.forEach(child => {
                if (child) {
                    const childNode = createDOMNode(child);
                    if (childNode) {
                        element.appendChild(childNode);
                    }
                }
            });
        }
        
        return element;
    } catch (error) {
        console.error('Error creating DOM node for tag:', vnode.tag, error);
        return document.createTextNode(`[Error: ${vnode.tag}]`);
    }
}

/**
 * Set attributes on DOM element
 */
function setAttributes(element, attrs) {
    Object.keys(attrs).forEach(key => {
        const value = attrs[key];
        
        if (key === 'className' || key === 'class') {
            element.className = value;
        } else if (key === 'style' && isObject(value)) {
            Object.assign(element.style, value);
        } else if (key.startsWith('on') && isFunction(value)) {
            // Event handlers - IMPORTANT: Remove old listeners first
            const eventName = key.slice(2).toLowerCase();
            
            // Remove existing listener if it exists
            if (element._eventListeners && element._eventListeners[eventName]) {
                element.removeEventListener(eventName, element._eventListeners[eventName]);
            }
            
            // Store reference to new listener
            if (!element._eventListeners) {
                element._eventListeners = {};
            }
            element._eventListeners[eventName] = value;
            
            // Add new listener
            element.addEventListener(eventName, value);
        } else if (key === 'checked' || key === 'selected' || key === 'disabled') {
            // Boolean attributes
            element[key] = value;
        } else if (key !== 'key') {
            // Regular attributes (skip 'key' as it's for diffing)
            element.setAttribute(key, value);
        }
    });
}

/**
 * Update existing DOM node with new virtual node
 */
export function updateElement(container, newVNode, oldVNode, index = 0) {
    // Ensure container exists
    if (!container) return;
    
    // Remove node
    if (!newVNode && oldVNode) {
        const childToRemove = container.childNodes[index];
        if (childToRemove && childToRemove.parentNode === container) {
            container.removeChild(childToRemove);
        }
        return;
    }
    
    // Add node
    if (newVNode && !oldVNode) {
        const newNode = createDOMNode(newVNode);
        if (newNode) {
            container.appendChild(newNode);
        }
        return;
    }
    
    // Both nodes exist - check if they need updating
    if (!newVNode || !oldVNode) return;
    
    // Replace node if different
    if (hasChanged(newVNode, oldVNode)) {
        const existingChild = container.childNodes[index];
        const newNode = createDOMNode(newVNode);
        
        if (existingChild && newNode) {
            container.replaceChild(newNode, existingChild);
        } else if (newNode) {
            container.appendChild(newNode);
        }
        return;
    }
    
    // Update existing node
    if (newVNode.tag !== ELEMENT_TYPES.TEXT) {
        const currentChild = container.childNodes[index];
        
        if (currentChild) {
            // Update attributes
            updateAttributes(currentChild, newVNode.attrs, oldVNode.attrs);
            
            // Update children recursively
            const maxLength = Math.max(
                newVNode.children.length,
                oldVNode.children.length
            );
            
            for (let i = 0; i < maxLength; i++) {
                updateElement(
                    currentChild,
                    newVNode.children[i],
                    oldVNode.children[i],
                    i
                );
            }
        }
    }
}

/**
 * Check if virtual nodes have changed
 */
function hasChanged(node1, node2) {
    return (
        typeof node1 !== typeof node2 ||
        node1.tag !== node2.tag ||
        (node1.tag === ELEMENT_TYPES.TEXT && node1.text !== node2.text) ||
        node1.key !== node2.key
    );
}

/**
 * Update attributes on existing DOM element
 */
function updateAttributes(element, newAttrs, oldAttrs) {
    const allKeys = new Set([
        ...Object.keys(newAttrs || {}),
        ...Object.keys(oldAttrs || {})
    ]);
    
    allKeys.forEach(key => {
        const newValue = newAttrs?.[key];
        const oldValue = oldAttrs?.[key];
        
        if (newValue !== oldValue) {
            if (newValue === null || newValue === undefined) {
                // Remove attribute
                if (key === 'className' || key === 'class') {
                    element.className = '';
                } else if (key.startsWith('on')) {
                    // Remove event listener
                    const eventName = key.slice(2).toLowerCase();
                    if (element._eventListeners && element._eventListeners[eventName]) {
                        element.removeEventListener(eventName, element._eventListeners[eventName]);
                        delete element._eventListeners[eventName];
                    }
                } else {
                    element.removeAttribute(key);
                }
            } else {
                // Set/update attribute - use our fixed setAttributes function
                setAttributes(element, { [key]: newValue });
            }
        }
    });
}

/**
 * Query virtual DOM (for debugging/testing)
 */
export function querySelector(vnode, selector) {
    if (!vnode || vnode.tag === ELEMENT_TYPES.TEXT) return null;
    
    // Simple selector matching (can be enhanced)
    if (selector.startsWith('#') && vnode.attrs.id === selector.slice(1)) {
        return vnode;
    }
    
    if (selector.startsWith('.') && vnode.attrs.class?.includes(selector.slice(1))) {
        return vnode;
    }
    
    if (vnode.tag === selector) {
        return vnode;
    }
    
    // Search children
    for (const child of vnode.children) {
        const found = querySelector(child, selector);
        if (found) return found;
    }
    
    return null;
}

/**
 * Get DOM node from virtual node
 */
export function getDOMNode(vnode) {
    return vnode?._domNode || null;
}

/**
 * Mount virtual DOM to container with update capability
 */
// In mini-framework/src/core/dom.js
export class DOMRenderer {
    constructor(container) {
        this.container = isString(container) 
            ? document.querySelector(container)
            : container;
        this.currentVNode = null;
        
        if (!this.container) {
            throw new Error('DOMRenderer: Container not found');
        }
    }
    
    render(vnode) {
        try {
            if (!vnode) {
                console.warn('DOMRenderer: Attempted to render null/undefined vnode');
                return this;
            }
            
            if (!this.currentVNode) {
                // Initial render - only clear on first render
                this.container.innerHTML = '';
                const domNode = createDOMNode(vnode);
                if (domNode) {
                    this.container.appendChild(domNode);
                }
            } else {
                // Use proper diffing instead of full rebuild
                updateElement(this.container, vnode, this.currentVNode, 0);
            }
            
            this.currentVNode = vnode;
        } catch (error) {
            console.error('DOMRenderer: Render error:', error);
            // Only fallback to full rebuild on error
            try {
                this.container.innerHTML = '';
                const fallbackNode = createDOMNode(vnode);
                if (fallbackNode) {
                    this.container.appendChild(fallbackNode);
                }
                this.currentVNode = vnode;
            } catch (fallbackError) {
                console.error('DOMRenderer: Fallback render failed:', fallbackError);
            }
        }
        
        return this;
    }
    
    clear() {
        try {
            this.container.innerHTML = '';
            this.currentVNode = null;
        } catch (error) {
            console.error('DOMRenderer: Clear error:', error);
        }
        return this;
    }
}
// src/utils/helpers.js
// Essential utility functions for the framework

/**
 * Type checking utilities
 */
export const isArray = (value) => Array.isArray(value);
export const isObject = (value) => value !== null && typeof value === 'object' && !isArray(value);
export const isFunction = (value) => typeof value === 'function';
export const isString = (value) => typeof value === 'string';
export const isNumber = (value) => typeof value === 'number' && !isNaN(value);
export const isBoolean = (value) => typeof value === 'boolean';
export const isDefined = (value) => value !== undefined && value !== null;

/**
 * Object manipulation utilities
 */
export const clone = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (isArray(obj)) return obj.map(clone);
    if (isObject(obj)) {
        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = clone(obj[key]);
            }
        }
        return cloned;
    }
    return obj;
};

export const merge = (target, ...sources) => {
    if (!isObject(target)) return target;
    
    sources.forEach(source => {
        if (isObject(source)) {
            Object.keys(source).forEach(key => {
                if (isObject(source[key]) && isObject(target[key])) {
                    target[key] = merge(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            });
        }
    });
    
    return target;
};

/**
 * Array utilities
 */
// REMOVED: unique() and flatten() - no references found in codebase

/**
 * String utilities
 */
// REMOVED: camelCase() and kebabCase() - no references found in codebase

/**
 * ID generation
 */
let idCounter = 0;
export const generateId = (prefix = 'id') => {
    return `${prefix}_${++idCounter}_${Date.now()}`;
};

/**
 * DOM utilities (basic)
 */
export const createElement = (tag, attrs = {}, children = []) => {
    return {
        tag,
        attrs: { ...attrs },
        children: isArray(children) ? children : [children]
    };
};

/**
 * Performance utilities
 */
export const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

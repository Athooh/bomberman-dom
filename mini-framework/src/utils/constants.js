// src/utils/constants.js
// Framework constants and configuration

export const FRAMEWORK_NAME = 'MiniFramework';
export const VERSION = '1.0.0';

// DOM constants
export const DOM_EVENTS = {
    CLICK: 'click',
    CHANGE: 'change',
    INPUT: 'input',
    KEYDOWN: 'keydown',
    KEYUP: 'keyup',
    SUBMIT: 'submit',
    FOCUS: 'focus',
    BLUR: 'blur'
};

export const ELEMENT_TYPES = {
    TEXT: '#text',
    COMMENT: '#comment',
    FRAGMENT: '#fragment'
};

// State constants
export const STATE_EVENTS = {
    CHANGE: 'state:change',
    INIT: 'state:init',
    UPDATE: 'state:update'
};

// Router constants
export const ROUTER_EVENTS = {
    NAVIGATE: 'router:navigate',
    CHANGE: 'router:change',
    BEFORE_CHANGE: 'router:before-change',
    ERROR: 'router:error'
};

export const DEFAULT_ROUTE = '/';

// Navigation modes
export const ROUTER_MODES = {
    HASH: 'hash',
    HISTORY: 'history'
};

// Framework configuration
export const CONFIG = {
    DEBUG: false,  // Set to false to reduce warnings
    AUTO_RENDER: true,
    BATCH_UPDATES: true,
    STRICT_MODE: true
};

// Error messages
export const ERRORS = {
    INVALID_ELEMENT: 'Invalid element provided',
    INVALID_STATE: 'Invalid state object',
    ROUTE_NOT_FOUND: 'Route not found',
    MISSING_CONTAINER: 'Container element not found'
};
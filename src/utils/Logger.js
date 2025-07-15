// src/utils/Logger.js
// Centralized logging system for debugging and monitoring

import { DEBUG_CONFIG } from './Constants.js';

/**
 * Logger class for consistent logging across the application
 */
export class Logger {
    constructor(module = 'App') {
        this.module = module;
        this.enabled = DEBUG_CONFIG.ENABLED;
        this.logLevel = this.getLogLevel();
    }
    
    /**
     * Get current log level based on environment
     */
    getLogLevel() {
        if (typeof window !== 'undefined' && window.location.search.includes('debug=verbose')) {
            return 0; // VERBOSE
        }
        if (DEBUG_CONFIG.ENABLED) {
            return 1; // DEBUG
        }
        return 2; // INFO
    }
    
    /**
     * Format log message with timestamp and module
     */
    formatMessage(level, message, ...args) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const moduleTag = `[${this.module}]`;
        const levelTag = `[${level}]`;
        
        return [`${timestamp} ${levelTag} ${moduleTag} ${message}`, ...args];
    }
    
    /**
     * Verbose logging (level 0)
     */
    verbose(message, ...args) {
        if (!this.enabled || this.logLevel > 0) return;
        console.log(...this.formatMessage('VERBOSE', message, ...args));
    }
    
    /**
     * Debug logging (level 1)
     */
    debug(message, ...args) {
        if (!this.enabled || this.logLevel > 1) return;
        console.log(...this.formatMessage('DEBUG', message, ...args));
    }
    
    /**
     * Info logging (level 2)
     */
    info(message, ...args) {
        if (!this.enabled || this.logLevel > 2) return;
        console.info(...this.formatMessage('INFO', message, ...args));
    }
    
    /**
     * Warning logging (always shown)
     */
    warn(message, ...args) {
        console.warn(...this.formatMessage('WARN', message, ...args));
    }
    
    /**
     * Error logging (always shown)
     */
    error(message, ...args) {
        console.error(...this.formatMessage('ERROR', message, ...args));
    }
    
    /**
     * Performance logging (configurable)
     */
    perf(operation, duration, ...args) {
        if (!DEBUG_CONFIG.LOG_PERFORMANCE && !DEBUG_CONFIG.ENABLE_PERFORMANCE_LOGGING) return;

        const level = duration > 16 ? 'WARN' : 'PERF';
        const method = duration > 16 ? console.warn : console.log;

        method(...this.formatMessage(level, `⏱️ ${operation}: ${duration.toFixed(2)}ms`, ...args));
    }
    
    /**
     * Network logging
     */
    network(direction, type, data) {
        if (!DEBUG_CONFIG.LOG_NETWORK) return;
        
        const arrow = direction === 'sent' ? '→' : '←';
        console.log(...this.formatMessage('NET', `${arrow} ${type}`, data));
    }
    
    /**
     * Game event logging (configurable)
     */
    gameEvent(event, data) {
        if (!DEBUG_CONFIG.LOG_GAME_EVENTS) return;

        console.log(...this.formatMessage('GAME', `🎮 ${event}`, data));
    }
    
    /**
     * Group logging for complex operations
     */
    group(label) {
        if (!this.enabled || this.logLevel > 1) return;
        console.group(`[${this.module}] ${label}`);
    }
    
    groupEnd() {
        if (!this.enabled || this.logLevel > 1) return;
        console.groupEnd();
    }
    
    /**
     * Time logging for performance measurement
     */
    time(label) {
        if (!this.enabled || this.logLevel > 1) return;
        console.time(`[${this.module}] ${label}`);
    }
    
    timeEnd(label) {
        if (!this.enabled || this.logLevel > 1) return;
        console.timeEnd(`[${this.module}] ${label}`);
    }
    
    /**
     * Table logging for structured data
     */
    table(data, columns) {
        if (!this.enabled || this.logLevel > 1) return;
        console.table(data, columns);
    }
    
    /**
     * Assert logging
     */
    assert(condition, message, ...args) {
        if (!condition) {
            this.error(`Assertion failed: ${message}`, ...args);
        }
    }
    
    /**
     * Create a child logger with additional context
     */
    child(subModule) {
        return new Logger(`${this.module}:${subModule}`);
    }
}

// Global logger instance
export const globalLogger = new Logger('Global');

// Export default logger
export default Logger;
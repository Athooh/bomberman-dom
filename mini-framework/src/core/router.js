// src/core/router.js
// Client-side Router - URL-based navigation without page reloads

import { isString, isFunction, isObject } from '../utils/helpers.js';
import { ROUTER_EVENTS, DEFAULT_ROUTE } from '../utils/constants.js';
import { globalEventBus, FrameworkEvents } from './events.js';

/**
 * Route class - represents a single route
 */
class Route {
    constructor(path, handler, options = {}) {
        this.path = path;
        this.handler = handler;
        this.name = options.name || null;
        this.meta = options.meta || {};
        this.beforeEnter = options.beforeEnter || null;
        this.children = options.children || [];
        
        // Convert path to regex for matching
        this.regex = this._pathToRegex(path);
        this.paramNames = this._extractParamNames(path);
    }
    
    /**
     * Check if current path matches this route
     */
    matches(path) {
        return this.regex.test(path);
    }
    
    /**
     * Extract parameters from path
     */
    extractParams(path) {
        const match = path.match(this.regex);
        if (!match) return {};
        
        const params = {};
        this.paramNames.forEach((name, index) => {
            params[name] = match[index + 1];
        });
        
        return params;
    }
    
    // Private methods
    _pathToRegex(path) {
        // Convert /user/:id/edit to regex
        const regexPath = path
            .replace(/:[^\/]+/g, '([^/]+)')  // :id becomes ([^/]+)
            .replace(/\*/g, '.*')           // * becomes .*
            .replace(/\/$/, '');           // remove trailing slash
        
        return new RegExp(`^${regexPath}/?$`);
    }
    
    _extractParamNames(path) {
        const params = [];
        const matches = path.match(/:([^\/]+)/g);
        if (matches) {
            matches.forEach(match => {
                params.push(match.slice(1)); // Remove the ':'
            });
        }
        return params;
    }
}

/**
 * Router class - handles navigation and routing
 */
export class Router {
    constructor(options = {}) {
        this.routes = [];
        this.currentRoute = null;
        this.currentPath = '';
        this.params = {};
        this.query = {};
        
        this.options = {
            mode: options.mode || 'hash',  // 'hash' or 'history'
            base: options.base || '',
            hashbang: options.hashbang || false,
            linkActiveClass: options.linkActiveClass || 'router-link-active',
            ...options
        };
        
        this.beforeHooks = [];
        this.afterHooks = [];
        this._isStarted = false;
        
        // Bind methods
        this._onPopState = this._onPopState.bind(this);
        this._onHashChange = this._onHashChange.bind(this);
        
        console.log('[Router] Created with options:', this.options);
    }
    
    /**
     * Add route
     */
    addRoute(path, handler, options = {}) {
        if (isObject(path)) {
            // Route object format: { path, handler, name, meta, etc. }
            const routeConfig = path;
            const route = new Route(
                routeConfig.path,
                routeConfig.handler || routeConfig.component,
                routeConfig
            );
            this.routes.push(route);
        } else {
            // Simple format: addRoute('/path', handler, options)
            const route = new Route(path, handler, options);
            this.routes.push(route);
        }
        
        return this;
    }
    
    /**
     * Add multiple routes
     */
    addRoutes(routes) {
        routes.forEach(route => {
            if (isObject(route)) {
                this.addRoute(route);
            }
        });
        return this;
    }
    
    /**
     * Navigate to path
     */
    push(path, state = {}) {
        if (this.currentPath === path) return;
        
        this._navigate(path, state, 'push');
    }
    
    /**
     * Replace current route
     */
    replace(path, state = {}) {
        this._navigate(path, state, 'replace');
    }
    
    /**
     * Go back in history
     */
    back() {
        if (typeof window !== 'undefined') {
            window.history.back();
        }
    }
    
    /**
     * Go forward in history
     */
    forward() {
        if (typeof window !== 'undefined') {
            window.history.forward();
        }
    }
    
    /**
     * Go to specific history entry
     */
    go(delta) {
        if (typeof window !== 'undefined') {
            window.history.go(delta);
        }
    }
    
    /**
     * Start the router
     */
    start() {
        if (this._isStarted) return;
        this._isStarted = true;
        
        if (typeof window === 'undefined') return;
        
        // Set up event listeners
        if (this.options.mode === 'history') {
            window.addEventListener('popstate', this._onPopState);
        } else {
            window.addEventListener('hashchange', this._onHashChange);
        }
        
        // Handle initial route
        const initialPath = this._getCurrentPath();
        this._navigate(initialPath, {}, 'replace', true);
        
        console.log('[Router] Started in', this.options.mode, 'mode');
    }
    
    /**
     * Stop the router
     */
    stop() {
        if (!this._isStarted) return;
        this._isStarted = false;
        
        if (typeof window === 'undefined') return;
        
        // Remove event listeners
        if (this.options.mode === 'history') {
            window.removeEventListener('popstate', this._onPopState);
        } else {
            window.removeEventListener('hashchange', this._onHashChange);
        }
        
        console.log('[Router] Stopped');
    }
    
    /**
     * Add navigation guard (before)
     */
    beforeEach(guard) {
        this.beforeHooks.push(guard);
    }
    
    /**
     * Add navigation hook (after)
     */
    afterEach(hook) {
        this.afterHooks.push(hook);
    }
    
    /**
     * Resolve route by path
     */
    resolve(path) {
        const { pathname, query } = this._parsePath(path);
        
        for (const route of this.routes) {
            if (route.matches(pathname)) {
                return {
                    route,
                    path: pathname,
                    params: route.extractParams(pathname),
                    query,
                    matched: [route]
                };
            }
        }
        
        return null;
    }
    
    /**
     * Generate URL for named route
     */
    url(name, params = {}, query = {}) {
        const route = this.routes.find(r => r.name === name);
        if (!route) {
            console.warn(`[Router] Route with name '${name}' not found`);
            return '/';
        }
        
        let path = route.path;
        
        // Replace parameters
        Object.keys(params).forEach(key => {
            path = path.replace(`:${key}`, params[key]);
        });
        
        // Add query parameters
        const queryString = this._buildQueryString(query);
        if (queryString) {
            path += '?' + queryString;
        }
        
        return path;
    }
    
    // Private methods
    
    async _navigate(path, state = {}, action = 'push', initial = false) {
        const { pathname, query } = this._parsePath(path);
        
        // Resolve route
        const resolved = this.resolve(path);
        if (!resolved) {
            console.warn(`[Router] No route found for path: ${path}`);
            globalEventBus.emit(FrameworkEvents.ROUTE_ERROR, { path, error: 'Route not found' });
            return;
        }
        
        const { route, params } = resolved;
        
        // Create route context
        const to = {
            path: pathname,
            params,
            query,
            route,
            name: route.name,
            meta: route.meta
        };
        
        const from = {
            path: this.currentPath,
            params: this.params,
            query: this.query,
            route: this.currentRoute,
            name: this.currentRoute?.name,
            meta: this.currentRoute?.meta || {}
        };
        
        // Run before hooks
        if (!initial) {
            const canNavigate = await this._runBeforeHooks(to, from);
            if (!canNavigate) {
                console.log('[Router] Navigation cancelled by guard');
                return;
            }
        }
        
        // Emit before change event
        globalEventBus.emit(FrameworkEvents.ROUTE_BEFORE_CHANGE, { to, from });
        
        // Update URL
        if (!initial) {
            this._updateURL(path, state, action);
        }
        
        // Update current route info
        this.currentRoute = route;
        this.currentPath = pathname;
        this.params = params;
        this.query = query;
        
        // Execute route handler
        try {
            if (isFunction(route.handler)) {
                await route.handler(to, from);
            }
        } catch (error) {
            console.error('[Router] Error in route handler:', error);
            globalEventBus.emit(FrameworkEvents.ROUTE_ERROR, { path, error });
        }
        
        // Emit route changed event
        globalEventBus.emit(FrameworkEvents.ROUTE_CHANGED, { to, from });
        
        // Run after hooks
        this._runAfterHooks(to, from);
        
        // Update active links
        this._updateActiveLinks();
        
        console.log(`[Router] Navigated to: ${path}`, { params, query });
    }
    
    async _runBeforeHooks(to, from) {
        for (const hook of this.beforeHooks) {
            try {
                const result = await hook(to, from);
                if (result === false) {
                    return false;
                }
            } catch (error) {
                console.error('[Router] Error in before hook:', error);
                return false;
            }
        }
        
        // Run route-specific beforeEnter
        if (to.route.beforeEnter) {
            try {
                const result = await to.route.beforeEnter(to, from);
                if (result === false) {
                    return false;
                }
            } catch (error) {
                console.error('[Router] Error in route beforeEnter:', error);
                return false;
            }
        }
        
        return true;
    }
    
    _runAfterHooks(to, from) {
        this.afterHooks.forEach(hook => {
            try {
                hook(to, from);
            } catch (error) {
                console.error('[Router] Error in after hook:', error);
            }
        });
    }
    
    _updateURL(path, state, action) {
        if (typeof window === 'undefined') return;
        
        if (this.options.mode === 'history') {
            const url = this.options.base + path;
            if (action === 'push') {
                window.history.pushState(state, '', url);
            } else {
                window.history.replaceState(state, '', url);
            }
        } else {
            const hash = this.options.hashbang ? '#!' + path : '#' + path;
            if (action === 'push') {
                window.location.hash = hash;
            } else {
                window.location.replace(window.location.pathname + window.location.search + hash);
            }
        }
    }
    
    _getCurrentPath() {
        if (typeof window === 'undefined') return '/';
        
        if (this.options.mode === 'history') {
            const path = window.location.pathname + window.location.search;
            return path.replace(new RegExp('^' + this.options.base), '') || '/';
        } else {
            const hash = window.location.hash;
            if (this.options.hashbang) {
                return hash.replace(/^#!/, '') || '/';
            } else {
                return hash.replace(/^#/, '') || '/';
            }
        }
    }
    
    _parsePath(path) {
        const [pathname, search] = path.split('?');
        const query = this._parseQuery(search || '');
        return { pathname, query };
    }
    
    _parseQuery(search) {
        const query = {};
        if (search) {
            search.split('&').forEach(pair => {
                const [key, value] = pair.split('=');
                if (key) {
                    query[decodeURIComponent(key)] = decodeURIComponent(value || '');
                }
            });
        }
        return query;
    }
    
    _buildQueryString(query) {
        const params = [];
        Object.keys(query).forEach(key => {
            if (query[key] !== null && query[key] !== undefined) {
                params.push(`${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`);
            }
        });
        return params.join('&');
    }
    
    _updateActiveLinks() {
        if (typeof document === 'undefined') return;
        
        const links = document.querySelectorAll('[router-link]');
        links.forEach(link => {
            const href = link.getAttribute('router-link');
            const isActive = this.currentPath === href || 
                           (href !== '/' && this.currentPath.startsWith(href));
            
            if (isActive) {
                link.classList.add(this.options.linkActiveClass);
            } else {
                link.classList.remove(this.options.linkActiveClass);
            }
        });
    }
    
    _onPopState(event) {
        const path = this._getCurrentPath();
        this._navigate(path, event.state || {}, 'replace');
    }
    
    _onHashChange(event) {
        const path = this._getCurrentPath();
        this._navigate(path, {}, 'replace');
    }
}

/**
 * Create router instance
 */
export function createRouter(options = {}) {
    return new Router(options);
}

/**
 * Router link helper
 */
export function createRouterLink(router) {
    return function RouterLink(to, options = {}) {
        const href = isString(to) ? to : router.url(to.name, to.params, to.query);
        const tag = options.tag || 'a';
        const text = options.text || href;
        
        const element = document.createElement(tag);
        element.setAttribute('router-link', href);
        element.textContent = text;
        
        if (tag === 'a') {
            element.href = href;
            element.addEventListener('click', (e) => {
                e.preventDefault();
                router.push(href);
            });
        }
        
        return element;
    };
}
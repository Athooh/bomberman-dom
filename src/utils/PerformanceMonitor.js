// src/utils/PerformanceMonitor.js
// Comprehensive performance monitoring for 60+ FPS gameplay

import { Logger } from './Logger.js';

/**
 * Enhanced Performance Monitor with Dynamic Quality Scaling
 * Real-time monitoring with automatic quality adjustment for stable 60+ FPS
 * Implements emergency optimization modes and performance budgeting
 */
export class PerformanceMonitor {
    constructor() {
        this.logger = new Logger('PerformanceMonitor');

        // Performance tracking
        this.fps = 60;
        this.frameTime = 16.67;
        this.targetFPS = 60;
        this.targetFrameTime = 16.67;

        // Frame timing
        this.frameCount = 0;
        this.lastFrameTime = performance.now();
        this.frameHistory = [];
        this.maxFrameHistory = 120; // Track last 2 seconds at 60fps

        //  Real-time performance tracking
        this.realTimeTracking = {
            enabled: true,
            sampleWindow: 1000, // 1 second window
            samples: [],
            maxSamples: 60,
            currentAverage: 60,
            trend: 'stable' // 'improving', 'degrading', 'stable'
        };
        
        // Performance metrics
        this.metrics = {
            averageFPS: 60,
            minFPS: 60,
            maxFPS: 60,
            frameDrops: 0,
            totalFrames: 0,
            worstFrameTime: 0,
            averageFrameTime: 16.67,
            performanceScore: 100
        };
        
        //  Enhanced optimization settings with dynamic scaling
        this.optimizationLevel = 'auto';
        this.adaptiveOptimization = true;
        this.optimizationThresholds = {
            excellent: 58,  // Above 58 FPS - increase quality
            good: 55,       // Above 55 FPS - maintain quality
            acceptable: 50, // Above 50 FPS - slight reduction
            poor: 45,       // Above 45 FPS - reduce quality
            critical: 40,   // Above 40 FPS - aggressive reduction
            emergency: 30   // Below 30 FPS - emergency mode
        };

        //  Dynamic quality scaling system
        this.qualityScaling = {
            enabled: true,
            currentLevel: 'high',
            levels: {
                ultra: { renderScale: 1.0, effectsScale: 1.0, particleScale: 1.0 },
                high: { renderScale: 1.0, effectsScale: 0.9, particleScale: 0.9 },
                medium: { renderScale: 0.9, effectsScale: 0.7, particleScale: 0.7 },
                low: { renderScale: 0.8, effectsScale: 0.5, particleScale: 0.5 },
                minimal: { renderScale: 0.7, effectsScale: 0.3, particleScale: 0.3 }
            },
            adjustmentCooldown: 2000, // 2 seconds between adjustments
            lastAdjustment: 0
        };

        //  Emergency optimization mode
        this.emergencyMode = {
            active: false,
            activationThreshold: 30, // FPS threshold
            duration: 5000, // 5 seconds
            activatedAt: 0,
            settings: {
                disableEffects: true,
                reduceParticles: true,
                simplifyRendering: true,
                skipNonCriticalUpdates: true
            }
        };

        // Auto-adjustment settings
        this.autoAdjustments = {
            renderQuality: 'high',
            particleCount: 'high',
            shadowQuality: 'high',
            effectsEnabled: true,
            gpuAcceleration: true,
            dynamicQuality: true
        };
        
        // Monitoring state
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.reportInterval = 5000; // Report every 5 seconds
        
        // Performance alerts
        this.alerts = {
            enabled: true,
            frameDropThreshold: 5, // Alert after 5 consecutive frame drops
            consecutiveDrops: 0
        };

        // Worker performance tracking
        this.workerStats = {
            collision: {
                messagesProcessed: 0,
                averageProcessingTime: 0,
                errors: 0,
                utilization: 0,
                fallbackCount: 0,
                lastProcessingTime: 0
            },
            physics: {
                messagesProcessed: 0,
                averageProcessingTime: 0,
                errors: 0,
                utilization: 0,
                fallbackCount: 0,
                lastProcessingTime: 0
            },
            network: {
                messagesProcessed: 0,
                averageProcessingTime: 0,
                errors: 0,
                utilization: 0,
                fallbackCount: 0,
                compressionRatio: 1.0,
                lastProcessingTime: 0
            }
        };

        // Worker performance history
        this.workerHistory = {
            collision: [],
            physics: [],
            network: []
        };

        this.maxWorkerHistory = 60; // Keep last 60 samples per worker

        this.logger.info('Performance monitor initialized with worker tracking');
    }
    
    /**
     * Start performance monitoring
     */
    start() {
        if (this.isMonitoring) return;
        
        this.isMonitoring = true;
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        
        // Start monitoring interval
        this.monitoringInterval = setInterval(() => {
            this.generatePerformanceReport();
        }, this.reportInterval);
        
        this.logger.info('Performance monitoring started');
    }
    
    /**
     * Stop performance monitoring
     */
    stop() {
        if (!this.isMonitoring) return;
        
        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        this.logger.info('Performance monitoring stopped');
    }
    
    /**
     * Record frame timing with enhanced real-time tracking
     */
    recordFrame() {
        if (!this.isMonitoring) return;

        const currentTime = performance.now();
        const frameTime = currentTime - this.lastFrameTime;

        // Update frame timing
        this.frameTime = frameTime;
        this.fps = 1000 / frameTime;
        this.frameCount++;
        this.metrics.totalFrames++;

        //  Real-time performance tracking
        this.updateRealTimeTracking(this.fps, currentTime);

        // Add to frame history
        this.frameHistory.push({
            time: currentTime,
            frameTime: frameTime,
            fps: this.fps
        });

        // Limit history size
        if (this.frameHistory.length > this.maxFrameHistory) {
            this.frameHistory.shift();
        }

        // Update metrics
        this.updateMetrics(frameTime);

        // Check for frame drops
        this.checkFrameDrops(frameTime);

        //  Dynamic quality scaling
        this.updateDynamicQualityScaling(this.fps, currentTime);

        //  Emergency mode check
        this.checkEmergencyMode(this.fps, currentTime);

        // Auto-adjust optimization if enabled
        if (this.adaptiveOptimization) {
            this.autoAdjustOptimization();
        }

        this.lastFrameTime = currentTime;
    }

    /**
     *  Update real-time performance tracking
     */
    updateRealTimeTracking(fps, currentTime) {
        if (!this.realTimeTracking.enabled) return;

        // Add sample
        this.realTimeTracking.samples.push({
            fps: fps,
            time: currentTime
        });

        // Remove old samples outside window
        const windowStart = currentTime - this.realTimeTracking.sampleWindow;
        this.realTimeTracking.samples = this.realTimeTracking.samples.filter(
            sample => sample.time >= windowStart
        );

        // Limit sample count
        if (this.realTimeTracking.samples.length > this.realTimeTracking.maxSamples) {
            this.realTimeTracking.samples.shift();
        }

        // Calculate current average
        if (this.realTimeTracking.samples.length > 0) {
            const totalFPS = this.realTimeTracking.samples.reduce((sum, sample) => sum + sample.fps, 0);
            const newAverage = totalFPS / this.realTimeTracking.samples.length;

            // Determine trend
            const oldAverage = this.realTimeTracking.currentAverage;
            const difference = newAverage - oldAverage;

            if (Math.abs(difference) < 1) {
                this.realTimeTracking.trend = 'stable';
            } else if (difference > 0) {
                this.realTimeTracking.trend = 'improving';
            } else {
                this.realTimeTracking.trend = 'degrading';
            }

            this.realTimeTracking.currentAverage = newAverage;
        }
    }

    /**
     *  Dynamic quality scaling based on performance
     */
    updateDynamicQualityScaling(fps, currentTime) {
        if (!this.qualityScaling.enabled) return;

        // Check cooldown
        if (currentTime - this.qualityScaling.lastAdjustment < this.qualityScaling.adjustmentCooldown) {
            return;
        }

        const currentLevel = this.qualityScaling.currentLevel;
        let targetLevel = currentLevel;

        // Determine target quality level based on FPS
        if (fps >= this.optimizationThresholds.excellent) {
            targetLevel = 'ultra';
        } else if (fps >= this.optimizationThresholds.good) {
            targetLevel = 'high';
        } else if (fps >= this.optimizationThresholds.acceptable) {
            targetLevel = 'medium';
        } else if (fps >= this.optimizationThresholds.poor) {
            targetLevel = 'low';
        } else {
            targetLevel = 'minimal';
        }

        // Apply quality change if needed
        if (targetLevel !== currentLevel) {
            this.applyQualityLevel(targetLevel);
            this.qualityScaling.lastAdjustment = currentTime;

            this.logger.info(`Quality level changed: ${currentLevel} -> ${targetLevel} (FPS: ${fps.toFixed(1)})`);
        }
    }

    /**
     *  Apply quality level settings
     */
    applyQualityLevel(level) {
        if (!this.qualityScaling.levels[level]) return;

        this.qualityScaling.currentLevel = level;
        const settings = this.qualityScaling.levels[level];

        // Update auto-adjustments
        this.autoAdjustments.renderQuality = level;
        this.autoAdjustments.particleCount = level;
        this.autoAdjustments.shadowQuality = level;
        this.autoAdjustments.effectsEnabled = settings.effectsScale > 0.5;

        // Emit quality change event
        this.emitQualityChange(level, settings);
    }

    /**
     *  Check and manage emergency mode
     */
    checkEmergencyMode(fps, currentTime) {
        if (fps < this.emergencyMode.activationThreshold && !this.emergencyMode.active) {
            // Activate emergency mode
            this.activateEmergencyMode(currentTime);
        } else if (this.emergencyMode.active) {
            // Check if we should deactivate emergency mode
            const duration = currentTime - this.emergencyMode.activatedAt;

            if (duration > this.emergencyMode.duration && fps > this.emergencyMode.activationThreshold + 5) {
                this.deactivateEmergencyMode();
            }
        }
    }

    /**
     *  Activate emergency optimization mode
     */
    activateEmergencyMode(currentTime) {
        this.emergencyMode.active = true;
        this.emergencyMode.activatedAt = currentTime;

        this.logger.warn('Emergency optimization mode activated');

        // Apply emergency settings
        this.applyQualityLevel('minimal');

        // Emit emergency optimization event
        this.emitEmergencyOptimization();
    }

    /**
     *  Deactivate emergency mode
     */
    deactivateEmergencyMode() {
        this.emergencyMode.active = false;

        this.logger.info('Emergency optimization mode deactivated');

        // Return to normal quality scaling
        this.qualityScaling.lastAdjustment = 0; // Allow immediate adjustment
    }
    
    /**
     * Update performance metrics
     */
    updateMetrics(frameTime) {
        // Update FPS metrics
        this.metrics.minFPS = Math.min(this.metrics.minFPS, this.fps);
        this.metrics.maxFPS = Math.max(this.metrics.maxFPS, this.fps);
        
        // Update frame time metrics
        this.metrics.worstFrameTime = Math.max(this.metrics.worstFrameTime, frameTime);
        
        // Calculate averages from frame history
        if (this.frameHistory.length > 0) {
            const totalFPS = this.frameHistory.reduce((sum, frame) => sum + frame.fps, 0);
            const totalFrameTime = this.frameHistory.reduce((sum, frame) => sum + frame.frameTime, 0);
            
            this.metrics.averageFPS = totalFPS / this.frameHistory.length;
            this.metrics.averageFrameTime = totalFrameTime / this.frameHistory.length;
        }
        
        // Calculate performance score (0-100)
        this.metrics.performanceScore = Math.min(100, (this.metrics.averageFPS / this.targetFPS) * 100);
    }
    
    /**
     * Check for frame drops and handle alerts
     */
    checkFrameDrops(frameTime) {
        const isFrameDrop = frameTime > this.targetFrameTime * 1.5; // 50% over target
        
        if (isFrameDrop) {
            this.metrics.frameDrops++;
            this.alerts.consecutiveDrops++;
            
            // Alert if threshold reached
            if (this.alerts.enabled && this.alerts.consecutiveDrops >= this.alerts.frameDropThreshold) {
                this.handlePerformanceAlert();
            }
        } else {
            this.alerts.consecutiveDrops = 0;
        }
    }
    
    /**
     * Handle performance alerts
     */
    handlePerformanceAlert() {
        this.logger.warn(`Performance alert: ${this.alerts.consecutiveDrops} consecutive frame drops`);
        this.logger.warn(`Current FPS: ${this.fps.toFixed(1)}, Frame time: ${this.frameTime.toFixed(2)}ms`);
        
        // Trigger aggressive optimization
        this.triggerEmergencyOptimization();
    }
    
    /**
     * Auto-adjust optimization based on performance
     */
    autoAdjustOptimization() {
        const currentFPS = this.metrics.averageFPS;
        
        if (currentFPS >= this.optimizationThresholds.excellent) {
            this.setOptimizationLevel('high');
        } else if (currentFPS >= this.optimizationThresholds.good) {
            this.setOptimizationLevel('medium');
        } else if (currentFPS >= this.optimizationThresholds.poor) {
            this.setOptimizationLevel('low');
        } else {
            this.setOptimizationLevel('minimal');
        }
    }
    
    /**
     * Set optimization level
     */
    setOptimizationLevel(level) {
        if (this.optimizationLevel === level) return;
        
        this.optimizationLevel = level;
        
        switch (level) {
            case 'high':
                this.autoAdjustments.renderQuality = 'high';
                this.autoAdjustments.particleCount = 'high';
                this.autoAdjustments.shadowQuality = 'high';
                this.autoAdjustments.effectsEnabled = true;
                break;
                
            case 'medium':
                this.autoAdjustments.renderQuality = 'medium';
                this.autoAdjustments.particleCount = 'medium';
                this.autoAdjustments.shadowQuality = 'medium';
                this.autoAdjustments.effectsEnabled = true;
                break;
                
            case 'low':
                this.autoAdjustments.renderQuality = 'low';
                this.autoAdjustments.particleCount = 'low';
                this.autoAdjustments.shadowQuality = 'low';
                this.autoAdjustments.effectsEnabled = false;
                break;
                
            case 'minimal':
                this.autoAdjustments.renderQuality = 'minimal';
                this.autoAdjustments.particleCount = 'minimal';
                this.autoAdjustments.shadowQuality = 'off';
                this.autoAdjustments.effectsEnabled = false;
                break;
        }
        
        this.logger.info(`Optimization level adjusted to: ${level}`);
        this.emitOptimizationChange(level);
    }
    
    /**
     * Trigger emergency optimization
     */
    triggerEmergencyOptimization() {
        this.logger.warn('Triggering emergency optimization');
        this.setOptimizationLevel('minimal');
        
        // Additional emergency measures
        this.autoAdjustments.gpuAcceleration = false;
        
        this.emitEmergencyOptimization();
    }
    
    /**
     * Generate performance report
     */
    generatePerformanceReport() {
        const report = {
            timestamp: Date.now(),
            fps: {
                current: this.fps.toFixed(1),
                average: this.metrics.averageFPS.toFixed(1),
                min: this.metrics.minFPS.toFixed(1),
                max: this.metrics.maxFPS.toFixed(1)
            },
            frameTime: {
                current: this.frameTime.toFixed(2) + 'ms',
                average: this.metrics.averageFrameTime.toFixed(2) + 'ms',
                worst: this.metrics.worstFrameTime.toFixed(2) + 'ms'
            },
            performance: {
                score: this.metrics.performanceScore.toFixed(1) + '%',
                frameDrops: this.metrics.frameDrops,
                totalFrames: this.metrics.totalFrames,
                optimizationLevel: this.optimizationLevel
            }
        };
        
        this.logger.info('Performance Report:', report);
        return report;
    }
    
    /**
     * Get comprehensive performance statistics with enhanced monitoring
     */
    getStats() {
        const avgFrameTime = this.frameHistory.length > 0
            ? this.frameHistory.reduce((sum, frame) => sum + frame.frameTime, 0) / this.frameHistory.length
            : this.frameTime;

        const avgFPS = 1000 / avgFrameTime;

        return {
            fps: this.fps,
            frameTime: this.frameTime,
            avgFPS: avgFPS,
            avgFrameTime: avgFrameTime,
            frameCount: this.frameCount,
            optimizationLevel: this.optimizationLevel,
            autoAdjustments: { ...this.autoAdjustments },
            metrics: { ...this.metrics },
            frameDrops: this.frameDrops.length,
            isOptimal: avgFPS >= this.targetFPS * 0.95,

            //  Enhanced statistics
            realTimeAverage: this.realTimeTracking.currentAverage,
            performanceTrend: this.realTimeTracking.trend,
            qualityLevel: this.qualityScaling.currentLevel,
            emergencyModeActive: this.emergencyMode.active,
            qualityScaling: {
                enabled: this.qualityScaling.enabled,
                currentLevel: this.qualityScaling.currentLevel,
                lastAdjustment: this.qualityScaling.lastAdjustment
            }
        };
    }

    /**
     * Get current performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            currentFPS: this.fps,
            currentFrameTime: this.frameTime,
            optimizationLevel: this.optimizationLevel,
            autoAdjustments: { ...this.autoAdjustments }
        };
    }

    /**
     *  Get performance budget status
     */
    getPerformanceBudget() {
        const currentFPS = this.realTimeTracking.currentAverage;
        const targetFPS = this.targetFPS;

        return {
            currentFPS: currentFPS,
            targetFPS: targetFPS,
            budgetUsed: (targetFPS - currentFPS) / targetFPS,
            budgetRemaining: Math.max(0, currentFPS - targetFPS) / targetFPS,
            status: currentFPS >= targetFPS * 0.95 ? 'good' :
                   currentFPS >= targetFPS * 0.85 ? 'warning' : 'critical',
            recommendation: this.getPerformanceRecommendation(currentFPS)
        };
    }

    /**
     *  Get performance recommendation
     */
    getPerformanceRecommendation(currentFPS) {
        if (currentFPS >= this.optimizationThresholds.excellent) {
            return 'Performance is excellent. Consider increasing quality settings.';
        } else if (currentFPS >= this.optimizationThresholds.good) {
            return 'Performance is good. Current settings are optimal.';
        } else if (currentFPS >= this.optimizationThresholds.acceptable) {
            return 'Performance is acceptable. Consider reducing some quality settings.';
        } else if (currentFPS >= this.optimizationThresholds.poor) {
            return 'Performance is poor. Reduce quality settings and disable non-essential effects.';
        } else if (currentFPS >= this.optimizationThresholds.critical) {
            return 'Performance is critical. Enable aggressive optimizations.';
        } else {
            return 'Performance is extremely poor. Emergency optimizations recommended.';
        }
    }
    
    /**
     *  Emit quality level change event
     */
    emitQualityChange(level, settings) {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('qualityLevelChanged', {
                detail: {
                    level: level,
                    settings: settings,
                    timestamp: Date.now()
                }
            }));
        }
    }

    /**
     * Emit optimization change event
     */
    emitOptimizationChange(level) {
        // Emit event for other systems to listen to
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('performanceOptimizationChange', {
                detail: { level, adjustments: this.autoAdjustments }
            }));
        }
    }
    
    /**
     * Emit emergency optimization event
     */
    emitEmergencyOptimization() {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('performanceEmergencyOptimization', {
                detail: { adjustments: this.autoAdjustments }
            }));
        }
    }
    
    /**
     * Reset metrics
     */
    reset() {
        this.frameCount = 0;
        this.frameHistory = [];
        this.metrics = {
            averageFPS: 60,
            minFPS: 60,
            maxFPS: 60,
            frameDrops: 0,
            totalFrames: 0,
            worstFrameTime: 0,
            averageFrameTime: 16.67,
            performanceScore: 100
        };
        this.alerts.consecutiveDrops = 0;
        
        this.logger.info('Performance metrics reset');
    }

    // === WORKER PERFORMANCE MONITORING ===

    /**
     * Update collision worker statistics
     */
    updateCollisionWorkerStats(stats) {
        this.updateWorkerStats('collision', stats);
    }

    /**
     * Update physics worker statistics
     */
    updatePhysicsWorkerStats(stats) {
        this.updateWorkerStats('physics', stats);
    }

    /**
     * Update network worker statistics
     */
    updateNetworkWorkerStats(stats) {
        this.updateWorkerStats('network', stats);

        // Network-specific stats
        if (stats.compressionRatio !== undefined) {
            this.workerStats.network.compressionRatio = stats.compressionRatio;
        }
    }

    /**
     * Generic worker stats update
     */
    updateWorkerStats(workerType, stats) {
        if (!this.workerStats[workerType]) {
            this.logger.warn(`Unknown worker type: ${workerType}`);
            return;
        }

        const workerStat = this.workerStats[workerType];
        const currentTime = performance.now();

        // Update message count
        if (stats.messagesProcessed !== undefined) {
            workerStat.messagesProcessed += stats.messagesProcessed;
        }

        // Update processing time
        if (stats.processingTime !== undefined) {
            const newAverage = (workerStat.averageProcessingTime * 0.9) + (stats.processingTime * 0.1);
            workerStat.averageProcessingTime = newAverage;
            workerStat.lastProcessingTime = stats.processingTime;
        }

        // Update error count
        if (stats.errors !== undefined) {
            workerStat.errors += stats.errors;
        }

        // Update utilization (percentage of time worker is busy)
        if (stats.utilization !== undefined) {
            workerStat.utilization = stats.utilization;
        }

        // Track fallback usage
        if (stats.fallbackUsed) {
            workerStat.fallbackCount++;
        }

        // Add to history
        this.workerHistory[workerType].push({
            timestamp: currentTime,
            processingTime: stats.processingTime || 0,
            messagesProcessed: stats.messagesProcessed || 0,
            utilization: stats.utilization || 0
        });

        // Limit history size
        if (this.workerHistory[workerType].length > this.maxWorkerHistory) {
            this.workerHistory[workerType].shift();
        }

        // Only log occasionally to avoid spam
        if (stats.messagesProcessed > 0 && stats.messagesProcessed % 100 === 0) {
            this.logger.debug(`${workerType} worker stats updated (every 100 messages):`, stats);
        }
    }

    /**
     * Record worker message processing
     */
    recordWorkerMessage(workerType, processingTime, success = true) {
        if (!this.workerStats[workerType]) return;

        this.updateWorkerStats(workerType, {
            messagesProcessed: 1,
            processingTime: processingTime,
            errors: success ? 0 : 1
        });
    }

    /**
     * Record worker fallback usage
     */
    recordWorkerFallback(workerType, reason = 'unknown') {
        if (!this.workerStats[workerType]) return;

        this.updateWorkerStats(workerType, {
            fallbackUsed: true
        });

        this.logger.warn(`${workerType} worker fallback used: ${reason}`);
    }

    /**
     * Get worker performance statistics
     */
    getWorkerStats() {
        const stats = {};

        Object.keys(this.workerStats).forEach(workerType => {
            const workerStat = this.workerStats[workerType];
            const history = this.workerHistory[workerType];

            stats[workerType] = {
                ...workerStat,
                efficiency: this.calculateWorkerEfficiency(workerType),
                averageUtilization: this.calculateAverageUtilization(history),
                messageRate: this.calculateMessageRate(history),
                errorRate: workerStat.messagesProcessed > 0
                    ? (workerStat.errors / workerStat.messagesProcessed) * 100
                    : 0
            };
        });

        return stats;
    }

    /**
     * Calculate worker efficiency (lower processing time = higher efficiency)
     */
    calculateWorkerEfficiency(workerType) {
        const workerStat = this.workerStats[workerType];

        if (workerStat.averageProcessingTime === 0) return 100;

        // Efficiency based on processing time (lower is better)
        // Assume 1ms is excellent, 10ms is poor
        const maxTime = 10;
        const efficiency = Math.max(0, 100 - (workerStat.averageProcessingTime / maxTime) * 100);

        return Math.round(efficiency);
    }

    /**
     * Calculate average utilization from history
     */
    calculateAverageUtilization(history) {
        if (history.length === 0) return 0;

        const totalUtilization = history.reduce((sum, entry) => sum + entry.utilization, 0);
        return totalUtilization / history.length;
    }

    /**
     * Calculate message processing rate (messages per second)
     */
    calculateMessageRate(history) {
        if (history.length < 2) return 0;

        const timeSpan = history[history.length - 1].timestamp - history[0].timestamp;
        const totalMessages = history.reduce((sum, entry) => sum + entry.messagesProcessed, 0);

        if (timeSpan === 0) return 0;

        return (totalMessages / timeSpan) * 1000; // Convert to messages per second
    }

    /**
     * Get comprehensive worker performance report
     */
    getWorkerPerformanceReport() {
        const workerStats = this.getWorkerStats();
        const totalMessages = Object.values(workerStats).reduce((sum, stat) => sum + stat.messagesProcessed, 0);
        const totalErrors = Object.values(workerStats).reduce((sum, stat) => sum + stat.errors, 0);
        const totalFallbacks = Object.values(workerStats).reduce((sum, stat) => sum + stat.fallbackCount, 0);

        return {
            timestamp: Date.now(),
            summary: {
                totalMessages: totalMessages,
                totalErrors: totalErrors,
                totalFallbacks: totalFallbacks,
                overallErrorRate: totalMessages > 0 ? (totalErrors / totalMessages) * 100 : 0,
                fallbackRate: totalMessages > 0 ? (totalFallbacks / totalMessages) * 100 : 0
            },
            workers: workerStats,
            recommendations: this.getWorkerRecommendations(workerStats)
        };
    }

    /**
     * Get worker performance recommendations
     */
    getWorkerRecommendations(workerStats) {
        const recommendations = [];

        Object.entries(workerStats).forEach(([workerType, stats]) => {
            if (stats.errorRate > 5) {
                recommendations.push(`${workerType} worker has high error rate (${stats.errorRate.toFixed(1)}%)`);
            }

            if (stats.efficiency < 50) {
                recommendations.push(`${workerType} worker efficiency is low (${stats.efficiency}%)`);
            }

            if (stats.fallbackCount > 10) {
                recommendations.push(`${workerType} worker frequently falls back to main thread`);
            }

            if (stats.averageUtilization > 90) {
                recommendations.push(`${workerType} worker is overutilized (${stats.averageUtilization.toFixed(1)}%)`);
            }
        });

        if (recommendations.length === 0) {
            recommendations.push('All workers are performing well');
        }

        return recommendations;
    }

    /**
     * Reset worker statistics
     */
    resetWorkerStats() {
        Object.keys(this.workerStats).forEach(workerType => {
            this.workerStats[workerType] = {
                messagesProcessed: 0,
                averageProcessingTime: 0,
                errors: 0,
                utilization: 0,
                fallbackCount: 0,
                lastProcessingTime: 0
            };

            this.workerHistory[workerType] = [];
        });

        // Reset network-specific stats
        this.workerStats.network.compressionRatio = 1.0;

        this.logger.info('Worker statistics reset');
    }
}

export default PerformanceMonitor;

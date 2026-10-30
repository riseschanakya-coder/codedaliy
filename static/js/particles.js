/**
 * CodeDaily Interactive Particle Canvas System
 * Ultra-smooth, responsive, theme-aware particle network background
 */

(function () {
    'use strict';

    class ParticleNetwork {
        constructor(canvasId = 'particle-canvas') {
            this.canvas = document.getElementById(canvasId);
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
                this.canvas.id = canvasId;
                this.canvas.className = 'particle-canvas';
                this.canvas.setAttribute('aria-hidden', 'true');
                document.body.prepend(this.canvas);
            }

            this.ctx = this.canvas.getContext('2d');
            this.particles = [];
            this.width = 0;
            this.height = 0;
            this.dpr = Math.min(window.devicePixelRatio || 1, 2);
            this.animationFrameId = null;
            this.isPaused = false;

            // Mouse interaction state
            this.mouse = {
                x: null,
                y: null,
                radius: 140,
                isHovering: false
            };

            // Touch interaction
            this.touchActive = false;

            // Configuration
            this.config = {
                particleDensity: 0.00008,
                minParticles: 35,
                maxParticles: 95,
                maxDistance: 130,
                mouseConnectionRadius: 150,
                mouseRepelForce: 0.03,
                baseSpeed: 0.45,
                colors: this.getThemeColors()
            };

            this.init();
        }

        getThemeColors() {
            const theme = document.documentElement.dataset.theme || 'dark';
            if (theme === 'dark') {
                return {
                    particles: ['rgba(99, 102, 241, 0.75)', 'rgba(56, 189, 248, 0.75)', 'rgba(168, 85, 247, 0.7)'],
                    lineColor: 'rgba(99, 102, 241, ',
                    glowColor: 'rgba(56, 189, 248, 0.35)',
                    mouseLineColor: 'rgba(129, 140, 248, '
                };
            } else if (theme === 'focus') {
                return {
                    particles: ['rgba(16, 185, 129, 0.75)', 'rgba(52, 211, 153, 0.7)', 'rgba(45, 212, 191, 0.7)'],
                    lineColor: 'rgba(16, 185, 129, ',
                    glowColor: 'rgba(52, 211, 153, 0.3)',
                    mouseLineColor: 'rgba(52, 211, 153, '
                };
            } else {
                // Light mode
                return {
                    particles: ['rgba(79, 70, 229, 0.65)', 'rgba(2, 132, 199, 0.65)', 'rgba(124, 58, 237, 0.55)'],
                    lineColor: 'rgba(79, 70, 229, ',
                    glowColor: 'rgba(79, 70, 229, 0.18)',
                    mouseLineColor: 'rgba(99, 102, 241, '
                };
            }
        }

        init() {
            this.handleResize();
            this.bindEvents();
            this.createParticles();
            this.start();
        }

        handleResize() {
            this.width = window.innerWidth;
            this.height = window.innerHeight;

            this.canvas.width = this.width * this.dpr;
            this.canvas.height = this.height * this.dpr;
            this.canvas.style.width = `${this.width}px`;
            this.canvas.style.height = `${this.height}px`;

            this.ctx.scale(this.dpr, this.dpr);

            if (this.particles.length > 0) {
                this.createParticles();
            }
        }

        createParticles() {
            const area = this.width * this.height;
            let count = Math.floor(area * this.config.particleDensity);
            count = Math.max(this.config.minParticles, Math.min(count, this.config.maxParticles));

            this.particles = [];
            for (let i = 0; i < count; i++) {
                this.particles.push(this.createParticle());
            }
        }

        createParticle(x = null, y = null) {
            const colors = this.config.colors.particles;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const angle = Math.random() * Math.PI * 2;
            const speed = (0.2 + Math.random() * 0.45) * this.config.baseSpeed;

            return {
                x: x !== null ? x : Math.random() * this.width,
                y: y !== null ? y : Math.random() * this.height,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: Math.random() * 1.8 + 1.2,
                color: color,
                baseAlpha: Math.random() * 0.45 + 0.35,
                pulse: Math.random() * Math.PI,
                pulseSpeed: 0.02 + Math.random() * 0.03
            };
        }

        bindEvents() {
            window.addEventListener('resize', () => this.handleResize(), { passive: true });

            window.addEventListener('mousemove', (e) => {
                this.mouse.x = e.clientX;
                this.mouse.y = e.clientY;
                this.mouse.isHovering = true;
            }, { passive: true });

            window.addEventListener('mouseleave', () => {
                this.mouse.x = null;
                this.mouse.y = null;
                this.mouse.isHovering = false;
            });

            // Touch interaction
            window.addEventListener('touchstart', (e) => {
                if (e.touches.length > 0) {
                    this.mouse.x = e.touches[0].clientX;
                    this.mouse.y = e.touches[0].clientY;
                    this.mouse.isHovering = true;
                }
            }, { passive: true });

            window.addEventListener('touchmove', (e) => {
                if (e.touches.length > 0) {
                    this.mouse.x = e.touches[0].clientX;
                    this.mouse.y = e.touches[0].clientY;
                }
            }, { passive: true });

            window.addEventListener('touchend', () => {
                this.mouse.x = null;
                this.mouse.y = null;
                this.mouse.isHovering = false;
            });

            // Gentle ripple pulse on click
            window.addEventListener('click', (e) => {
                this.triggerRipple(e.clientX, e.clientY);
            });

            // Page visibility optimization
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this.stop();
                } else {
                    this.start();
                }
            });

            // Theme switch detection
            const observer = new MutationObserver(() => {
                this.updateThemeColors();
            });
            observer.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['data-theme']
            });
        }

        updateThemeColors() {
            this.config.colors = this.getThemeColors();
            this.particles.forEach((p) => {
                const colors = this.config.colors.particles;
                p.color = colors[Math.floor(Math.random() * colors.length)];
            });
        }

        triggerRipple(clickX, clickY) {
            const rippleRadius = 180;
            this.particles.forEach((p) => {
                const dx = p.x - clickX;
                const dy = p.y - clickY;
                const dist = Math.hypot(dx, dy);
                if (dist < rippleRadius && dist > 0) {
                    const force = (1 - dist / rippleRadius) * 2.2;
                    p.vx += (dx / dist) * force;
                    p.vy += (dy / dist) * force;
                }
            });

            if (this.particles.length < this.config.maxParticles + 8) {
                for (let i = 0; i < 3; i++) {
                    const spark = this.createParticle(clickX, clickY);
                    spark.vx = (Math.random() - 0.5) * 2.5;
                    spark.vy = (Math.random() - 0.5) * 2.5;
                    spark.radius = Math.random() * 2 + 1.5;
                    this.particles.push(spark);
                }
            }
        }

        updateParticles() {
            const maxSpeed = 1.8;

            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];

                if (this.mouse.isHovering && this.mouse.x !== null) {
                    const dx = p.x - this.mouse.x;
                    const dy = p.y - this.mouse.y;
                    const dist = Math.hypot(dx, dy);

                    if (dist < this.mouse.radius && dist > 1) {
                        const force = (1 - dist / this.mouse.radius) * this.config.mouseRepelForce;
                        p.vx += (dx / dist) * force * 1.5;
                        p.vy += (dy / dist) * force * 1.5;
                    }
                }

                const currentSpeed = Math.hypot(p.vx, p.vy);
                if (currentSpeed > maxSpeed) {
                    p.vx = (p.vx / currentSpeed) * maxSpeed;
                    p.vy = (p.vy / currentSpeed) * maxSpeed;
                } else if (currentSpeed > this.config.baseSpeed * 0.8) {
                    p.vx *= 0.99;
                    p.vy *= 0.99;
                }

                p.x += p.vx;
                p.y += p.vy;

                const pad = 10;
                if (p.x < -pad) p.x = this.width + pad;
                if (p.x > this.width + pad) p.x = -pad;
                if (p.y < -pad) p.y = this.height + pad;
                if (p.y > this.height + pad) p.y = -pad;

                p.pulse += p.pulseSpeed;
            }

            if (this.particles.length > this.config.maxParticles) {
                this.particles.shift();
            }
        }

        draw() {
            this.ctx.clearRect(0, 0, this.width, this.height);

            const maxDist = this.config.maxDistance;
            const lineColorPrefix = this.config.colors.lineColor;

            for (let i = 0; i < this.particles.length; i++) {
                const p1 = this.particles[i];
                for (let j = i + 1; j < this.particles.length; j++) {
                    const p2 = this.particles[j];
                    const dx = p1.x - p2.x;
                    const dy = p1.y - p2.y;
                    const dist = Math.hypot(dx, dy);

                    if (dist < maxDist) {
                        const alpha = (1 - dist / maxDist) * 0.28;
                        this.ctx.beginPath();
                        this.ctx.strokeStyle = `${lineColorPrefix}${alpha})`;
                        this.ctx.lineWidth = 0.9;
                        this.ctx.moveTo(p1.x, p1.y);
                        this.ctx.lineTo(p2.x, p2.y);
                        this.ctx.stroke();
                    }
                }

                if (this.mouse.isHovering && this.mouse.x !== null) {
                    const mdx = p1.x - this.mouse.x;
                    const mdy = p1.y - this.mouse.y;
                    const mdist = Math.hypot(mdx, mdy);
                    if (mdist < this.config.mouseConnectionRadius) {
                        const mAlpha = (1 - mdist / this.config.mouseConnectionRadius) * 0.45;
                        this.ctx.beginPath();
                        this.ctx.strokeStyle = `${this.config.colors.mouseLineColor}${mAlpha})`;
                        this.ctx.lineWidth = 1.1;
                        this.ctx.moveTo(p1.x, p1.y);
                        this.ctx.lineTo(this.mouse.x, this.mouse.y);
                        this.ctx.stroke();
                    }
                }
            }

            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                const dynamicAlpha = Math.max(0.2, p.baseAlpha + Math.sin(p.pulse) * 0.2);

                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                this.ctx.fillStyle = p.color;
                this.ctx.globalAlpha = dynamicAlpha;

                this.ctx.shadowBlur = 8;
                this.ctx.shadowColor = this.config.colors.glowColor;
                this.ctx.fill();
                this.ctx.restore();
            }
        }

        loop() {
            if (!this.isPaused) {
                this.updateParticles();
                this.draw();
            }
            this.animationFrameId = requestAnimationFrame(() => this.loop());
        }

        start() {
            if (!this.animationFrameId) {
                this.loop();
            }
        }

        stop() {
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.codeDailyParticles = new ParticleNetwork();
        });
    } else {
        window.codeDailyParticles = new ParticleNetwork();
    }
})();

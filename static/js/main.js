/**
 * CodeDaily Main Interactive Application Script
 * Theme switcher, card spotlight glows, problem filtering, animated accuracy ring
 */

document.addEventListener('DOMContentLoaded', () => {
    initThemeManager();
    initMobileNav();
    initCardSpotlights();
    initProblemsFilter();
    initAccuracyRing();
    initCopyHelpers();
});

/**
 * 1. Theme Manager & Toggle (Sun / Moon)
 */
function initThemeManager() {
    const themeToggles = document.querySelectorAll('#theme-toggle, .theme-toggle-btn');
    const themeSelect = document.getElementById('theme-select');
    let currentTheme = document.documentElement.dataset.theme || localStorage.getItem('codedaily-theme') || 'dark';

    function applyTheme(theme) {
        currentTheme = theme;
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('codedaily-theme', theme);

        themeToggles.forEach((btn) => {
            btn.setAttribute('data-current-theme', theme);
            const label = btn.querySelector('.js-theme-label');
            if (label) {
                label.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
            }
            const isDark = theme === 'dark';
            btn.setAttribute('aria-label', `Current theme is ${theme}. Click to switch to ${isDark ? 'light' : 'dark'} mode.`);
            btn.setAttribute('title', `Switch to ${isDark ? 'light' : 'dark'} mode`);
        });

        if (themeSelect) {
            themeSelect.value = theme;
        }

        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    }

    applyTheme(currentTheme);

    themeToggles.forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(nextTheme);
        });
    });

    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            applyTheme(e.target.value);
        });
    }
}

/**
 * 2. Mobile Navigation Toggle
 */
function initMobileNav() {
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (navToggle && navLinks) {
        navToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = navLinks.classList.toggle('nav-links-open');
            navToggle.setAttribute('aria-expanded', String(isOpen));
        });

        document.addEventListener('click', (e) => {
            if (!navToggle.contains(e.target) && !navLinks.contains(e.target) && navLinks.classList.contains('nav-links-open')) {
                navLinks.classList.remove('nav-links-open');
                navToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }
}

/**
 * 3. Dynamic Cursor Spotlight Effect on Cards
 */
function initCardSpotlights() {
    const selector = '.stat-card, .action-card, .problem-row, .auth-card, .problem-panel, .editor-panel, .dashboard-hero, .daily-summary article, .profile-card, .profile-stats div, .difficulty-breakdown article';
    const cards = document.querySelectorAll(selector);

    cards.forEach((card) => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        });
    });
}

/**
 * 4. Interactive Problems Search & Category Tabs
 */
function initProblemsFilter() {
    const searchInput = document.getElementById('problem-search');
    const filterTabs = document.querySelectorAll('.filter-tabs button');
    const problemRows = document.querySelectorAll('.problem-row');
    const emptyNotice = document.getElementById('problem-empty');

    if (!searchInput && filterTabs.length === 0) return;

    let activeFilter = 'all';
    let searchQuery = '';

    function applyFilter() {
        let visibleCount = 0;

        problemRows.forEach((row) => {
            const titleDifficulty = (row.getAttribute('data-search') || '').toLowerCase();
            const difficulty = (row.getAttribute('data-difficulty') || '').toLowerCase();

            const matchesSearch = !searchQuery || titleDifficulty.includes(searchQuery);
            const matchesFilter = activeFilter === 'all' || difficulty === activeFilter;

            if (matchesSearch && matchesFilter) {
                row.style.display = '';
                row.classList.add('fade-in-item');
                visibleCount++;
            } else {
                row.style.display = 'none';
                row.classList.remove('fade-in-item');
            }
        });

        if (emptyNotice) {
            emptyNotice.hidden = visibleCount > 0;
        }
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            applyFilter();
        });
    }

    filterTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            filterTabs.forEach((b) => b.classList.remove('active'));
            tab.classList.add('active');
            activeFilter = tab.getAttribute('data-filter') || 'all';
            applyFilter();
        });
    });
}

/**
 * 5. Animated Accuracy Ring
 */
function initAccuracyRing() {
    const ring = document.querySelector('.accuracy-ring');
    if (!ring) return;

    const accuracyVal = ring.style.getPropertyValue('--accuracy') || '0%';
    const numericVal = parseInt(accuracyVal, 10) || 0;

    const textNode = ring.querySelector('span');
    if (textNode) {
        let current = 0;
        const duration = 900;
        const startTime = performance.now();

        function animateCount(time) {
            const elapsed = time - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3);
            current = Math.round(numericVal * easeOut);
            textNode.textContent = `${current}%`;

            if (progress < 1) {
                requestAnimationFrame(animateCount);
            }
        }
        requestAnimationFrame(animateCount);
    }
}

/**
 * 6. Code snippet / example copy micro-interaction
 */
function initCopyHelpers() {
    const preBlocks = document.querySelectorAll('.problem-panel pre');
    preBlocks.forEach((pre) => {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.type = 'button';
        copyBtn.setAttribute('aria-label', 'Copy snippet');
        copyBtn.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy</span>
        `;

        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(pre.innerText);
                copyBtn.innerHTML = `
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span style="color:#10b981">Copied!</span>
                `;
                setTimeout(() => {
                    copyBtn.innerHTML = `
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>Copy</span>
                    `;
                }, 1800);
            } catch (err) {
                // Clipboard fallback
            }
        });

        pre.style.position = 'relative';
        pre.appendChild(copyBtn);
    });
}

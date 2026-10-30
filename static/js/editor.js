/**
 * CodeDaily Interactive Code Editor & Runner
 * Keyboard indentation, live language templates, API run/submit integration
 */

document.addEventListener('DOMContentLoaded', () => {
    initCodeEditor();
});

function initCodeEditor() {
    const layout = document.querySelector('.coding-layout');
    const editor = document.getElementById('source-code');
    const isDaily = layout?.dataset.isDaily === 'true';
    const langSelect = document.getElementById('language');
    const runBtn = document.getElementById('run-btn');
    const submitBtn = document.getElementById('submit-btn');
    const verdict = document.getElementById('verdict');
    const output = document.getElementById('output');

    if (!editor) return;

    const questionId = layout ? parseInt(layout.dataset.questionId, 10) : null;
    const functionSignature = layout ? layout.dataset.functionSignature : '';

    // Language starter boilerplates
    const starterCode = {
        python: functionSignature ? `${functionSignature}\n    # Write your solution here\n    pass` : `def solve():\n    # Write your solution here\n    pass\n\nsolve()`,
        c: `#include <stdio.h>\n\nint main() {\n    // Write your solution here\n    printf("Hello World\\n");\n    return 0;\n}`,
        cpp: `#include <iostream>\n#include <vector>\n\nusing namespace std;\n\nint main() {\n    // Write your solution here\n    cout << "Hello World" << endl;\n    return 0;\n}`,
        java: `public class Solution {\n    public static void main(String[] args) {\n        // Write your solution here\n        System.out.println("Hello World");\n    }\n}`
    };

    if (langSelect) {
        langSelect.addEventListener('change', (e) => {
            const lang = e.target.value;
            if (starterCode[lang] && (editor.value.trim() === '' || editor.value.includes('Write your solution here'))) {
                editor.value = starterCode[lang];
            }
        });
    }

    // Support Tab key indentation
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + "    " + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
        }
    });

    // Run Code against Sample Test Cases
    if (runBtn) {
        runBtn.addEventListener('click', async () => {
            setRunnerState(true, 'Running sample test...');

            try {
                const response = await fetch('/api/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        question_id: questionId,
                        language: langSelect ? langSelect.value : 'python',
                        source_code: editor.value
                    })
                });

                const data = await response.json();
                setRunnerState(false);

                if (verdict) {
                    verdict.textContent = data.verdict || 'Executed';
                    verdict.className = (data.verdict === 'Accepted') ? 'verdict-pass' : 'verdict-error';
                }

                if (output) {
                    let out = '';
                    if (data.verdict === 'Accepted') {
                        out += `<span class="log-success">✓ Test Case Passed!</span>\n`;
                    } else {
                        out += `<span class="log-error">✕ ${escapeHtml(data.verdict || 'Execution Error')}</span>\n`;
                    }

                    if (data.output) {
                        out += `<span class="log-header">Output:</span>\n${escapeHtml(data.output)}\n`;
                    }
                    if (data.errors) {
                        out += `<span class="log-error">Errors:</span>\n${escapeHtml(data.errors)}\n`;
                    }
                    if (data.execution_time !== undefined) {
                        out += `\n<span class="log-info">Execution Time: ${data.execution_time}s</span>`;
                    }
                    output.innerHTML = out || 'Completed with no output.';
                }
            } catch (err) {
                setRunnerState(false);
                if (verdict) {
                    verdict.textContent = 'Error';
                    verdict.className = 'verdict-error';
                }
                if (output) {
                    output.innerHTML = `<span class="log-error">Failed to communicate with test runner: ${escapeHtml(err.message)}</span>`;
                }
            }
        });
    }

    // Submit Code against Hidden Test Cases & Streak Evaluation
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            setRunnerState(true, 'Evaluating test suite...');

            try {
                const response = await fetch('/api/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        question_id: questionId,
                        language: langSelect ? langSelect.value : 'python',
                        source_code: editor.value
                    })
                });

                const data = await response.json();
                setRunnerState(false);

                if (verdict) {
                    verdict.textContent = data.verdict || 'Evaluated';
                    verdict.className = (data.verdict === 'Accepted') ? 'verdict-accepted' : 'verdict-error';
                }

                if (data.verdict === 'Accepted') {
                    // Update Streak count and statuses in DOM
                    if (data.stats) {
                        document.querySelectorAll('.js-streak-count').forEach(el => {
                            el.textContent = data.stats.current_streak;
                            el.classList.add('streak-pop');
                            setTimeout(() => el.classList.remove('streak-pop'), 800);
                        });

                        if (isDaily) {
                            document.querySelectorAll('.js-today-status').forEach(el => {
                                el.textContent = 'Solved';
                                const card = el.closest('article');
                                if (card) {
                                    card.classList.remove('pending');
                                    card.classList.add('done');
                                }
                            });
                        }
                    }

                    // Celebratory particle ripple shockwave
                    if (window.codeDailyParticles) {
                        const rect = submitBtn.getBoundingClientRect();
                        window.codeDailyParticles.triggerRipple(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    }

                    if (output) {
                        output.innerHTML = `<span class="log-congrats">🎉 Accepted! All test cases passed.</span>\n` +
                            `Status: <strong style="color: #10b981;">Accepted</strong>\n` +
                            `Execution Time: <strong>${data.execution_time || 0}s</strong>\n\n` +
                            `<span class="log-streak">🔥 Streak updated! Keep up the daily practice.</span>`;
                    }
                } else {
                    if (output) {
                        let out = `<span class="log-error">✕ Submission Verdict: ${escapeHtml(data.verdict || 'Failed')}</span>\n`;
                        if (data.output) out += `Output:\n${escapeHtml(data.output)}\n`;
                        if (data.errors) out += `Errors:\n${escapeHtml(data.errors)}\n`;
                        output.innerHTML = out;
                    }
                }
            } catch (err) {
                setRunnerState(false);
                if (verdict) {
                    verdict.textContent = 'Error';
                    verdict.className = 'verdict-error';
                }
                if (output) {
                    output.innerHTML = `<span class="log-error">Submission failed: ${escapeHtml(err.message)}</span>`;
                }
            }
        });
    }

    function setRunnerState(isLoading, message = 'Running...') {
        if (runBtn) runBtn.disabled = isLoading;
        if (submitBtn) submitBtn.disabled = isLoading;

        if (verdict && isLoading) {
            verdict.textContent = message;
            verdict.className = 'verdict-running';
        }
        if (output && isLoading) {
            output.innerHTML = `<div class="editor-spinner"></div> Compiling and executing in isolated sandbox...`;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

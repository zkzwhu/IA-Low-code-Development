import { state } from './appStore.js';

const CONSOLE_CONFIG = {
    run: {
        elementId: 'consoleOutput',
        placeholder: '准备就绪，拖拽组件到画布并运行工作流查看结果。'
    },
    debug: {
        elementId: 'debugConsoleOutput',
        placeholder: '进入调试模式后，这里会输出当前节点、断点命中和单步执行信息。'
    }
};

function getConsoleElement(target = 'run') {
    const config = CONSOLE_CONFIG[target] || CONSOLE_CONFIG.run;
    return document.getElementById(config.elementId);
}

function ensurePlaceholderCleared(consoleDiv) {
    const placeholder = consoleDiv.querySelector('.console-placeholder');
    if (placeholder) placeholder.remove();
}

function createLogLine(msg, type) {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = `[${new Date().toLocaleTimeString()}]`;

    const prefix = document.createElement('span');
    prefix.className = 'log-prefix';
    prefix.textContent = type === 'error'
        ? '✖'
        : (type === 'debug' ? '🐞' : (type === 'run' ? '▶' : 'ℹ'));

    const text = document.createElement('span');
    text.className = 'log-text';
    text.textContent = String(msg);

    line.appendChild(time);
    line.appendChild(prefix);
    line.appendChild(text);
    return line;
}

export function addConsoleLog(msg, type = 'info', target = 'run') {
    const consoleDiv = getConsoleElement(target);
    if (!consoleDiv) return;

    ensurePlaceholderCleared(consoleDiv);
    const line = createLogLine(msg, type);
    consoleDiv.appendChild(line);
    line.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function clearConsole(target = 'run') {
    const consoleDiv = getConsoleElement(target);
    const config = CONSOLE_CONFIG[target] || CONSOLE_CONFIG.run;
    if (!consoleDiv) return;

    consoleDiv.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'log-line console-placeholder';
    line.textContent = config.placeholder;
    consoleDiv.appendChild(line);
}

export function displayLogs(logs) {
    clearConsole('run');

    if (state.consoleMode === 'detail') {
        logs.forEach(log => addConsoleLog(log, 'run', 'run'));
        return;
    }

    const filtered = logs.filter(line => {
        return line.includes('==========') ||
               line.includes('打印:') ||
               line.includes('错误') ||
               line.includes('警告');
    });

    if (filtered.length === 0) {
        filtered.push('执行完成，无输出日志');
    }

    filtered.forEach(log => addConsoleLog(log, 'run', 'run'));
}

export function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

export function showModal({ title, bodyHtml, okText = '确定', cancelText = '取消', showCancel = true, onOk = null, onCancel = null }) {
    const mask = document.getElementById('modalMask');
    const titleEl = document.getElementById('modalTitle');
    const bodyEl = document.getElementById('modalBody');
    const closeBtn = document.getElementById('modalCloseBtn');
    const okBtn = document.getElementById('modalOkBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');

    if (!mask || !titleEl || !bodyEl || !okBtn || !cancelBtn || !closeBtn) {
        alert(String(title || '') + '\n\n' + String(bodyHtml || '').replace(/<[^>]+>/g, ''));
        return;
    }

    titleEl.textContent = title || '提示';
    bodyEl.innerHTML = bodyHtml || '';
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    cancelBtn.style.display = showCancel ? '' : 'none';

    const cleanup = () => {
        mask.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        closeBtn.onclick = null;
        mask.onclick = null;
    };

    okBtn.onclick = () => {
        const result = onOk ? onOk({ mask, bodyEl }) : true;
        if (result !== false) cleanup();
    };

    const handleCancel = () => {
        if (onCancel) onCancel();
        cleanup();
    };

    cancelBtn.onclick = handleCancel;
    closeBtn.onclick = handleCancel;
    mask.onclick = (e) => {
        if (e.target === mask) handleCancel();
    };

    mask.style.display = 'flex';
}

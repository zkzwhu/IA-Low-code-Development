import { state, setActiveCanvasTool, setActiveConsoleTab, setCanvasZoom, setDebugCurrentNodeId } from './appStore.js';
import { addConsoleLog, clearConsole, displayLogs, showModal } from './appUtils.js';
import { autoArrangeNodes, canUndoCanvasChange, captureCanvasHistorySnapshot, commitCanvasHistorySnapshot, copySelectedNodes, createNode, cutSelectedNodes, deleteSelectedNodes, pasteClipboardNodes, placeNodeWithoutOverlapById, renderCanvas, resetCanvasHistory, setSelectedNode, undoCanvasChange } from './nodeManager.js';
import { initFileMenu } from './menuFile.js';
import { initProjectMenu } from './menuProject.js';
import { initSettingsMenu } from './menuSettings.js';
import { initWindowMenu } from './menuWindow.js';

let debugSessionId = null;
const ALLOWED_NODE_TYPES = new Set(['start', 'print', 'sequence', 'loop', 'branch']);
const MIN_CANVAS_ZOOM = 0.5;
const MAX_CANVAS_ZOOM = 2;
const CANVAS_ZOOM_STEP = 0.1;
const COMPONENT_LIBRARY = [
    {
        id: 'collection',
        title: '信息收集',
        description: '收集流程入口与基础采集节点',
        icon: '🧭',
        expanded: true,
        items: [
            { type: 'start', icon: '🟢', title: '开始节点', desc: '工作流入口' }
        ]
    },
    {
        id: 'processing',
        title: '信息处理',
        description: '处理逻辑判断与流程输出',
        icon: '🧠',
        expanded: true,
        items: [
            { type: 'print', icon: '🖨️', title: '打印节点', desc: '输出调试信息' },
            { type: 'loop', icon: '🔄', title: '循环节点', desc: '重复执行指定次数' },
            { type: 'branch', icon: '🌿', title: '分支节点', desc: '根据条件选择路径' }
        ]
    },
    {
        id: 'variable',
        title: '变量处理',
        description: '处理变量流转与顺序执行',
        icon: '🧮',
        expanded: true,
        items: [
            { type: 'sequence', icon: '🔁', title: '顺序节点', desc: '占位/传递执行流' }
        ]
    }
];
const expandedComponentGroups = new Set(
    COMPONENT_LIBRARY
        .filter(group => group.expanded !== false)
        .map(group => group.id)
);

function getComponentLibraryItem(type) {
    for (const group of COMPONENT_LIBRARY) {
        const item = group.items.find(component => component.type === type);
        if (item) return item;
    }
    return null;
}

function renderComponentLibrary() {
    const list = document.getElementById('componentsLibrary');
    if (!list) return;

    list.innerHTML = COMPONENT_LIBRARY.map(group => {
        const expanded = expandedComponentGroups.has(group.id);
        const itemsHtml = group.items.map(item => `
            <div class="comp-item" draggable="true" data-type="${item.type}" data-group="${group.id}" title="拖拽 ${item.title} 到画布">
                ${item.icon} ${item.title}
                <div class="comp-desc">${item.desc}</div>
            </div>
        `).join('');

        return `
            <section class="comp-group ${expanded ? 'expanded' : ''}" data-group-id="${group.id}">
                <button class="comp-group-header" type="button" data-group-toggle="${group.id}" aria-expanded="${expanded ? 'true' : 'false'}">
                    <span class="comp-group-title-wrap">
                        <span class="comp-group-icon">${group.icon}</span>
                        <span class="comp-group-title-text">
                            <span class="comp-group-title">${group.title}</span>
                            <span class="comp-group-subtitle">${group.description}</span>
                        </span>
                    </span>
                    <span class="comp-group-arrow">${expanded ? '▾' : '▸'}</span>
                </button>
                <div class="comp-group-body">${itemsHtml}</div>
            </section>
        `;
    }).join('');
}

function initComponentLibrary() {
    const panel = document.querySelector('.components-panel');
    if (!panel) return;

    renderComponentLibrary();

    panel.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('[data-group-toggle]');
        if (!toggleBtn) return;

        const groupId = toggleBtn.getAttribute('data-group-toggle');
        if (!groupId) return;

        if (expandedComponentGroups.has(groupId)) {
            expandedComponentGroups.delete(groupId);
        } else {
            expandedComponentGroups.add(groupId);
        }

        renderComponentLibrary();
    });
}

function ensureCanvasToolbarExtras() {
    const toolbar = document.getElementById('canvasToolbar');
    const canvasPanel = document.querySelector('.canvas-panel');
    if (!toolbar || !canvasPanel) return;

    const ensureButton = (id, text) => {
        let button = document.getElementById(id);
        if (button) return button;
        button = document.createElement('button');
        button.id = id;
        button.className = 'toolbar-btn toolbar-action-btn';
        button.textContent = text;
        toolbar.appendChild(button);
        return button;
    };

    const undoBtn = ensureButton('undoCanvasBtn', '撤回');
    const copyBtn = ensureButton('copyCanvasBtn', '复制');
    const cutBtn = ensureButton('cutCanvasBtn', '剪切');
    const pasteBtn = ensureButton('pasteCanvasBtn', '粘贴');
    const arrangeBtn = document.getElementById('arrangeCanvasBtn');
    const hint = document.getElementById('canvasToolHint');
    let zoomStatus = document.getElementById('canvasZoomStatus');
    if (!zoomStatus) {
        zoomStatus = document.createElement('span');
        zoomStatus.id = 'canvasZoomStatus';
        zoomStatus.className = 'toolbar-status';
        toolbar.appendChild(zoomStatus);
    }

    if (arrangeBtn) toolbar.appendChild(arrangeBtn);
    if (zoomStatus) toolbar.appendChild(zoomStatus);
    if (hint) toolbar.appendChild(hint);
    if (!document.getElementById('canvasContextMenu')) {
        const menu = document.createElement('div');
        menu.id = 'canvasContextMenu';
        menu.className = 'canvas-context-menu';
        menu.innerHTML = `
            <button class="context-menu-btn" data-menu-action="undo">撤回</button>
            <button class="context-menu-btn" data-menu-action="copy">复制</button>
            <button class="context-menu-btn" data-menu-action="cut">剪切</button>
            <button class="context-menu-btn" data-menu-action="paste">粘贴</button>
        `;
        canvasPanel.appendChild(menu);
    }

    [undoBtn, copyBtn, cutBtn, pasteBtn].forEach(button => {
        button.classList.add('toolbar-action-btn');
        button.setAttribute('draggable', 'false');
    });
}

function updateCanvasToolbarUi() {
    const hint = document.getElementById('canvasToolHint');
    const zoomStatus = document.getElementById('canvasZoomStatus');
    const toolMeta = {
        select: {
            label: '选择',
            tip: '选择模式：左键拖动节点，按住 Alt 再按左键可拖动画布。'
        },
        connect: {
            label: '连线',
            tip: '连线模式：从节点端口拖到目标节点以建立连接。'
        },
        zoom: {
            label: '缩放',
            tip: '缩放模式：单击放大，按住 Shift 单击缩小，也可使用鼠标滚轮缩放。'
        },
        delete: {
            label: '删除',
            tip: '删除模式：点击可删单个节点，按住左键拖动可擦除路径上的节点。'
        },
        arrange: {
            label: '整理',
            tip: '整理画布：按程序执行逻辑，从左到右自动排布节点。'
        },
        undo: {
            label: '撤回',
            tip: '撤回上一步画布修改，例如拖拽、连线、删除、粘贴或属性变更。'
        },
        copy: {
            label: '复制',
            tip: '复制当前选中的节点；会保留节点属性和容器关系，但不保留连接关系。'
        },
        cut: {
            label: '剪切',
            tip: '剪切当前选中的节点；会复制节点结构后从画布移除。'
        },
        paste: {
            label: '粘贴',
            tip: '将剪贴板中的节点粘贴到当前视口或右键菜单位置。'
        }
    };
    const toolText = {
        select: '选择模式：按住 Alt 再按左键可拖动画布。',
        connect: '连线模式：从节点端口拖到目标节点以建立连接。',
        zoom: `缩放模式：单击放大，Shift+单击缩小，滚轮缩放。当前 ${Math.round((state.canvasZoom || 1) * 100)}%。`,
        delete: '删除模式：点击可删单个节点，按住左键拖动可擦除路径上的节点。'
    };

    const applyMeta = (id, metaKey) => {
        const button = document.getElementById(id);
        const meta = toolMeta[metaKey];
        if (!button || !meta) return;
        button.textContent = meta.label;
        button.setAttribute('title', meta.tip);
        button.removeAttribute('data-tooltip');
    };

    applyMeta('selectToolBtn', 'select');
    applyMeta('connectToolBtn', 'connect');
    applyMeta('zoomToolBtn', 'zoom');
    applyMeta('deleteToolBtn', 'delete');
    applyMeta('arrangeCanvasBtn', 'arrange');
    applyMeta('undoCanvasBtn', 'undo');
    applyMeta('copyCanvasBtn', 'copy');
    applyMeta('cutCanvasBtn', 'cut');
    applyMeta('pasteCanvasBtn', 'paste');

    const undoBtn = document.getElementById('undoCanvasBtn');
    if (undoBtn) undoBtn.disabled = !canUndoCanvasChange();

    document.querySelectorAll('[data-tool]').forEach(button => {
        const tool = button.getAttribute('data-tool');
        const isActive = tool === state.activeCanvasTool;
        button.classList.toggle('active', isActive);
        button.classList.toggle('danger-active', isActive && tool === 'delete');
    });

    if (zoomStatus) zoomStatus.textContent = `缩放 ${Math.round((state.canvasZoom || 1) * 100)}%`;
    if (hint) hint.textContent = toolText[state.activeCanvasTool] || toolText.select;
}

function setCanvasTool(tool) {
    setActiveCanvasTool(tool);
    updateCanvasToolbarUi();
    renderCanvas();
}

function clampCanvasZoom(zoom) {
    return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, Number(zoom) || 1));
}

function getCanvasZoomAnchor(clientX = null, clientY = null) {
    const canvasArea = document.getElementById('canvasArea');
    if (!canvasArea) return null;
    const rect = canvasArea.getBoundingClientRect();
    return {
        clientX: clientX ?? (rect.left + rect.width / 2),
        clientY: clientY ?? (rect.top + rect.height / 2),
        rect
    };
}

function applyCanvasZoom(nextZoom, clientX = null, clientY = null) {
    const canvasArea = document.getElementById('canvasArea');
    const anchor = getCanvasZoomAnchor(clientX, clientY);
    if (!canvasArea || !anchor) return;

    const previousZoom = clampCanvasZoom(state.canvasZoom || 1);
    const targetZoom = clampCanvasZoom(nextZoom);
    if (Math.abs(previousZoom - targetZoom) < 0.001) return;

    const localClientX = anchor.clientX - anchor.rect.left;
    const localClientY = anchor.clientY - anchor.rect.top;
    const logicalX = (canvasArea.scrollLeft + localClientX) / previousZoom;
    const logicalY = (canvasArea.scrollTop + localClientY) / previousZoom;

    setCanvasZoom(targetZoom);
    renderCanvas();

    canvasArea.scrollLeft = Math.max(0, logicalX * targetZoom - localClientX);
    canvasArea.scrollTop = Math.max(0, logicalY * targetZoom - localClientY);
    updateCanvasToolbarUi();
}

function stepCanvasZoom(direction, clientX = null, clientY = null) {
    const baseZoom = clampCanvasZoom(state.canvasZoom || 1);
    applyCanvasZoom(baseZoom + (direction * CANVAS_ZOOM_STEP), clientX, clientY);
}

function bindCanvasZoomInteractions() {
    const canvasArea = document.getElementById('canvasArea');
    if (!canvasArea) return;

    canvasArea.addEventListener('wheel', (e) => {
        const canZoom = state.activeCanvasTool === 'zoom' || e.ctrlKey || e.metaKey;
        if (!canZoom) return;
        e.preventDefault();
        stepCanvasZoom(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    }, { passive: false });

    canvasArea.addEventListener('click', (e) => {
        if (state.activeCanvasTool !== 'zoom') return;
        if (e.target.closest('#canvasContextMenu')) return;
        e.preventDefault();
        stepCanvasZoom(e.shiftKey ? -1 : 1, e.clientX, e.clientY);
    });
}

function bindCanvasToolbar() {
    ensureCanvasToolbarExtras();

    const toolbar = document.getElementById('canvasToolbar');
    if (toolbar) {
        toolbar.setAttribute('draggable', 'false');
        toolbar.addEventListener('dragstart', (e) => {
            e.preventDefault();
        });
        toolbar.querySelectorAll('button').forEach(button => {
            button.setAttribute('draggable', 'false');
            button.addEventListener('dragstart', (e) => {
                e.preventDefault();
            });
        });
    }

    document.querySelectorAll('[data-tool]').forEach(button => {
        button.onclick = () => {
            const tool = button.getAttribute('data-tool');
            if (!tool) return;
            if (state.activeCanvasTool === tool && tool !== 'select') {
                setCanvasTool('select');
                return;
            }
            setCanvasTool(tool);
        };
    });

    const arrangeBtn = document.getElementById('arrangeCanvasBtn');
    const undoBtn = document.getElementById('undoCanvasBtn');
    if (arrangeBtn) {
        arrangeBtn.onclick = () => {
            autoArrangeNodes();
            updateCanvasToolbarUi();
            addConsoleLog('已按执行逻辑从左到右整理节点。', 'info', 'run');
        };
    }
    if (undoBtn) {
        undoBtn.onclick = () => {
            if (undoCanvasChange()) updateCanvasToolbarUi();
        };
    }

    const copyBtn = document.getElementById('copyCanvasBtn');
    const cutBtn = document.getElementById('cutCanvasBtn');
    const pasteBtn = document.getElementById('pasteCanvasBtn');

    if (copyBtn) copyBtn.onclick = () => copySelectedNodes();
    if (cutBtn) cutBtn.onclick = () => cutSelectedNodes();
    if (pasteBtn) pasteBtn.onclick = () => pasteClipboardNodes();
}

function prepareDebugToolbar() {
    const topRight = document.querySelector('.top-right');
    if (!topRight) return;

    topRight.innerHTML = `
        <button class="run-button" id="runWorkflowBtn" title="运行工作流">运行工作流</button>
        <button class="run-button debug-start-button" id="startDebugBtn" title="进入调试模式">开始调试</button>
        <div class="debug-actions" id="debugActionGroup" style="display:none;">
            <span class="debug-status-badge" id="debugStatusBadge">调试中</span>
            <button class="run-button debug-action-button" id="debugContinueBtn" title="继续运行到断点或结束" disabled>继续</button>
            <button class="run-button debug-action-button" id="debugStepBtn" title="执行下一步" disabled>单步执行</button>
            <button class="run-button debug-stop-button" id="debugStopBtn" title="停止调试" disabled>停止</button>
        </div>
    `;
}

function prepareConsolePanel() {
    const panel = document.querySelector('.console-panel');
    if (!panel) return;

    panel.innerHTML = `
        <div class="console-header">
            <div class="console-tabs">
                <button class="console-tab active" data-console-tab="run">运行控制台</button>
                <button class="console-tab" data-console-tab="debug">调试控制台</button>
            </div>
            <button class="clear-console" id="clearConsoleBtn" title="清空当前控制台输出">清空当前</button>
        </div>
        <div class="console-body">
            <div class="console-view active" id="runConsoleView">
                <div class="console-output" id="consoleOutput">
                    <div class="log-line console-placeholder">准备就绪，拖拽组件到画布并运行工作流查看结果。</div>
                </div>
            </div>
            <div class="console-view" id="debugConsoleView">
                <div class="debug-console-layout">
                    <div class="debug-overview">
                        <div class="debug-section">
                            <div class="debug-section-title">当前暂停节点</div>
                            <div class="debug-box" id="debugCurrentNodeBox">（未开始调试）</div>
                        </div>
                        <div class="debug-section">
                            <div class="debug-section-title">调用栈 / 上下文</div>
                            <div class="debug-box" id="debugStackBox">（未开始调试）</div>
                        </div>
                        <div class="debug-section">
                            <div class="debug-section-title">变量</div>
                            <div class="debug-box" id="debugVarsBox">（未开始调试）</div>
                        </div>
                    </div>
                    <div class="debug-log-panel">
                        <div class="debug-section-title">调试输出</div>
                        <div class="console-output debug-console-output" id="debugConsoleOutput">
                            <div class="log-line console-placeholder">进入调试模式后，这里会输出当前节点、断点命中和单步执行信息。</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function initDragDrop() {
    const componentsPanel = document.querySelector('.components-panel');
    const canvasArea = document.getElementById('canvasArea');

    if (!canvasArea || !componentsPanel) {
        addConsoleLog('画布区域未找到，拖拽功能可能失效', 'error');
        return;
    }

    componentsPanel.addEventListener('dragstart', (e) => {
        const comp = e.target.closest('.comp-item');
        if (!comp) return;
        const type = comp.getAttribute('data-type');
        if (!type) return;
        e.dataTransfer.setData('text/plain', type);
        e.dataTransfer.effectAllowed = 'copy';
    });

    canvasArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    canvasArea.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const type = e.dataTransfer.getData('text/plain');
        if (!type || !ALLOWED_NODE_TYPES.has(type)) return;

        const rect = canvasArea.getBoundingClientRect();
        const zoom = clampCanvasZoom(state.canvasZoom || 1);
        const viewportMaxX = (canvasArea.scrollLeft + rect.width) / zoom - 200;
        const viewportMaxY = (canvasArea.scrollTop + rect.height) / zoom - 100;
        let x = (e.clientX - rect.left + canvasArea.scrollLeft) / zoom - 90;
        let y = (e.clientY - rect.top + canvasArea.scrollTop) / zoom - 40;
        x = Math.max(20, Math.min(x, viewportMaxX));
        y = Math.max(20, Math.min(y, viewportMaxY));
        const beforeSnapshot = captureCanvasHistorySnapshot();

        const newNode = createNode(type, x, y);
        if (!newNode) {
            addConsoleLog(`创建节点失败：类型 ${type}`, 'error');
            return;
        }

        state.nodes.set(newNode.id, newNode);
        placeNodeWithoutOverlapById(newNode.id, { x, y });
        commitCanvasHistorySnapshot(beforeSnapshot);
        renderCanvas();
        setSelectedNode(newNode.id);
        const componentItem = getComponentLibraryItem(type);
        addConsoleLog(`已添加 ${componentItem?.title || type}，ID:${newNode.id}`, 'info');
    });
}

function setConsoleTab(tab) {
    setActiveConsoleTab(tab);

    document.querySelectorAll('[data-console-tab]').forEach(button => {
        button.classList.toggle('active', button.getAttribute('data-console-tab') === tab);
    });

    const runView = document.getElementById('runConsoleView');
    const debugView = document.getElementById('debugConsoleView');

    if (runView) runView.classList.toggle('active', tab === 'run');
    if (debugView) debugView.classList.toggle('active', tab === 'debug');
}

function setDebugUiRunning(running, statusText = '') {
    const startBtn = document.getElementById('startDebugBtn');
    const actionGroup = document.getElementById('debugActionGroup');
    const continueBtn = document.getElementById('debugContinueBtn');
    const stepBtn = document.getElementById('debugStepBtn');
    const stopBtn = document.getElementById('debugStopBtn');
    const statusBadge = document.getElementById('debugStatusBadge');

    if (startBtn) startBtn.style.display = running ? 'none' : '';
    if (actionGroup) actionGroup.style.display = running ? 'flex' : 'none';
    if (continueBtn) continueBtn.disabled = !running;
    if (stepBtn) stepBtn.disabled = !running;
    if (stopBtn) stopBtn.disabled = !running;
    if (statusBadge) statusBadge.textContent = statusText || (running ? '调试中' : '未调试');
}

function renderDebugState(debugState) {
    const currentNodeBox = document.getElementById('debugCurrentNodeBox');
    const stackBox = document.getElementById('debugStackBox');
    const varsBox = document.getElementById('debugVarsBox');

    if (currentNodeBox) currentNodeBox.textContent = debugState?.currentNodeText || '（未开始调试）';
    if (stackBox) stackBox.textContent = debugState?.stackText || '（未开始调试）';
    if (varsBox) varsBox.textContent = debugState?.varsText || '（未开始调试）';

    setDebugCurrentNodeId(debugState?.currentId ?? null);
    renderCanvas();
    setDebugUiRunning(Boolean(debugSessionId), debugState?.statusText || (debugSessionId ? '调试中' : '未调试'));
}

function appendDebugSnapshot(debugState, title) {
    if (!debugState) return;

    const lines = [];
    if (title) lines.push(title);

    if (debugState.currentNode) {
        const node = debugState.currentNode;
        lines.push(`暂停在节点: ${node.name} (#${node.id}, ${node.type})`);
    } else {
        lines.push('当前没有可执行节点，调试会话已结束。');
    }

    if (debugState.loopText) {
        lines.push(`循环上下文: ${debugState.loopText}`);
    }

    addConsoleLog(lines.join('\n'), 'debug', 'debug');
}

async function runWorkflow() {
    setConsoleTab('run');

    const data = { nodes: Array.from(state.nodes.values()) };
    try {
        const response = await fetch('/api/workflow/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.logs && result.logs.length) {
            displayLogs(result.logs);
        } else {
            clearConsole('run');
            addConsoleLog('执行完成，无输出日志', 'run', 'run');
        }
    } catch (e) {
        addConsoleLog(`执行时发生错误: ${e.message}`, 'error', 'run');
    }
}

async function debugStart() {
    setConsoleTab('debug');
    clearConsole('debug');

    const data = { nodes: Array.from(state.nodes.values()) };

    try {
        const resp = await fetch('/api/debug/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json();

        if (!resp.ok) {
            addConsoleLog(`进入调试失败: ${result.error || resp.status}`, 'error', 'debug');
            return;
        }

        debugSessionId = result.session_id;
        renderDebugState(result.state);
        addConsoleLog('已进入调试模式，可以开始单步执行或继续运行。', 'info', 'debug');
        appendDebugSnapshot(result.state, '调试已就绪');
    } catch (e) {
        addConsoleLog(`进入调试失败: ${e.message}`, 'error', 'debug');
    }
}

async function runDebugAction(endpoint, failLabel, snapshotTitle) {
    if (!debugSessionId) return;

    try {
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: debugSessionId })
        });
        const result = await resp.json();

        if (!resp.ok) {
            addConsoleLog(`${failLabel}: ${result.error || resp.status}`, 'error', 'debug');
            return;
        }

        setConsoleTab('debug');

        if (Array.isArray(result.logs)) {
            result.logs.forEach(line => addConsoleLog(line, 'run', 'debug'));
        }

        renderDebugState(result.state);
        appendDebugSnapshot(result.state, snapshotTitle);

        if (result.finished) {
            debugSessionId = null;
            renderDebugState(result.state);
            addConsoleLog('调试已结束。', 'info', 'debug');
        }
    } catch (e) {
        addConsoleLog(`${failLabel}: ${e.message}`, 'error', 'debug');
    }
}

async function debugStep() {
    await runDebugAction('/api/debug/step', '单步执行失败', '单步执行后暂停');
}

async function debugContinue() {
    await runDebugAction('/api/debug/continue', '继续执行失败', '继续执行后暂停');
}

async function debugStop() {
    if (!debugSessionId) return;

    try {
        await fetch('/api/debug/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: debugSessionId })
        });
    } catch (e) {
        addConsoleLog(`停止调试时发生错误: ${e.message}`, 'error', 'debug');
    }

    debugSessionId = null;
    renderDebugState(null);
    setConsoleTab('debug');
    addConsoleLog('调试已手动停止。', 'info', 'debug');
}

function initDemoFlow() {
    const start = createNode('start', 50, 80);
    const print1 = createNode('print', 280, 80);
    print1.properties.message = '开始执行农业监测任务';

    const loopNode = createNode('loop', 280, 220);
    loopNode.properties.loopCount = 2;

    const innerPrint = createNode('print', 500, 150);
    innerPrint.properties.message = '循环体内部：检查土壤湿度';

    const branchNode = createNode('branch', 500, 320);
    branchNode.properties.branchCondition = true;

    const truePrint = createNode('print', 740, 280);
    truePrint.properties.message = '条件满足：开启灌溉阀门';

    const falsePrint = createNode('print', 740, 400);
    falsePrint.properties.message = '条件不满足：保持待机';

    start.properties.nextNodeId = print1.id;
    print1.properties.nextNodeId = loopNode.id;

    loopNode.properties.bodyNodeIds = [innerPrint.id];
    innerPrint.parentId = loopNode.id;
    innerPrint.localX = 20;
    innerPrint.localY = 20;
    loopNode.properties.nextNodeId = branchNode.id;

    branchNode.properties.trueBodyNodeIds = [truePrint.id];
    branchNode.properties.falseBodyNodeIds = [falsePrint.id];

    truePrint.parentId = branchNode.id;
    truePrint.properties.branchSide = 'true';
    truePrint.localX = 20;
    truePrint.localY = 28;

    falsePrint.parentId = branchNode.id;
    falsePrint.properties.branchSide = 'false';
    falsePrint.localX = 20;
    falsePrint.localY = 28;

    [start, print1, loopNode, innerPrint, branchNode, truePrint, falsePrint].forEach(node => {
        state.nodes.set(node.id, node);
    });

    resetCanvasHistory();
    renderCanvas();
    addConsoleLog('已加载示例工作流，可直接运行或进入调试模式查看效果。', 'info', 'run');
}

function bindConsoleTabs() {
    document.querySelectorAll('[data-console-tab]').forEach(button => {
        button.onclick = () => {
            const tab = button.getAttribute('data-console-tab');
            if (tab) setConsoleTab(tab);
        };
    });
}

function bindGlobalButtons() {
    const runBtn = document.getElementById('runWorkflowBtn');
    const clearBtn = document.getElementById('clearConsoleBtn');
    const startDebugBtn = document.getElementById('startDebugBtn');
    const debugContinueBtn = document.getElementById('debugContinueBtn');
    const debugStepBtn = document.getElementById('debugStepBtn');
    const debugStopBtn = document.getElementById('debugStopBtn');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const clearCanvasBtn = document.getElementById('clearCanvasBtn');

    if (runBtn) runBtn.onclick = runWorkflow;
    if (clearBtn) {
        clearBtn.onclick = () => clearConsole(state.activeConsoleTab);
    }
    if (startDebugBtn) startDebugBtn.onclick = debugStart;
    if (debugContinueBtn) debugContinueBtn.onclick = debugContinue;
    if (debugStepBtn) debugStepBtn.onclick = debugStep;
    if (debugStopBtn) debugStopBtn.onclick = debugStop;

    if (deleteSelectedBtn) {
        deleteSelectedBtn.onclick = () => {
            deleteSelectedNodes();
        };
    }

    if (clearCanvasBtn) {
        clearCanvasBtn.onclick = () => {
            showModal({
                title: '清空画布',
                bodyHtml: '<div>将删除所有节点与连线，且无法恢复，确认继续吗？</div>',
                okText: '确认清空',
                cancelText: '取消',
                onOk: () => {
                    const beforeSnapshot = captureCanvasHistorySnapshot();
                    state.nodes.clear();
                    state.nextId = 100;
                    setDebugCurrentNodeId(null);
                    commitCanvasHistorySnapshot(beforeSnapshot);
                    renderCanvas();
                    setSelectedNode(null);
                    renderDebugState(null);
                    updateCanvasToolbarUi();
                }
            });
        };
    }
}

function isFormEditingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function bindCanvasShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (isFormEditingTarget(e.target)) return;

        if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
            const key = e.key.toLowerCase();
            if (key === 'z') {
                e.preventDefault();
                if (undoCanvasChange()) updateCanvasToolbarUi();
                return;
            }
            if (key === 'c') {
                e.preventDefault();
                copySelectedNodes();
                return;
            }
            if (key === 'x') {
                e.preventDefault();
                cutSelectedNodes();
                return;
            }
            if (key === 'v') {
                e.preventDefault();
                pasteClipboardNodes();
                return;
            }
        }

        if ((e.key === 'Delete' || e.key === 'Backspace') && (state.selectedNodeIds?.length || state.selectedNodeId)) {
            e.preventDefault();
            deleteSelectedNodes();
        }
    });
}

export function init() {
    prepareDebugToolbar();
    prepareConsolePanel();
    ensureCanvasToolbarExtras();
    initComponentLibrary();
    initDragDrop();
    bindCanvasZoomInteractions();
    initDemoFlow();
    initFileMenu();
    initProjectMenu();
    initSettingsMenu();
    initWindowMenu();
    bindConsoleTabs();
    bindGlobalButtons();
    bindCanvasToolbar();
    bindCanvasShortcuts();
    setConsoleTab(state.activeConsoleTab);
    updateCanvasToolbarUi();
    renderDebugState(null);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

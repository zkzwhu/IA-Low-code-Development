import { state, setActiveCanvasTool, setActiveConsoleTab, setCanvasZoom, setDebugCurrentNodeId } from './appStore.js';
import { addConsoleLog, clearConsole, displayLogs, showModal } from './appUtils.js';
import { autoArrangeNodes, canUndoCanvasChange, captureCanvasHistorySnapshot, commitCanvasHistorySnapshot, copySelectedNodes, createNode, cutSelectedNodes, deleteSelectedNodes, pasteClipboardNodes, placeNodeWithoutOverlapById, renderCanvas, undoCanvasChange } from './nodeManager.js';
import { initFileMenu } from './menuFile.js';
import { initProjectMenu } from './menuProject.js';
import { initSettingsMenu } from './menuSettings.js';
import { initWindowMenu } from './menuWindow.js';
import { saveWorkflowRuntime } from './workflowRuntimeStore.js';
import { initializeWorkflowProjectFromEntry, startWorkflowAutoSave } from './workflowProjectService.js';

let debugSessionId = null;
const ALLOWED_NODE_TYPES = new Set(['start', 'print', 'sequence', 'loop', 'branch', 'output']);
const MIN_CANVAS_ZOOM = 0.5;
const MAX_CANVAS_ZOOM = 2;
const CANVAS_ZOOM_STEP = 0.1;
const COMPONENT_LIBRARY = [
    {
        id: 'entry',
        title: '流程入口',
        description: '用于开始执行工作流。',
        icon: '🚀',
        expanded: true,
        items: [
            { type: 'start', icon: '🟢', title: '开始节点', desc: '工作流的起点。' }
        ]
    },
    {
        id: 'logic',
        title: '流程逻辑',
        description: '控制顺序、循环与分支。',
        icon: '🧠',
        expanded: true,
        items: [
            { type: 'print', icon: '🖨️', title: '打印节点', desc: '输出文本或变量值。' },
            { type: 'sequence', icon: '➡️', title: '顺序节点', desc: '占位或串联执行流程。' },
            { type: 'loop', icon: '🔁', title: '循环节点', desc: '重复执行循环体。' },
            { type: 'branch', icon: '🔀', title: '分支节点', desc: '根据条件选择路径。' }
        ]
    },
    {
        id: 'data',
        title: '变量与输出',
        description: '让工作流结果可以被大屏应用绑定。',
        icon: '📦',
        expanded: true,
        items: [
            { type: 'output', icon: '📤', title: '输出端口节点', desc: '引用本地变量并暴露给项目端口。' }
        ]
    }
];
const expandedComponentGroups = new Set(
    COMPONENT_LIBRARY.filter(group => group.expanded !== false).map(group => group.id)
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

        if (expandedComponentGroups.has(groupId)) expandedComponentGroups.delete(groupId);
        else expandedComponentGroups.add(groupId);

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
        select: { label: '选择', tip: '选择节点或拖动节点位置，按住 Alt 再拖动画布。' },
        connect: { label: '连接', tip: '从节点右侧端口拖到目标节点，创建连接。' },
        zoom: { label: '缩放', tip: '单击放大，按住 Shift 单击缩小，也可滚轮缩放。' },
        delete: { label: '删除', tip: '点击删除节点，或拖动鼠标扫过多个节点删除。' },
        arrange: { label: '整理', tip: '按执行逻辑自动整理根节点布局。' },
        undo: { label: '撤回', tip: '撤回上一步画布修改。' },
        copy: { label: '复制', tip: '复制当前选中的节点。' },
        cut: { label: '剪切', tip: '剪切当前选中的节点。' },
        paste: { label: '粘贴', tip: '将剪贴板中的节点粘贴到当前视图。' }
    };
    const toolText = {
        select: '选择模式：拖动节点修改位置，按住 Alt 再拖动画布。',
        connect: '连接模式：从节点右侧端口拖到目标节点建立连接。',
        zoom: `缩放模式：滚轮或点击缩放，当前 ${Math.round((state.canvasZoom || 1) * 100)}%。`,
        delete: '删除模式：点击删除节点，或按住左键扫过多个节点删除。'
    };

    const applyMeta = (id, metaKey) => {
        const button = document.getElementById(id);
        const meta = toolMeta[metaKey];
        if (!button || !meta) return;
        button.textContent = meta.label;
        button.setAttribute('title', meta.tip);
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
    const copyBtn = document.getElementById('copyCanvasBtn');
    const cutBtn = document.getElementById('cutCanvasBtn');
    const pasteBtn = document.getElementById('pasteCanvasBtn');

    if (arrangeBtn) {
        arrangeBtn.onclick = () => {
            autoArrangeNodes();
            updateCanvasToolbarUi();
            addConsoleLog('已按执行逻辑整理节点布局。', 'info', 'run');
        };
    }
    if (undoBtn) undoBtn.onclick = () => {
        if (undoCanvasChange()) updateCanvasToolbarUi();
    };
    if (copyBtn) copyBtn.onclick = () => copySelectedNodes();
    if (cutBtn) cutBtn.onclick = () => cutSelectedNodes();
    if (pasteBtn) pasteBtn.onclick = () => pasteClipboardNodes();
}

function prepareDebugToolbar() {
    const topRight = document.querySelector('.top-right');
    if (!topRight) return;

    topRight.innerHTML = `
        <div class="project-badge" id="currentProjectBadge">未命名工作流</div>
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
                            <div class="debug-section-title">执行栈 / 上下文</div>
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
        addConsoleLog('画布区域未找到，拖拽功能可能失效。', 'error');
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
            addConsoleLog(`创建节点失败：${type}`, 'error');
            return;
        }

        state.nodes.set(newNode.id, newNode);
        placeNodeWithoutOverlapById(newNode.id, { x, y });
        commitCanvasHistorySnapshot(beforeSnapshot);
        renderCanvas();
        const componentItem = getComponentLibraryItem(type);
        addConsoleLog(`已添加 ${componentItem?.title || type}，ID: ${newNode.id}`, 'info');
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
        lines.push(`暂停在节点 ${node.name} (#${node.id}, ${node.type})`);
    } else {
        lines.push('当前没有可执行节点，调试会话已经结束。');
    }

    if (debugState.loopText) lines.push(`循环上下文：${debugState.loopText}`);
    addConsoleLog(lines.join('\n'), 'debug', 'debug');
}

function buildWorkflowPayload() {
    return {
        nodes: Array.from(state.nodes.values()),
        workflow_variables: state.workflowVariables || [],
        workflow_ports: state.workflowPorts || []
    };
}

async function runWorkflow() {
    setConsoleTab('run');

    try {
        const response = await fetch('/api/workflow/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildWorkflowPayload())
        });
        const result = await response.json();
        if (response.ok && state.currentProject?.id) {
            const portValuesByName = result?.port_values && typeof result.port_values === 'object'
                ? result.port_values
                : {};
            const portValuesById = {};

            for (const port of state.workflowPorts || []) {
                const portId = String(port?.id || '');
                const portName = String(port?.name || '').trim();
                if (!portId || !portName) continue;
                if (Object.prototype.hasOwnProperty.call(portValuesByName, portName)) {
                    portValuesById[portId] = portValuesByName[portName];
                }
            }

            saveWorkflowRuntime(state.currentProject.id, {
                portValuesById,
                portValuesByName
            });
        }
        if (result.logs && result.logs.length) {
            displayLogs(result.logs);
        } else {
            clearConsole('run');
            addConsoleLog('执行完成，无输出日志。', 'run', 'run');
        }
    } catch (e) {
        addConsoleLog(`执行时发生错误：${e.message}`, 'error', 'run');
    }
}

async function debugStart() {
    setConsoleTab('debug');
    clearConsole('debug');

    try {
        const resp = await fetch('/api/debug/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildWorkflowPayload())
        });
        const result = await resp.json();

        if (!resp.ok) {
            addConsoleLog(`进入调试失败：${result.error || resp.status}`, 'error', 'debug');
            return;
        }

        debugSessionId = result.session_id;
        renderDebugState(result.state);
        addConsoleLog('已进入调试模式，可以开始单步执行或继续运行。', 'info', 'debug');
        appendDebugSnapshot(result.state, '调试已就绪');
    } catch (e) {
        addConsoleLog(`进入调试失败：${e.message}`, 'error', 'debug');
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
            addConsoleLog(`${failLabel}：${result.error || resp.status}`, 'error', 'debug');
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
        addConsoleLog(`${failLabel}：${e.message}`, 'error', 'debug');
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
        addConsoleLog(`停止调试时发生错误：${e.message}`, 'error', 'debug');
    }

    debugSessionId = null;
    renderDebugState(null);
    setConsoleTab('debug');
    addConsoleLog('调试已手动停止。', 'info', 'debug');
}

function initializeProjectData() {
    initializeWorkflowProjectFromEntry();
}

function updateCurrentProjectBadge() {
    const badge = document.getElementById('currentProjectBadge');
    if (!badge) return;
    badge.textContent = state.currentProject?.name || '未命名工作流';
    badge.title = state.currentProject?.name || '未命名工作流';
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
    if (clearBtn) clearBtn.onclick = () => clearConsole(state.activeConsoleTab);
    if (startDebugBtn) startDebugBtn.onclick = debugStart;
    if (debugContinueBtn) debugContinueBtn.onclick = debugContinue;
    if (debugStepBtn) debugStepBtn.onclick = debugStep;
    if (debugStopBtn) debugStopBtn.onclick = debugStop;
    if (deleteSelectedBtn) deleteSelectedBtn.onclick = () => deleteSelectedNodes();

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
    initializeProjectData();
    updateCurrentProjectBadge();
    window.addEventListener('workflow-project-changed', updateCurrentProjectBadge);
    startWorkflowAutoSave();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

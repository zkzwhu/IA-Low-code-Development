import { state } from './store.js';
import { addConsoleLog, clearConsole, displayLogs } from './utils.js';
import { createNode, renderCanvas, setSelectedNode } from './nodeManager.js';
import { initFileMenu } from './menuFile.js';
import { initProjectMenu } from './menuProject.js';
import { initSettingsMenu } from './menuSettings.js';
import { initWindowMenu } from './menuWindow.js';
import { deleteNodeById } from './nodeManager.js';
import { showModal } from './utils.js';

// 拖拽添加组件（增强版）
function initDragDrop() {
    const comps = document.querySelectorAll(".comp-item");
    const canvasArea = document.getElementById("canvasArea");

    if (!canvasArea) {
        console.error("canvasArea 元素不存在！");
        addConsoleLog("画布区域未找到，拖拽功能可能失效", "error");
        return;
    }

    // 为每个组件绑定 dragstart
    comps.forEach(comp => {
        comp.addEventListener("dragstart", (e) => {
            const type = comp.getAttribute("data-type");
            if (!type) return;
            e.dataTransfer.setData("text/plain", type);
            e.dataTransfer.effectAllowed = "copy";
            console.log(`拖拽开始：${type}`);
        });
    });

    // 必须阻止 dragover 默认行为
    canvasArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });

    // drop 事件：真正添加节点
    canvasArea.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();   // 防止冒泡干扰

        const type = e.dataTransfer.getData("text/plain");
        if (!type) {
            console.warn("drop 事件未获取到数据类型");
            return;
        }

        // 计算放置位置（相对于 canvasArea）
        const rect = canvasArea.getBoundingClientRect();
        let x = e.clientX - rect.left - 90;   // 节点宽度一半偏移
        let y = e.clientY - rect.top - 40;    // 节点高度一半偏移
        x = Math.max(20, Math.min(x, rect.width - 200));
        y = Math.max(20, Math.min(y, rect.height - 100));

        console.log(`创建节点：类型=${type}, 坐标=(${x},${y})`);

        const newNode = createNode(type, x, y);
        if (!newNode) {
            addConsoleLog(`创建节点失败：类型 ${type}`, "error");
            return;
        }

        state.nodes.set(newNode.id, newNode);
        renderCanvas();               // 重新渲染画布
        setSelectedNode(newNode.id); // 自动选中新节点
        addConsoleLog(`✅ 添加 ${type} 节点, ID:${newNode.id}`, "info");
    });
}

// 运行工作流（调用后端API）
async function runWorkflow() {
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
            addConsoleLog("执行完成，无输出日志", "run");
        }
    } catch (e) {
        addConsoleLog("执行时发生错误: " + e.message, "error");
    }
}

// 调试：会话状态
let debugSessionId = null;

function setDebugUiRunning(running) {
    const panel = document.getElementById("debugPanel");
    if (panel) panel.style.display = running ? "flex" : "none";
    const cont = document.getElementById("debugContinueBtn");
    const step = document.getElementById("debugStepBtn");
    const stop = document.getElementById("debugStopBtn");
    if (cont) cont.disabled = !running;
    if (step) step.disabled = !running;
    if (stop) stop.disabled = !running;
}

function renderDebugState(st) {
    const stackBox = document.getElementById("debugStackBox");
    const varsBox = document.getElementById("debugVarsBox");
    if (stackBox) stackBox.textContent = st?.stackText || "(空)";
    if (varsBox) varsBox.textContent = st?.varsText || "(空)";
}

async function debugStart() {
    const data = { nodes: Array.from(state.nodes.values()) };
    const resp = await fetch('/api/debug/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const r = await resp.json();
    if (!resp.ok) {
        addConsoleLog("进入调试失败: " + (r.error || resp.status), "error");
        return;
    }
    debugSessionId = r.session_id;
    setDebugUiRunning(true);
    renderDebugState(r.state);
    addConsoleLog("🐞 已进入调试模式", "info");
}

async function debugStep() {
    if (!debugSessionId) return;
    const resp = await fetch('/api/debug/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: debugSessionId })
    });
    const r = await resp.json();
    if (!resp.ok) {
        addConsoleLog("单步失败: " + (r.error || resp.status), "error");
        return;
    }
    if (r.logs) r.logs.forEach(line => addConsoleLog(line, "run"));
    renderDebugState(r.state);
    if (r.finished) {
        addConsoleLog("调试已结束", "info");
        debugSessionId = null;
        setDebugUiRunning(false);
    }
}

async function debugContinue() {
    if (!debugSessionId) return;
    const resp = await fetch('/api/debug/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: debugSessionId })
    });
    const r = await resp.json();
    if (!resp.ok) {
        addConsoleLog("继续失败: " + (r.error || resp.status), "error");
        return;
    }
    if (r.logs) r.logs.forEach(line => addConsoleLog(line, "run"));
    renderDebugState(r.state);
    if (r.finished) {
        addConsoleLog("调试已结束", "info");
        debugSessionId = null;
        setDebugUiRunning(false);
    }
}

async function debugStop() {
    if (!debugSessionId) return;
    await fetch('/api/debug/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: debugSessionId })
    });
    debugSessionId = null;
    setDebugUiRunning(false);
    renderDebugState(null);
    addConsoleLog("已停止调试", "info");
}

// 初始化示例工作流
function initDemoFlow() {
    const start = createNode("start", 50, 80);
    const print1 = createNode("print", 280, 80);
    print1.properties.message = "开始执行农业监测任务";
    const loopNode = createNode("loop", 280, 220);
    loopNode.properties.loopCount = 2;
    const innerPrint = createNode("print", 500, 150);
    innerPrint.properties.message = "🔁 循环体内部: 检查土壤湿度";
    const branchNode = createNode("branch", 500, 320);
    branchNode.properties.branchCondition = true;
    const truePrint = createNode("print", 740, 280);
    truePrint.properties.message = "✅ 条件满足: 开启灌溉阀门";
    const falsePrint = createNode("print", 740, 400);
    falsePrint.properties.message = "❌ 条件不满足: 保持待机";

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
    truePrint.properties.branchSide = "true";
    truePrint.localX = 20;
    truePrint.localY = 28;
    falsePrint.parentId = branchNode.id;
    falsePrint.properties.branchSide = "false";
    falsePrint.localX = 20;
    falsePrint.localY = 28;

    [start, print1, loopNode, innerPrint, branchNode, truePrint, falsePrint].forEach(n => state.nodes.set(n.id, n));
    renderCanvas();
    addConsoleLog("已加载示例工作流 (包含循环+分支)，点击运行按钮查看控制台效果", "info");
}

// 绑定全局按钮
function bindGlobalButtons() {
    const runBtn = document.getElementById("runWorkflowBtn");
    const clearBtn = document.getElementById("clearConsoleBtn");
    if (runBtn) runBtn.onclick = runWorkflow;
    if (clearBtn) clearBtn.onclick = clearConsole;

    const delBtn = document.getElementById("deleteSelectedBtn");
    if (delBtn) delBtn.onclick = () => {
        if (!state.selectedNodeId) return;
        deleteNodeById(state.selectedNodeId);
    };

    const clearCanvasBtn = document.getElementById("clearCanvasBtn");
    if (clearCanvasBtn) clearCanvasBtn.onclick = () => {
        showModal({
            title: "清空画布",
            bodyHtml: `<div>将删除所有节点与连线（不可恢复），确定清空吗？</div>`,
            okText: "确定清空",
            cancelText: "取消",
            onOk: () => {
                state.nodes.clear();
                state.nextId = 100;
                renderCanvas();
                setSelectedNode(null);
            }
        });
    };

    const startDebugBtn = document.getElementById("startDebugBtn");
    const debugContinueBtn = document.getElementById("debugContinueBtn");
    const debugStepBtn = document.getElementById("debugStepBtn");
    const debugStopBtn = document.getElementById("debugStopBtn");
    if (startDebugBtn) startDebugBtn.onclick = debugStart;
    if (debugContinueBtn) debugContinueBtn.onclick = debugContinue;
    if (debugStepBtn) debugStepBtn.onclick = debugStep;
    if (debugStopBtn) debugStopBtn.onclick = debugStop;
}

// 初始化所有模块
export function init() {
    console.log("初始化开始...");
    initDragDrop();
    initDemoFlow();
    initFileMenu();
    initProjectMenu();
    initSettingsMenu();
    initWindowMenu();
    bindGlobalButtons();
    console.log("初始化完成");
}

// 等待 DOM 加载完成后启动
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init(); // DOM 已就绪，直接执行
}

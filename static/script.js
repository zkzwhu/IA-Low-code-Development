// ---------- 全局变量 ----------
let nodes = new Map();          // id -> node对象
let nextId = 100;
let selectedNodeId = null;
let dragOffsetX = 0, dragOffsetY = 0;
let isDraggingNode = false;
let currentNodeMoving = null;

// 连线拖拽相关
let isDraggingConnection = false;
let draggingFromNodeId = null;
let tempLine = null;          // 临时连线SVG元素

// 控制台输出模式: 'detail' 或 'result'
let consoleMode = 'detail';

// ---------- 辅助函数 ----------
function addConsoleLog(msg, type = "info") {
    const consoleDiv = document.getElementById("consoleOutput");
    const line = document.createElement("div");
    line.className = "log-line";
    const prefix = type === "error" ? "❌ " : (type === "run" ? "🚀 " : "📌 ");
    line.innerHTML = `<span style="color:#aaffdd;">[${new Date().toLocaleTimeString()}]</span> ${prefix}${msg}`;
    consoleDiv.appendChild(line);
    line.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearConsole() {
    const consoleDiv = document.getElementById("consoleOutput");
    consoleDiv.innerHTML = '<div class="log-line">✨ 控制台已清空</div>';
}

// 显示日志（根据模式过滤）
function displayLogs(logs) {
    clearConsole();
    if (consoleMode === 'detail') {
        logs.forEach(log => addConsoleLog(log, "run"));
    } else {
        // 仅结果：只显示开始、结束和打印消息，过滤掉执行节点详情
        const filtered = logs.filter(line => {
            return line.includes("==========") ||
                   line.includes("打印:") ||
                   line.includes("错误") ||
                   line.includes("警告");
        });
        if (filtered.length === 0) filtered.push("执行完成，无输出日志");
        filtered.forEach(log => addConsoleLog(log, "run"));
    }
}

// 创建新节点
function createNode(type, x, y) {
    const id = nextId++;
    const baseNode = {
        id: id,
        type: type,
        x: x,
        y: y,
        properties: {}
    };
    switch(type) {
        case 'start':
            baseNode.properties = { nextNodeId: null, name: "开始" };
            break;
        case 'print':
            baseNode.properties = { message: "Hello, 智慧农业", nextNodeId: null };
            break;
        case 'sequence':
            baseNode.properties = { comment: "顺序执行", nextNodeId: null };
            break;
        case 'loop':
            baseNode.properties = { loopCount: 3, bodyStartId: null, afterLoopId: null, nextNodeId: null };
            break;
        case 'branch':
            baseNode.properties = { branchCondition: true, trueBranchId: null, falseBranchId: null, nextNodeId: null };
            break;
        default: break;
    }
    return baseNode;
}

// 渲染所有节点和连线
function renderCanvas() {
    const canvasDiv = document.getElementById("canvas");
    // 移除所有节点元素（保留svg）
    const nodesDivs = canvasDiv.querySelectorAll('.flow-node');
    nodesDivs.forEach(div => div.remove());

    for(let node of nodes.values()) {
        const nodeDiv = document.createElement("div");
        nodeDiv.className = "flow-node";
        if(selectedNodeId === node.id) nodeDiv.classList.add("selected");
        nodeDiv.style.left = node.x + "px";
        nodeDiv.style.top = node.y + "px";
        nodeDiv.style.position = "absolute";
        nodeDiv.setAttribute("data-id", node.id);

        let typeLabel = "";
        switch(node.type) {
            case 'start': typeLabel = "开始"; break;
            case 'print': typeLabel = "打印"; break;
            case 'sequence': typeLabel = "顺序"; break;
            case 'loop': typeLabel = "循环"; break;
            case 'branch': typeLabel = "分支"; break;
            default: typeLabel = node.type;
        }
        let bodyPreview = "";
        if(node.type === 'print') bodyPreview = `✉️ ${node.properties.message?.substring(0, 20) || "打印"}`;
        else if(node.type === 'loop') bodyPreview = `🔄 次数: ${node.properties.loopCount}`;
        else if(node.type === 'branch') bodyPreview = `🌿 条件: ${node.properties.branchCondition ? "真分支" : "假分支"}`;
        else if(node.type === 'start') bodyPreview = "入口节点";
        else bodyPreview = node.properties.comment || "顺序节点";

        nodeDiv.innerHTML = `
            <div class="node-header">
                <span>${typeLabel}</span>
                <span class="node-type-badge">ID:${node.id}</span>
                <button class="delete-node-btn" data-id="${node.id}">🗑️</button>
            </div>
            <div class="node-body">
                ${bodyPreview}
                <div class="connect-point" data-id="${node.id}"></div>
            </div>
        `;
        nodeDiv.addEventListener("click", (e) => {
            e.stopPropagation();
            if(e.target.classList.contains("delete-node-btn")) {
                deleteNodeById(node.id);
                return;
            }
            setSelectedNode(node.id);
        });
        // 拖拽移动节点
        nodeDiv.addEventListener("mousedown", (e) => {
            if(e.target.classList.contains("delete-node-btn") || e.target.classList.contains("connect-point")) return;
            e.stopPropagation();
            isDraggingNode = true;
            currentNodeMoving = node.id;
            const rect = nodeDiv.getBoundingClientRect();
            const containerRect = canvasDiv.parentElement.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            nodeDiv.style.cursor = "grabbing";
            e.preventDefault();
        });
        canvasDiv.appendChild(nodeDiv);
    }

    // 绑定连接点拖拽事件
    document.querySelectorAll('.connect-point').forEach(point => {
        point.addEventListener('mousedown', onConnectPointMouseDown);
    });

    // 全局鼠标移动释放
    document.removeEventListener("mousemove", onGlobalMouseMove);
    document.removeEventListener("mouseup", onGlobalMouseUp);
    document.addEventListener("mousemove", onGlobalMouseMove);
    document.addEventListener("mouseup", onGlobalMouseUp);

    drawConnections();
}

function onGlobalMouseMove(e) {
    if (isDraggingNode && currentNodeMoving !== null) {
        const node = nodes.get(currentNodeMoving);
        if (!node) return;
        const canvasDiv = document.getElementById("canvas");
        const containerRect = canvasDiv.parentElement.getBoundingClientRect();
        let newX = e.clientX - dragOffsetX - containerRect.left;
        let newY = e.clientY - dragOffsetY - containerRect.top;
        newX = Math.max(5, Math.min(newX, containerRect.width - 180));
        newY = Math.max(5, Math.min(newY, containerRect.height - 80));
        node.x = newX;
        node.y = newY;
        renderCanvas();
    } else if (isDraggingConnection && draggingFromNodeId !== null) {
        // 更新临时连线
        const canvasDiv = document.getElementById("canvas");
        const containerRect = canvasDiv.parentElement.getBoundingClientRect();
        const sourceNode = nodes.get(draggingFromNodeId);
        if (sourceNode) {
            const sourceElem = canvasDiv.querySelector(`.flow-node[data-id="${draggingFromNodeId}"]`);
            if (sourceElem) {
                const sourceRect = sourceElem.getBoundingClientRect();
                const startX = sourceRect.right - containerRect.left - 5;
                const startY = sourceRect.top + sourceRect.height/2 - containerRect.top;
                const endX = e.clientX - containerRect.left;
                const endY = e.clientY - containerRect.top;
                if (!tempLine) {
                    const svg = document.getElementById("connectionsSvg");
                    tempLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    tempLine.setAttribute("stroke", "#e67e22");
                    tempLine.setAttribute("stroke-width", "2");
                    tempLine.setAttribute("stroke-dasharray", "5,5");
                    tempLine.setAttribute("fill", "none");
                    svg.appendChild(tempLine);
                }
                tempLine.setAttribute("x1", startX);
                tempLine.setAttribute("y1", startY);
                tempLine.setAttribute("x2", endX);
                tempLine.setAttribute("y2", endY);
            }
        }
    }
}

function onGlobalMouseUp(e) {
    if (isDraggingNode) {
        isDraggingNode = false;
        currentNodeMoving = null;
        renderCanvas();
    }
    if (isDraggingConnection && draggingFromNodeId !== null) {
        // 释放时查找目标节点
        const targetElem = document.elementsFromPoint(e.clientX, e.clientY).find(el => el.classList && el.classList.contains('flow-node'));
        if (targetElem) {
            const targetId = parseInt(targetElem.getAttribute('data-id'));
            if (targetId && targetId !== draggingFromNodeId) {
                createConnection(draggingFromNodeId, targetId);
            }
        }
        // 清理临时连线
        if (tempLine) {
            tempLine.remove();
            tempLine = null;
        }
        isDraggingConnection = false;
        draggingFromNodeId = null;
    }
}

function onConnectPointMouseDown(e) {
    e.stopPropagation();
    const nodeId = parseInt(e.target.getAttribute('data-id'));
    if (nodeId) {
        isDraggingConnection = true;
        draggingFromNodeId = nodeId;
    }
}

// 创建连接（弹出选择框）
function createConnection(sourceId, targetId) {
    const sourceNode = nodes.get(sourceId);
    const targetNode = nodes.get(targetId);
    if (!sourceNode || !targetNode) return;

    // 根据源节点类型提供可连接的字段
    let fieldOptions = [];
    if (sourceNode.type === 'start' || sourceNode.type === 'print' || sourceNode.type === 'sequence') {
        fieldOptions = ['nextNodeId'];
    } else if (sourceNode.type === 'loop') {
        fieldOptions = ['bodyStartId', 'afterLoopId', 'nextNodeId'];
    } else if (sourceNode.type === 'branch') {
        fieldOptions = ['trueBranchId', 'falseBranchId', 'nextNodeId'];
    } else {
        fieldOptions = ['nextNodeId'];
    }

    if (fieldOptions.length === 1) {
        // 直接设置
        sourceNode.properties[fieldOptions[0]] = targetId;
        addConsoleLog(`连接: ${sourceId} → ${targetId} (${fieldOptions[0]})`, "info");
    } else {
        // 弹出选择
        const choice = prompt(`请选择连接类型:\n${fieldOptions.join(', ')}`, fieldOptions[0]);
        if (choice && fieldOptions.includes(choice)) {
            sourceNode.properties[choice] = targetId;
            addConsoleLog(`连接: ${sourceId} → ${targetId} (${choice})`, "info");
        }
    }
    renderCanvas();
}

function deleteNodeById(id) {
    if(nodes.has(id)) {
        // 清除其他节点对该节点的引用
        for(let node of nodes.values()) {
            if(node.type === 'loop') {
                if(node.properties.bodyStartId === id) node.properties.bodyStartId = null;
                if(node.properties.afterLoopId === id) node.properties.afterLoopId = null;
            }
            if(node.type === 'branch') {
                if(node.properties.trueBranchId === id) node.properties.trueBranchId = null;
                if(node.properties.falseBranchId === id) node.properties.falseBranchId = null;
            }
            if(node.properties.nextNodeId === id) node.properties.nextNodeId = null;
        }
        nodes.delete(id);
        if(selectedNodeId === id) setSelectedNode(null);
        renderCanvas();
        addConsoleLog(`删除节点 ID:${id}`, "info");
    }
}

function setSelectedNode(id) {
    selectedNodeId = id;
    renderCanvas();
    renderPropertiesPanel();
}

function renderPropertiesPanel() {
    const propDiv = document.getElementById("propContent");
    if(!selectedNodeId || !nodes.has(selectedNodeId)) {
        propDiv.innerHTML = '<div class="help-text">点击画布中的节点查看并修改属性</div>';
        return;
    }
    const node = nodes.get(selectedNodeId);
    const props = node.properties;
    let html = `<div class="prop-group"><div class="prop-label">节点类型: <strong>${node.type}</strong> (ID:${node.id})</div></div>`;

    const allNodeOptions = Array.from(nodes.values()).map(n => `<option value="${n.id}" ${props.nextNodeId == n.id ? 'selected' : ''}>${n.type} (ID:${n.id})</option>`);

    if(node.type === 'start') {
        html += `<div class="prop-group"><label class="prop-label">下一个节点 (顺序流)</label>
        <select class="prop-select" data-field="nextNodeId">${allNodeOptions}</select></div>`;
    }
    else if(node.type === 'print') {
        html += `<div class="prop-group"><label class="prop-label">打印消息</label>
        <input class="prop-input" data-field="message" value="${escapeHtml(props.message)}" placeholder="输出内容"></div>
        <div class="prop-group"><label class="prop-label">执行后下一节点</label>
        <select class="prop-select" data-field="nextNodeId">${allNodeOptions}</select></div>`;
    }
    else if(node.type === 'sequence') {
        html += `<div class="prop-group"><label class="prop-label">备注</label>
        <input class="prop-input" data-field="comment" value="${escapeHtml(props.comment || '')}"></div>
        <div class="prop-group"><label class="prop-label">下一节点</label>
        <select class="prop-select" data-field="nextNodeId">${allNodeOptions}</select></div>`;
    }
    else if(node.type === 'loop') {
        html += `<div class="prop-group"><label class="prop-label">循环次数</label>
        <input class="prop-input" type="number" data-field="loopCount" value="${props.loopCount}"></div>
        <div class="prop-group"><label class="prop-label">循环体起始节点 (bodyStartId)</label>
        <select class="prop-select" data-field="bodyStartId"><option value="">无</option>${allNodeOptions}</select></div>
        <div class="prop-group"><label class="prop-label">循环结束后节点 (afterLoopId)</label>
        <select class="prop-select" data-field="afterLoopId"><option value="">无</option>${allNodeOptions}</select></div>
        <div class="prop-group"><label class="prop-label">额外后继(一般不用)</label>
        <select class="prop-select" data-field="nextNodeId"><option value="">无</option>${allNodeOptions}</select></div>`;
    }
    else if(node.type === 'branch') {
        const boolVal = props.branchCondition === true;
        html += `<div class="prop-group"><label class="prop-label">分支条件 (运行时选择)</label>
        <select class="prop-select" data-field="branchCondition">
            <option value="true" ${boolVal ? 'selected' : ''}>✅ 真分支 (True)</option>
            <option value="false" ${!boolVal ? 'selected' : ''}>❌ 假分支 (False)</option>
        </select></div>
        <div class="prop-group"><label class="prop-label">True 分支节点 ID</label>
        <select class="prop-select" data-field="trueBranchId"><option value="">无</option>${allNodeOptions}</select></div>
        <div class="prop-group"><label class="prop-label">False 分支节点 ID</label>
        <select class="prop-select" data-field="falseBranchId"><option value="">无</option>${allNodeOptions}</select></div>
        <div class="prop-group"><label class="prop-label">公共后续(可选)</label>
        <select class="prop-select" data-field="nextNodeId"><option value="">无</option>${allNodeOptions}</select></div>`;
    }
    html += `<div class="help-text">💡 提示: 也可以通过节点右侧的圆点拖拽连线。</div>`;
    propDiv.innerHTML = html;
    // 绑定修改事件
    propDiv.querySelectorAll("[data-field]").forEach(el => {
        el.addEventListener("change", (e) => {
            const field = el.getAttribute("data-field");
            let val = el.value;
            if(field === "loopCount") val = parseInt(val) || 1;
            if(field === "branchCondition") val = (val === "true");
            if(field === "nextNodeId" || field === "bodyStartId" || field === "afterLoopId" || field === "trueBranchId" || field === "falseBranchId") {
                val = val === "" ? null : (isNaN(Number(val)) ? null : Number(val));
            }
            node.properties[field] = val;
            renderCanvas(); // 刷新连线
            addConsoleLog(`更新节点 ${node.id} 属性: ${field}=${val}`, "info");
        });
    });
}

function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, function(m){if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;});
}

// 绘制连线
function drawConnections() {
    const svg = document.getElementById("connectionsSvg");
    svg.innerHTML = ''; // 清空
    // 添加箭头标记
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "arrowhead");
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("orient", "auto");
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", "0 0, 10 5, 0 10");
    polygon.setAttribute("fill", "#3498db");
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const canvasDiv = document.getElementById("canvas");
    const containerRect = canvasDiv.getBoundingClientRect();

    for(let node of nodes.values()) {
        const sourceElem = canvasDiv.querySelector(`.flow-node[data-id="${node.id}"]`);
        if(!sourceElem) continue;
        const sourceRect = sourceElem.getBoundingClientRect();
        const startX = sourceRect.right - containerRect.left - 5;
        const startY = sourceRect.top + sourceRect.height/2 - containerRect.top;

        const targets = [];
        const props = node.properties;
        if(props.nextNodeId) targets.push({id: props.nextNodeId, type: 'next'});
        if(node.type === 'loop') {
            if(props.bodyStartId) targets.push({id: props.bodyStartId, type: 'body'});
            if(props.afterLoopId) targets.push({id: props.afterLoopId, type: 'after'});
        }
        if(node.type === 'branch') {
            if(props.trueBranchId) targets.push({id: props.trueBranchId, type: 'true'});
            if(props.falseBranchId) targets.push({id: props.falseBranchId, type: 'false'});
        }

        for(let target of targets) {
            const targetElem = canvasDiv.querySelector(`.flow-node[data-id="${target.id}"]`);
            if(!targetElem) continue;
            const targetRect = targetElem.getBoundingClientRect();
            const endX = targetRect.left - containerRect.left + 10;
            const endY = targetRect.top + targetRect.height/2 - containerRect.top;

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", startX);
            line.setAttribute("y1", startY);
            line.setAttribute("x2", endX);
            line.setAttribute("y2", endY);
            line.classList.add("connection-line");
            svg.appendChild(line);
        }
    }
}

// 拖拽添加组件
function initDragDrop() {
    const comps = document.querySelectorAll(".comp-item");
    const canvasArea = document.getElementById("canvasArea");
    comps.forEach(comp => {
        comp.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/plain", comp.getAttribute("data-type"));
            e.dataTransfer.effectAllowed = "copy";
        });
    });
    canvasArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });
    canvasArea.addEventListener("drop", (e) => {
        e.preventDefault();
        const type = e.dataTransfer.getData("text/plain");
        if(!type) return;
        const rect = canvasArea.getBoundingClientRect();
        let x = e.clientX - rect.left - 90;
        let y = e.clientY - rect.top - 40;
        x = Math.max(20, Math.min(x, rect.width - 200));
        y = Math.max(20, Math.min(y, rect.height - 100));
        const newNode = createNode(type, x, y);
        nodes.set(newNode.id, newNode);
        renderCanvas();
        setSelectedNode(newNode.id);
        addConsoleLog(`添加 ${type} 节点, ID:${newNode.id}`, "info");
    });
}

// ---------- 后端交互 ----------
async function saveProjectToServer() {
    const data = {
        nodes: Array.from(nodes.values()),
        next_id: nextId
    };
    try {
        const response = await fetch('/api/workflow/save', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if(response.ok) {
            addConsoleLog("项目已保存到服务器", "info");
        } else {
            addConsoleLog("保存失败", "error");
        }
    } catch(e) {
        addConsoleLog("保存时发生错误: " + e.message, "error");
    }
}

async function loadProjectFromServer() {
    try {
        const response = await fetch('/api/workflow/load');
        const data = await response.json();
        if(data.nodes) {
            nodes.clear();
            for(let node of data.nodes) {
                nodes.set(node.id, node);
            }
            nextId = data.next_id;
            renderCanvas();
            setSelectedNode(null);
            addConsoleLog("项目已从服务器加载", "info");
        } else {
            addConsoleLog("加载失败：无数据", "error");
        }
    } catch(e) {
        addConsoleLog("加载时发生错误: " + e.message, "error");
    }
}

function exportProjectJSON() {
    const data = { nodes: Array.from(nodes.values()), next_id: nextId };
    const str = JSON.stringify(data, null, 2);
    const blob = new Blob([str], {type: "application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "agri_workflow.json";
    a.click();
    addConsoleLog("导出项目JSON文件", "info");
}

function importProjectJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            nodes.clear();
            for(let node of data.nodes) {
                nodes.set(node.id, node);
            }
            nextId = data.next_id;
            renderCanvas();
            setSelectedNode(null);
            addConsoleLog("导入项目成功", "info");
        } catch(err) {
            addConsoleLog("导入失败, 文件格式错误", "error");
        }
    };
    reader.readAsText(file);
}

function newProject() {
    if(confirm("新建项目将清空当前工作流，确定吗？")) {
        nodes.clear();
        nextId = 100;
        renderCanvas();
        setSelectedNode(null);
        addConsoleLog("已新建空白项目", "info");
    }
}

async function runWorkflow() {
    const data = { nodes: Array.from(nodes.values()) };
    try {
        const response = await fetch('/api/workflow/execute', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if(result.logs && result.logs.length) {
            displayLogs(result.logs);
        } else {
            addConsoleLog("执行完成，无输出日志", "run");
        }
    } catch(e) {
        addConsoleLog("执行时发生错误: " + e.message, "error");
    }
}

// 控制台设置弹窗
function showConsoleSetting() {
    const mode = prompt("控制台输出模式:\n输入 detail 显示详细过程\n输入 result 仅显示结果", consoleMode);
    if (mode === 'detail' || mode === 'result') {
        consoleMode = mode;
        addConsoleLog(`控制台模式已切换为: ${mode === 'detail' ? '详细过程' : '仅结果'}`, "info");
    } else if (mode !== null) {
        alert("请输入 detail 或 result");
    }
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
    loopNode.properties.bodyStartId = innerPrint.id;
    loopNode.properties.afterLoopId = branchNode.id;
    innerPrint.properties.nextNodeId = branchNode.id;
    branchNode.properties.trueBranchId = truePrint.id;
    branchNode.properties.falseBranchId = falsePrint.id;
    [start, print1, loopNode, innerPrint, branchNode, truePrint, falsePrint].forEach(n => nodes.set(n.id, n));
    renderCanvas();
    addConsoleLog("已加载示例工作流 (包含循环+分支)，点击运行按钮查看控制台效果", "info");
}

// 绑定菜单事件
document.getElementById("newProjectBtn").onclick = newProject;
document.getElementById("saveProjectBtn").onclick = saveProjectToServer;
document.getElementById("loadProjectBtn").onclick = loadProjectFromServer;
document.getElementById("exportProjectBtn").onclick = exportProjectJSON;
document.getElementById("importProjectBtn").onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = (e) => { if(e.target.files[0]) importProjectJSON(e.target.files[0]); };
    input.click();
};
document.getElementById("runWorkflowBtn").onclick = runWorkflow;
document.getElementById("clearConsoleBtn").onclick = clearConsole;
document.getElementById("consoleSettingBtn").onclick = showConsoleSetting;

// 初始化
initDragDrop();
initDemoFlow();
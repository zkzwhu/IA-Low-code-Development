import { state, setSelectedNodeId } from './store.js';
import { addConsoleLog, escapeHtml } from './utils.js';

function typeLabel(type) {
    switch(type) {
        case 'start': return "开始";
        case 'print': return "打印";
        case 'sequence': return "顺序";
        case 'loop': return "循环";
        case 'branch': return "分支";
        default: return type;
    }
}

function nextNameIndexForType(type) {
    let maxIdx = 0;
    for (let n of state.nodes.values()) {
        if (n.type !== type) continue;
        const name = n.properties?.name || "";
        const m = name.match(/(\d+)$/);
        if (m) maxIdx = Math.max(maxIdx, Number(m[1]) || 0);
    }
    return maxIdx + 1;
}

function ensureUniqueNameWithinType(type, desiredName, selfId = null) {
    const trimmed = String(desiredName ?? "").trim();
    if (!trimmed) return { ok: false, name: "", reason: "名称不能为空" };
    for (let n of state.nodes.values()) {
        if (n.type !== type) continue;
        if (selfId != null && n.id === selfId) continue;
        const existing = String(n.properties?.name ?? "").trim();
        if (existing === trimmed) {
            return { ok: false, name: trimmed, reason: `同类型节点名称不可重复：${trimmed}` };
        }
    }
    return { ok: true, name: trimmed, reason: "" };
}

function defaultNameForType(type) {
    const label = typeLabel(type);
    if (type === 'start') return "开始";
    const idx = nextNameIndexForType(type);
    return `${label}${idx}`;
}

// 创建新节点
export function createNode(type, x, y) {
    const id = state.nextId++;
    const baseNode = {
        id: id,
        type: type,
        x: x,
        y: y,
        parentId: null,
        localX: 0,
        localY: 0,
        properties: {}
    };
    switch(type) {
        case 'start':
            baseNode.properties = { name: defaultNameForType(type), nextNodeId: null, portPositions: {}, breakpoint: false };
            break;
        case 'print':
            baseNode.properties = { name: defaultNameForType(type), message: "Hello, 智慧农业", nextNodeId: null, portPositions: {}, breakpoint: false };
            break;
        case 'sequence':
            baseNode.properties = { name: defaultNameForType(type), comment: "顺序执行", nextNodeId: null, portPositions: {}, breakpoint: false };
            break;
        case 'loop':
            // 循环节点：只包含循环条件 + 循环体（可容纳多个模块）
            // loopCondition: 支持 count(次数) / expr(表达式占位)。当前执行器默认按 count 执行。
            baseNode.properties = {
                name: defaultNameForType(type),
                loopConditionType: "count",
                loopCount: 3,
                loopConditionExpr: "",
                bodyNodeIds: [],
                nextNodeId: null,
                portPositions: {},
                breakpoint: false,
                headerHeight: 54,
                minWidth: 260,
                minHeight: 180
            };
            break;
        case 'branch':
            baseNode.properties = {
                name: defaultNameForType(type),
                branchCondition: true,
                trueBranchId: null,
                falseBranchId: null,
                // 容器化：可视化包含两侧分支体（支持嵌套）
                trueBodyNodeIds: [],
                falseBodyNodeIds: [],
                nextNodeId: null,
                portPositions: {},
                breakpoint: false,
                headerHeight: 54,
                minWidth: 320,
                minHeight: 200
            };
            break;
        default: break;
    }
    return baseNode;
}

// 删除节点
export function deleteNodeById(id) {
    if (!state.nodes.has(id)) return;
    // 清除其他节点对该节点的引用
    for (let node of state.nodes.values()) {
        if (node.type === 'loop') {
            if (Array.isArray(node.properties.bodyNodeIds)) {
                node.properties.bodyNodeIds = node.properties.bodyNodeIds.filter(x => x !== id);
            }
        }
        if (node.type === 'branch') {
            if (node.properties.trueBranchId === id) node.properties.trueBranchId = null;
            if (node.properties.falseBranchId === id) node.properties.falseBranchId = null;
            if (Array.isArray(node.properties.trueBodyNodeIds)) {
                node.properties.trueBodyNodeIds = node.properties.trueBodyNodeIds.filter(x => x !== id);
            }
            if (Array.isArray(node.properties.falseBodyNodeIds)) {
                node.properties.falseBodyNodeIds = node.properties.falseBodyNodeIds.filter(x => x !== id);
            }
        }
        if (node.properties.nextNodeId === id) node.properties.nextNodeId = null;
    }
    state.nodes.delete(id);
    if (state.selectedNodeId === id) setSelectedNodeId(null);
    renderCanvas();
    renderPropertiesPanel();
    addConsoleLog(`删除节点 ID:${id}`, "info");
}

// 选中节点
export function setSelectedNode(id) {
    setSelectedNodeId(id);
    renderCanvas();
    renderPropertiesPanel();
}

function removeNodeFromContainerLists(nodeId) {
    for (let node of state.nodes.values()) {
        if (!node.properties) continue;
        if (Array.isArray(node.properties.bodyNodeIds)) {
            node.properties.bodyNodeIds = node.properties.bodyNodeIds.filter(id => id !== nodeId);
        }
        if (Array.isArray(node.properties.trueBodyNodeIds)) {
            node.properties.trueBodyNodeIds = node.properties.trueBodyNodeIds.filter(id => id !== nodeId);
        }
        if (Array.isArray(node.properties.falseBodyNodeIds)) {
            node.properties.falseBodyNodeIds = node.properties.falseBodyNodeIds.filter(id => id !== nodeId);
        }
    }
}

function isDescendantContainer(maybeAncestorId, nodeId) {
    let current = state.nodes.get(maybeAncestorId);
    while (current) {
        if (current.id === nodeId) return true;
        if (current.parentId == null) return false;
        current = state.nodes.get(current.parentId);
    }
    return false;
}

function detachNodeFromParent(node) {
    if (!node) return;
    removeNodeFromContainerLists(node.id);
    node.parentId = null;
    if (node.properties) delete node.properties.branchSide;
}

function attachNodeToContainer(targetNode, parentNode, slot) {
    if (!targetNode || !parentNode || !slot) return false;
    if (targetNode.id === parentNode.id) return false;
    if (isDescendantContainer(parentNode.id, targetNode.id)) return false;

    detachNodeFromParent(targetNode);

    targetNode.parentId = parentNode.id;
    targetNode.localX = Math.max(12, targetNode.localX || 12);
    targetNode.localY = Math.max(16, targetNode.localY || 16);

    if (slot === 'loopBody') {
        const arr = Array.isArray(parentNode.properties.bodyNodeIds) ? parentNode.properties.bodyNodeIds : [];
        if (!arr.includes(targetNode.id)) arr.push(targetNode.id);
        parentNode.properties.bodyNodeIds = arr;
        return true;
    }

    if (slot === 'trueBody' || slot === 'falseBody') {
        const side = slot === 'trueBody' ? 'true' : 'false';
        const key = side === 'true' ? 'trueBodyNodeIds' : 'falseBodyNodeIds';
        const arr = Array.isArray(parentNode.properties[key]) ? parentNode.properties[key] : [];
        if (!arr.includes(targetNode.id)) arr.push(targetNode.id);
        parentNode.properties[key] = arr;
        if (!targetNode.properties) targetNode.properties = {};
        targetNode.properties.branchSide = side;
        return true;
    }

    return false;
}

// 渲染右侧属性面板
function renderPropertiesPanel() {
    const propDiv = document.getElementById("propContent");
    if (!state.selectedNodeId || !state.nodes.has(state.selectedNodeId)) {
        propDiv.innerHTML = '<div class="help-text">点击画布中的节点查看并修改属性</div>';
        return;
    }
    const node = state.nodes.get(state.selectedNodeId);
    const props = node.properties;
    let html = `<div class="prop-group"><div class="prop-label">节点类型: <strong>${typeLabel(node.type)}</strong></div></div>`;

    html += `<div class="prop-group">
        <label class="prop-label">节点名称（同类型不可重名）</label>
        <input class="prop-input" data-field="name" value="${escapeHtml(props.name || '')}" placeholder="请输入节点名称">
    </div>`;

    const nodeOptions = (selectedId) => {
        return Array.from(state.nodes.values())
            .map(n => `<option value="${n.id}" ${selectedId == n.id ? 'selected' : ''}>${n.type} (ID:${n.id})</option>`)
            .join('');
    };
    const nodeNameOptions = (selectedId) => {
        return Array.from(state.nodes.values())
            .map(n => {
                const nm = escapeHtml(n.properties?.name || typeLabel(n.type));
                return `<option value="${n.id}" ${selectedId == n.id ? 'selected' : ''}>${nm}</option>`;
            })
            .join('');
    };

    if (node.type === 'start') {
        html += `<div class="prop-group"><label class="prop-label">下一个节点 (顺序流)</label>
        <select class="prop-select" data-field="nextNodeId">${nodeNameOptions(props.nextNodeId)}</select></div>`;
    }
    else if (node.type === 'print') {
        html += `<div class="prop-group"><label class="prop-label">打印消息</label>
        <input class="prop-input" data-field="message" value="${escapeHtml(props.message)}" placeholder="输出内容"></div>
        <div class="prop-group"><label class="prop-label">执行后下一节点</label>
        <select class="prop-select" data-field="nextNodeId">${nodeNameOptions(props.nextNodeId)}</select></div>`;
    }
    else if (node.type === 'sequence') {
        html += `<div class="prop-group"><label class="prop-label">备注</label>
        <input class="prop-input" data-field="comment" value="${escapeHtml(props.comment || '')}"></div>
        <div class="prop-group"><label class="prop-label">下一节点</label>
        <select class="prop-select" data-field="nextNodeId">${nodeNameOptions(props.nextNodeId)}</select></div>`;
    }
    else if (node.type === 'loop') {
        const condType = props.loopConditionType || "count";
        html += `<div class="prop-group"><label class="prop-label">循环条件类型</label>
            <select class="prop-select" data-field="loopConditionType">
                <option value="count" ${condType === 'count' ? 'selected' : ''}>按次数（Count）</option>
                <option value="expr" ${condType === 'expr' ? 'selected' : ''}>表达式（Expr，占位）</option>
            </select>
        </div>`;

        html += `<div class="prop-group"><label class="prop-label">循环条件（次数）</label>
            <input class="prop-input" type="number" data-field="loopCount" value="${props.loopCount ?? 1}" min="1">
        </div>`;

        html += `<div class="prop-group"><label class="prop-label">循环条件（表达式，占位）</label>
            <input class="prop-input" data-field="loopConditionExpr" value="${escapeHtml(props.loopConditionExpr || '')}" placeholder="例如: i &lt; 5（暂未执行，仅展示）">
        </div>`;

        const bodyIds = Array.isArray(props.bodyNodeIds) ? props.bodyNodeIds : [];
        const bodyItems = bodyIds.map((id, idx) => {
            const n = state.nodes.get(id);
            const title = n ? `${escapeHtml(n.properties?.name || typeLabel(n.type))} (#${id})` : `未知节点 (#${id})`;
            return `<div class="prop-group" style="flex-direction:row; align-items:center; gap:8px;">
                <div style="flex:1; font-size:12px;">${idx + 1}. ${title}</div>
                <button class="prop-btn" data-action="loopBodyUp" data-idx="${idx}" title="上移">↑</button>
                <button class="prop-btn" data-action="loopBodyDown" data-idx="${idx}" title="下移">↓</button>
                <button class="prop-btn" data-action="loopBodyRemove" data-idx="${idx}" title="移除">移除</button>
            </div>`;
        }).join('') || `<div class="help-text">循环体为空：从循环节点的「循环体端口」连线到目标节点即可加入循环体。</div>`;

        html += `<div class="prop-group"><label class="prop-label">循环体（可包含多个模块，按顺序执行）</label>${bodyItems}</div>`;

        html += `<div class="prop-group"><label class="prop-label">循环结束后节点（next）</label>
            <select class="prop-select" data-field="nextNodeId"><option value="">无</option>${nodeNameOptions(props.nextNodeId)}</select>
        </div>`;
    }
    else if (node.type === 'branch') {
        const boolVal = props.branchCondition === true;
        const renderBodyList = (ids, sideLabel, actionPrefix) => {
            const safeIds = Array.isArray(ids) ? ids : [];
            return safeIds.map((id, idx) => {
                const n = state.nodes.get(id);
                const title = n ? `${escapeHtml(n.properties?.name || typeLabel(n.type))} (#${id})` : `Unknown Node (#${id})`;
                return `<div class="prop-group" style="flex-direction:row; align-items:center; gap:8px;">
                    <div style="flex:1; font-size:12px;">${idx + 1}. ${title}</div>
                    <button class="prop-btn" data-action="${actionPrefix}Up" data-idx="${idx}" title="Up">?</button>
                    <button class="prop-btn" data-action="${actionPrefix}Down" data-idx="${idx}" title="Down">?</button>
                    <button class="prop-btn" data-action="${actionPrefix}Remove" data-idx="${idx}" title="Remove">??</button>
                </div>`;
            }).join('') || `<div class="help-text">${sideLabel} branch body is empty: connect the ${sideLabel} port to a target node to add it.</div>`;
        };
        html += `<div class="prop-group"><label class="prop-label">Branch Condition</label>
        <select class="prop-select" data-field="branchCondition">
            <option value="true" ${boolVal ? 'selected' : ''}>True</option>
            <option value="false" ${!boolVal ? 'selected' : ''}>False</option>
        </select></div>
        <div class="prop-group"><label class="prop-label">True Body Nodes</label>${renderBodyList(props.trueBodyNodeIds, "True", "branchTrueBody")}</div>
        <div class="prop-group"><label class="prop-label">False Body Nodes</label>${renderBodyList(props.falseBodyNodeIds, "False", "branchFalseBody")}</div>
        <div class="prop-group"><label class="prop-label">Next Node</label>
        <select class="prop-select" data-field="nextNodeId"><option value="">None</option>${nodeNameOptions(props.nextNodeId)}</select></div>`;
    }
    html += `<div class="help-text">💡 提示: 也可以通过节点右侧的圆点拖拽连线。</div>`;
    propDiv.innerHTML = html;
    // 绑定修改事件
    propDiv.querySelectorAll("[data-field]").forEach(el => {
        el.addEventListener("change", (e) => {
            const field = el.getAttribute("data-field");
            let val = el.value;
            if (field === "loopCount") val = parseInt(val) || 1;
            if (field === "branchCondition") val = (val === "true");
            if (field === "name") {
                const r = ensureUniqueNameWithinType(node.type, val, node.id);
                if (!r.ok) {
                    addConsoleLog(`重命名失败：${r.reason}`, "error");
                    el.value = props.name || "";
                    return;
                }
                val = r.name;
            }
            if (field === "nextNodeId" || field === "trueBranchId" || field === "falseBranchId") {
                val = val === "" ? null : (isNaN(Number(val)) ? null : Number(val));
            }
            node.properties[field] = val;
            renderCanvas(); // 刷新连线
            renderPropertiesPanel();
            addConsoleLog(`更新节点 ${node.id} 属性: ${field}=${val}`, "info");
        });
    });
    // Container body ordering / removal
    propDiv.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", () => {
            const action = btn.getAttribute("data-action");
            const idx = parseInt(btn.getAttribute("data-idx"));
            let arr = null;
            let side = null;

            if (node.type === 'loop' && action.startsWith('loopBody')) {
                arr = Array.isArray(node.properties.bodyNodeIds) ? node.properties.bodyNodeIds : [];
            } else if (node.type === 'branch' && action.startsWith('branchTrueBody')) {
                arr = Array.isArray(node.properties.trueBodyNodeIds) ? node.properties.trueBodyNodeIds : [];
                side = 'true';
            } else if (node.type === 'branch' && action.startsWith('branchFalseBody')) {
                arr = Array.isArray(node.properties.falseBodyNodeIds) ? node.properties.falseBodyNodeIds : [];
                side = 'false';
            }

            if (!arr || Number.isNaN(idx) || idx < 0 || idx >= arr.length) return;

            if (action.endsWith('Remove')) {
                const [removedId] = arr.splice(idx, 1);
                const removedNode = state.nodes.get(removedId);
                if (removedNode) {
                    removedNode.parentId = null;
                    if (side && removedNode.properties?.branchSide === side) delete removedNode.properties.branchSide;
                }
            } else if (action.endsWith('Up') && idx > 0) {
                [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
            } else if (action.endsWith('Down') && idx < arr.length - 1) {
                [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
            }

            if (node.type === 'loop') node.properties.bodyNodeIds = arr;
            if (action.startsWith('branchTrueBody')) node.properties.trueBodyNodeIds = arr;
            if (action.startsWith('branchFalseBody')) node.properties.falseBodyNodeIds = arr;

            renderCanvas();
            renderPropertiesPanel();
        });
    });
}

// 绘制连线
function drawConnections() {
    const svg = document.getElementById("connectionsSvg");
    svg.innerHTML = '';
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

    // 不同连线含义使用不同颜色，便于“可视化编辑”。
    const fieldColor = {
        nextNodeId: "#3498db",
        loopBody: "#f39c12",
        trueBody: "#2ecc71",
        falseBody: "#e74c3c",
    };

    for (let node of state.nodes.values()) {
        const props = node.properties || {};

        const outgoing = [];
        if (props.nextNodeId) outgoing.push({ field: 'nextNodeId', toId: props.nextNodeId });
        if (node.type === 'loop') {
            const bodyIds = Array.isArray(props.bodyNodeIds) ? props.bodyNodeIds : [];
            for (let id of bodyIds) {
                if (id) outgoing.push({ field: 'loopBody', toId: id });
            }
        }
        if (node.type === 'branch') {
            const t = Array.isArray(props.trueBodyNodeIds) ? props.trueBodyNodeIds : [];
            const f = Array.isArray(props.falseBodyNodeIds) ? props.falseBodyNodeIds : [];
            for (let id of t) if (id) outgoing.push({ field: 'trueBody', toId: id });
            for (let id of f) if (id) outgoing.push({ field: 'falseBody', toId: id });
        }

        for (let conn of outgoing) {
            const sourcePoint = canvasDiv.querySelector(
                `.flow-node[data-id="${node.id}"] .connect-point[data-field="${conn.field}"]`
            );
            const targetElem = canvasDiv.querySelector(`.flow-node[data-id="${conn.toId}"]`);
            if (!sourcePoint || !targetElem) continue;

            const sourcePointRect = sourcePoint.getBoundingClientRect();
            const startX = sourcePointRect.right - containerRect.left;
            const startY = sourcePointRect.top + sourcePointRect.height / 2 - containerRect.top;

            const targetRect = targetElem.getBoundingClientRect();
            const endX = targetRect.left - containerRect.left + 10;
            const endY = targetRect.top + targetRect.height / 2 - containerRect.top;

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", startX);
            line.setAttribute("y1", startY);
            line.setAttribute("x2", endX);
            line.setAttribute("y2", endY);
            line.classList.add("connection-line");
            line.setAttribute("stroke", fieldColor[conn.field] || "#3498db");
            svg.appendChild(line);
        }
    }
}

// 渲染所有节点和连线（核心渲染函数）
export function renderCanvas() {
    const canvasDiv = document.getElementById("canvas");
    // 移除所有节点元素（含容器内部）
    canvasDiv.querySelectorAll('.flow-node').forEach(div => div.remove());
    canvasDiv.querySelectorAll('.loop-group').forEach(div => div.remove());

    const childrenByParent = new Map();
    for (let n of state.nodes.values()) {
        if (n.parentId != null) {
            if (!childrenByParent.has(n.parentId)) childrenByParent.set(n.parentId, []);
            childrenByParent.get(n.parentId).push(n);
        }
    }

    const NODE_W = 180;
    const NODE_H = 80;
    const LOOP_HEADER_H = 54;
    const BRANCH_HEADER_H = 54;

    const getNodeBox = (node) => {
        if (!node) return { width: NODE_W, height: NODE_H };
        if (node.type === 'loop') {
            const kids = childrenByParent.get(node.id) || [];
            const bounds = computeLocalBounds(kids);
            const pad = 16;
            const minW = node.properties?.minWidth || 260;
            const minH = node.properties?.minHeight || 180;
            return {
                width: Math.max(minW, bounds.maxX + pad * 2),
                height: Math.max(minH, LOOP_HEADER_H + bounds.maxY + pad * 2 + 40)
            };
        }
        if (node.type === 'branch') {
            const kids = childrenByParent.get(node.id) || [];
            const tKids = kids.filter(k => k.properties?.branchSide === 'true');
            const fKids = kids.filter(k => k.properties?.branchSide === 'false');
            const b1 = computeLocalBounds(tKids);
            const b2 = computeLocalBounds(fKids);
            const pad = 18;
            const minW = node.properties?.minWidth || 320;
            const minH = node.properties?.minHeight || 200;
            const colW = Math.max(b1.maxX, b2.maxX, 160) + pad * 2;
            const bodyH = Math.max(b1.maxY, b2.maxY, 140) + pad * 2;
            return {
                width: Math.max(minW, colW * 2 + 40),
                height: Math.max(minH, BRANCH_HEADER_H + bodyH + 40)
            };
        }
        return { width: NODE_W, height: NODE_H };
    };

    const computeLocalBounds = (nodes) => {
        if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        let maxX = 0, maxY = 0;
        for (let n of nodes) {
            const box = getNodeBox(n);
            maxX = Math.max(maxX, (n.localX || 0) + box.width);
            maxY = Math.max(maxY, (n.localY || 0) + box.height);
        }
        return { minX: 0, minY: 0, maxX, maxY };
    };

    const renderNode = (node, mountEl, mode) => {
        const nodeDiv = document.createElement("div");
        nodeDiv.className = "flow-node";
        if (state.selectedNodeId === node.id) nodeDiv.classList.add("selected");
        nodeDiv.style.position = "absolute";
        nodeDiv.setAttribute("data-id", node.id);

        if (mode === 'root') {
            nodeDiv.style.left = node.x + "px";
            nodeDiv.style.top = node.y + "px";
        } else {
            nodeDiv.style.left = (node.localX || 0) + "px";
            nodeDiv.style.top = (node.localY || 0) + "px";
        }

        const label = typeLabel(node.type);
        let bodyPreview = "";
        if(node.type === 'print') bodyPreview = `✉️ ${node.properties.message?.substring(0, 20) || "打印"}`;
        else if(node.type === 'loop') {
            const condType = node.properties.loopConditionType || "count";
            const condText = condType === 'expr' ? (node.properties.loopConditionExpr || "(空)") : `${node.properties.loopCount ?? 1} 次`;
            const cnt = (Array.isArray(node.properties.bodyNodeIds) ? node.properties.bodyNodeIds.length : 0);
            bodyPreview = `🔁 条件: ${escapeHtml(condText)}<br/>循环体: ${cnt} 个节点`;
        }
        else if(node.type === 'branch') {
            const tCnt = Array.isArray(node.properties.trueBodyNodeIds) ? node.properties.trueBodyNodeIds.length : (node.properties.trueBranchId ? 1 : 0);
            const fCnt = Array.isArray(node.properties.falseBodyNodeIds) ? node.properties.falseBodyNodeIds.length : (node.properties.falseBranchId ? 1 : 0);
            bodyPreview = `Branch: ${node.properties.branchCondition ? "True" : "False"}<br/>True: ${tCnt} / False: ${fCnt}`;
        }
        else if(node.type === 'start') bodyPreview = "入口节点";
        else bodyPreview = node.properties.comment || "顺序节点";

        const nodeName = node.properties?.name || label;
        nodeDiv.title = nodeName;

        const portPos = node.properties?.portPositions || {};
        const portStyle = (field, fallbackTopPct) => {
            const p = portPos[field];
            if (p && typeof p.x === 'number' && typeof p.y === 'number') {
                return `left: calc(${p.x}% - 6px); top: calc(${p.y}% - 6px); right: auto;`;
            }
            return `top:${fallbackTopPct}%;`;
        };

        const bpOn = !!node.properties?.breakpoint;
        const bpDotHtml = `<span class="breakpoint-dot ${bpOn ? 'on' : ''}" data-action="toggleBreakpoint" title="断点（点击切换）"></span>`;

        // 端口
        let connectPointsHtml = '';
        if (node.type === 'start' || node.type === 'print' || node.type === 'sequence') {
            connectPointsHtml = `<div class="connect-point" data-id="${node.id}" data-field="nextNodeId" style="${portStyle('nextNodeId', 50)} --cp-color:#3498db; --cp-hover-color:#2c7da0;" title="端口：下一步（next）【Shift+拖动可移动端口】"></div>`;
        } else if (node.type === 'loop') {
            connectPointsHtml = `
                <div class="connect-point" data-id="${node.id}" data-field="loopBody" style="${portStyle('loopBody', 40)} --cp-color:#f39c12; --cp-hover-color:#d35400;" title="端口：循环体（加入循环体列表）【Shift+拖动可移动端口】"></div>
                <div class="connect-point" data-id="${node.id}" data-field="nextNodeId" style="${portStyle('nextNodeId', 65)} --cp-color:#3498db; --cp-hover-color:#2c7da0;" title="端口：循环后续（next）【Shift+拖动可移动端口】"></div>
            `;
        } else if (node.type === 'branch') {
            connectPointsHtml = `
                <div class="connect-point" data-id="${node.id}" data-field="trueBody" style="${portStyle('trueBody', 32)} --cp-color:#2ecc71; --cp-hover-color:#27ae60;" title="端口：真分支体（加入 True 容器）【Shift+拖动可移动端口】"></div>
                <div class="connect-point" data-id="${node.id}" data-field="falseBody" style="${portStyle('falseBody', 68)} --cp-color:#e74c3c; --cp-hover-color:#c0392b;" title="端口：假分支体（加入 False 容器）【Shift+拖动可移动端口】"></div>
                <div class="connect-point" data-id="${node.id}" data-field="nextNodeId" style="${portStyle('nextNodeId', 50)} --cp-color:#3498db; --cp-hover-color:#2c7da0;" title="端口：公共后续（next，可选）【Shift+拖动可移动端口】"></div>
            `;
        } else {
            connectPointsHtml = `<div class="connect-point" data-id="${node.id}" data-field="nextNodeId" style="${portStyle('nextNodeId', 50)} --cp-color:#3498db; --cp-hover-color:#2c7da0;" title="端口：下一步（next）【Shift+拖动可移动端口】"></div>`;
        }

        const isContainer = (node.type === 'loop' || node.type === 'branch');
        if (isContainer) nodeDiv.classList.add('container-node');

        let childrenHtml = '';
        if (node.type === 'loop') {
            childrenHtml = `<div class="container-children" data-container="${node.id}" title="循环体容器（可嵌套循环/分支）"></div>`;
        } else if (node.type === 'branch') {
            childrenHtml = `
                <div class="branch-children" data-container="${node.id}">
                    <div class="branch-col" data-branch="true"><div class="branch-col-title">True</div></div>
                    <div class="branch-col" data-branch="false"><div class="branch-col-title">False</div></div>
                </div>
            `;
        }

        nodeDiv.innerHTML = `
            <div class="node-header">
                <span title="节点类型">${label}</span>
                <span class="node-type-badge" title="节点名称">${escapeHtml(nodeName)}</span>
                ${bpDotHtml}
                <button class="delete-node-btn" data-id="${node.id}" title="删除节点">🗑️</button>
            </div>
            <div class="node-body ${isContainer ? 'container-body' : ''}">
                <div>${bodyPreview}</div>
                ${isContainer ? childrenHtml : ''}
                ${connectPointsHtml}
            </div>
        `;

        if (node.type === 'loop') {
            const kids = (childrenByParent.get(node.id) || []);
            const bounds = computeLocalBounds(kids);
            const pad = 16;
            const headerH = node.properties.headerHeight || 54;
            const minW = node.properties.minWidth || 260;
            const minH = node.properties.minHeight || 180;
            const w = Math.max(minW, bounds.maxX + pad * 2);
            const h = Math.max(minH, headerH + bounds.maxY + pad * 2 + 40);
            nodeDiv.style.width = w + 'px';
            nodeDiv.style.height = h + 'px';
            const container = nodeDiv.querySelector('.container-children');
            if (container) container.style.height = Math.max(120, h - headerH - 34) + 'px';
        }
        if (node.type === 'branch') {
            const kids = (childrenByParent.get(node.id) || []);
            const tKids = kids.filter(k => k.properties?.branchSide === 'true');
            const fKids = kids.filter(k => k.properties?.branchSide === 'false');
            const b1 = computeLocalBounds(tKids);
            const b2 = computeLocalBounds(fKids);
            const pad = 18;
            const headerH = node.properties.headerHeight || 54;
            const minW = node.properties.minWidth || 320;
            const minH = node.properties.minHeight || 200;
            const colW = Math.max(b1.maxX, b2.maxX, 160) + pad * 2;
            const bodyH = Math.max(b1.maxY, b2.maxY, 140) + pad * 2;
            const w = Math.max(minW, colW * 2 + 40);
            const h = Math.max(minH, headerH + bodyH + 40);
            nodeDiv.style.width = w + 'px';
            nodeDiv.style.height = h + 'px';
            nodeDiv.querySelectorAll('.branch-col').forEach(c => { c.style.height = Math.max(140, h - headerH - 34) + 'px'; });
        }

        nodeDiv.addEventListener("click", (e) => {
            e.stopPropagation();
            if (ignoreNextClick) { ignoreNextClick = false; return; }
            if (e.target?.getAttribute && e.target.getAttribute('data-action') === 'toggleBreakpoint') {
                node.properties.breakpoint = !node.properties.breakpoint;
                renderCanvas();
                if (state.selectedNodeId === node.id) renderPropertiesPanel();
                return;
            }
            if(e.target.classList && e.target.classList.contains("delete-node-btn")) {
                deleteNodeById(node.id);
                return;
            }
            setSelectedNode(node.id);
        });

        nodeDiv.addEventListener("mousedown", (e) => {
            if(e.target.classList && (e.target.classList.contains("delete-node-btn") || e.target.classList.contains("connect-point") || e.target.classList.contains("breakpoint-dot"))) return;
            e.stopPropagation();
            isDraggingNode = true;
            currentNodeMoving = node.id;
            didMoveNode = false;
            ignoreNextClick = false;
            const rect = nodeDiv.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            nodeDiv.style.cursor = "grabbing";
            e.preventDefault();
        });

        mountEl.appendChild(nodeDiv);

        if (node.type === 'loop') {
            const container = nodeDiv.querySelector('.container-children');
            const kids = (childrenByParent.get(node.id) || []);
            if (container) for (let kid of kids) renderNode(kid, container, 'child');
        }
        if (node.type === 'branch') {
            const kids = (childrenByParent.get(node.id) || []);
            const trueCol = nodeDiv.querySelector('.branch-col[data-branch="true"]');
            const falseCol = nodeDiv.querySelector('.branch-col[data-branch="false"]');
            for (let kid of kids) {
                const side = kid.properties?.branchSide;
                if (side === 'true' && trueCol) renderNode(kid, trueCol, 'child');
                if (side === 'false' && falseCol) renderNode(kid, falseCol, 'child');
            }
        }
    };

    for (let node of state.nodes.values()) {
        if (node.parentId != null) continue;
        renderNode(node, canvasDiv, 'root');
    }

    // 绑定连接点拖拽事件
    document.querySelectorAll('.connect-point').forEach(point => {
        point.removeEventListener('mousedown', onConnectPointMouseDown);
        point.addEventListener('mousedown', onConnectPointMouseDown);
    });

    // 全局拖拽事件（由nodeManager统一管理）
    setupGlobalDragEvents();

    drawConnections();
}

// 拖拽相关变量
let isDraggingNode = false;
let currentNodeMoving = null;
let dragOffsetX = 0, dragOffsetY = 0;
let isDraggingConnection = false;
let draggingFromNodeId = null;
let draggingFromField = null;
let tempLine = null;
let didMoveNode = false;
let ignoreNextClick = false;
let isDraggingPort = false;
let draggingPortNodeId = null;
let draggingPortField = null;

function onConnectPointMouseDown(e) {
    e.stopPropagation();
    const nodeId = parseInt(e.target.getAttribute('data-id'));
    const field = e.target.getAttribute('data-field') || null;
    if (nodeId) {
        // 按住 Shift 可拖动端口到节点任意位置（持久化到 portPositions）
        if (e.shiftKey && field) {
            isDraggingPort = true;
            draggingPortNodeId = nodeId;
            draggingPortField = field;
            return;
        }
        isDraggingConnection = true;
        draggingFromNodeId = nodeId;
        draggingFromField = field;
    }
}

function onGlobalMouseMove(e) {
    const canvasDiv = document.getElementById("canvas");
    if (isDraggingNode && currentNodeMoving !== null) {
        const node = state.nodes.get(currentNodeMoving);
        if (!node) return;
        if (node.parentId != null) {
            const nodeElem = canvasDiv.querySelector(`.flow-node[data-id="${node.parentId}"]`);
            // 子节点所在容器（循环体/分支体）
            const parentNode = state.nodes.get(node.parentId);
            let host = null;
            if (parentNode?.type === 'loop') {
                host = document.querySelector(`.flow-node[data-id="${node.parentId}"] .container-children`);
            } else if (parentNode?.type === 'branch') {
                host = document.querySelector(`.flow-node[data-id="${node.parentId}"] .branch-col[data-branch="${node.properties?.branchSide || 'true'}"]`);
            }
            const rect = (host || nodeElem)?.getBoundingClientRect();
            if (!rect) return;
            const newX = e.clientX - dragOffsetX - rect.left;
            const newY = e.clientY - dragOffsetY - rect.top;
            node.localX = Math.max(0, newX);
            node.localY = Math.max(0, newY);
        } else {
            const containerRect = canvasDiv.parentElement.getBoundingClientRect();
            let newX = e.clientX - dragOffsetX - containerRect.left;
            let newY = e.clientY - dragOffsetY - containerRect.top;
            newX = Math.max(5, Math.min(newX, containerRect.width - 180));
            newY = Math.max(5, Math.min(newY, containerRect.height - 80));
            node.x = newX;
            node.y = newY;
        }
        didMoveNode = true;
        renderCanvas();
    } else if (isDraggingPort && draggingPortNodeId !== null && draggingPortField) {
        const nodeElem = canvasDiv.querySelector(`.flow-node[data-id="${draggingPortNodeId}"]`);
        if (!nodeElem) return;
        const rect = nodeElem.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const px = Math.max(0, Math.min(100, (x / rect.width) * 100));
        const py = Math.max(0, Math.min(100, (y / rect.height) * 100));
        const node = state.nodes.get(draggingPortNodeId);
        if (!node) return;
        if (!node.properties.portPositions) node.properties.portPositions = {};
        node.properties.portPositions[draggingPortField] = { x: px, y: py };
        renderCanvas();
    } else if (isDraggingConnection && draggingFromNodeId !== null) {
        const containerRect = canvasDiv.parentElement.getBoundingClientRect();
        const sourceNode = state.nodes.get(draggingFromNodeId);
        if (sourceNode) {
            let startX = 0;
            let startY = 0;
            const sourcePoint = draggingFromField
                ? canvasDiv.querySelector(`.flow-node[data-id="${draggingFromNodeId}"] .connect-point[data-field="${draggingFromField}"]`)
                : null;
            if (sourcePoint) {
                const sourcePointRect = sourcePoint.getBoundingClientRect();
                startX = sourcePointRect.right - containerRect.left;
                startY = sourcePointRect.top + sourcePointRect.height / 2 - containerRect.top;
            } else {
                const sourceElem = canvasDiv.querySelector(`.flow-node[data-id="${draggingFromNodeId}"]`);
                if (sourceElem) {
                    const sourceRect = sourceElem.getBoundingClientRect();
                    startX = sourceRect.right - containerRect.left - 5;
                    startY = sourceRect.top + sourceRect.height/2 - containerRect.top;
                }
            }
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

function onGlobalMouseUp(e) {
    if (isDraggingPort) {
        isDraggingPort = false;
        draggingPortNodeId = null;
        draggingPortField = null;
        return;
    }
    if (isDraggingNode) {
        isDraggingNode = false;
        currentNodeMoving = null;
        // 只有发生过拖拽移动才重建画布，避免“点击但未移动”导致 click 选中事件丢失
        if (didMoveNode) {
            // 拖拽结束后，可能会触发一次 click；忽略下一次 click 防止误选中
            ignoreNextClick = true;
            renderCanvas();
        }
        didMoveNode = false;
    }
    if (isDraggingConnection && draggingFromNodeId !== null) {
        const hitEls = document.elementsFromPoint(e.clientX, e.clientY);
        const targetElem = hitEls
            .map(el => (el && el.closest) ? el.closest('.flow-node') : null)
            .find(el => el && el.classList && el.classList.contains('flow-node'));
        if (targetElem) {
            const targetId = parseInt(targetElem.getAttribute('data-id'));
            if (targetId && targetId !== draggingFromNodeId) {
                createConnection(draggingFromNodeId, targetId, draggingFromField);
            }
        }
        if (tempLine) {
            tempLine.remove();
            tempLine = null;
        }
        isDraggingConnection = false;
        draggingFromNodeId = null;
        draggingFromField = null;
    }
}

function createConnection(sourceId, targetId, fieldOverride = null) {
    const sourceNode = state.nodes.get(sourceId);
    const targetNode = state.nodes.get(targetId);
    if (!sourceNode || !targetNode) return;

    // 如果从“指定端口”发起连线，则直接写入对应字段，不再弹窗选择。
    if (fieldOverride) {
        if (fieldOverride === 'loopBody') {
            if (sourceNode.type !== 'loop') return;
            if (!attachNodeToContainer(targetNode, sourceNode, 'loopBody')) {
                addConsoleLog(`Cannot place node ${targetId} into container ${sourceId}: nesting would create a cycle`, "error");
                return;
            }
            addConsoleLog(`Added to loop body: ${sourceId} += ${targetId}`, "info");
            renderCanvas();
            if (state.selectedNodeId === sourceId) renderPropertiesPanel();
            return;
        }
        if (fieldOverride === 'trueBody' || fieldOverride === 'falseBody') {
            if (sourceNode.type !== 'branch') return;
            if (!attachNodeToContainer(targetNode, sourceNode, fieldOverride)) {
                addConsoleLog(`Cannot place node ${targetId} into container ${sourceId}: nesting would create a cycle`, "error");
                return;
            }
            addConsoleLog(`Added to branch body: ${sourceId} += ${targetId} (${fieldOverride})`, "info");
            renderCanvas();
            if (state.selectedNodeId === sourceId) renderPropertiesPanel();
            return;
        }
        sourceNode.properties[fieldOverride] = targetId;
        addConsoleLog(`连接: ${sourceId} → ${targetId} (${fieldOverride})`, "info");
        renderCanvas();
        if (state.selectedNodeId === sourceId) renderPropertiesPanel();
        return;
    }

    let fieldOptions = [];
    if (sourceNode.type === 'start' || sourceNode.type === 'print' || sourceNode.type === 'sequence') {
        fieldOptions = ['nextNodeId'];
    } else if (sourceNode.type === 'loop') {
        fieldOptions = ['loopBody', 'nextNodeId'];
    } else if (sourceNode.type === 'branch') {
        fieldOptions = ['trueBody', 'falseBody', 'nextNodeId'];
    } else {
        fieldOptions = ['nextNodeId'];
    }

    if (fieldOptions.length === 1) {
        sourceNode.properties[fieldOptions[0]] = targetId;
        addConsoleLog(`连接: ${sourceId} → ${targetId} (${fieldOptions[0]})`, "info");
    } else {
        const choice = prompt(`请选择连接类型:\n${fieldOptions.join(', ')}`, fieldOptions[0]);
        if (choice && fieldOptions.includes(choice)) {
            sourceNode.properties[choice] = targetId;
            addConsoleLog(`连接: ${sourceId} → ${targetId} (${choice})`, "info");
        }
    }
    renderCanvas();
    if (state.selectedNodeId === sourceId) renderPropertiesPanel();
}

function setupGlobalDragEvents() {
    document.removeEventListener("mousemove", onGlobalMouseMove);
    document.removeEventListener("mouseup", onGlobalMouseUp);
    document.addEventListener("mousemove", onGlobalMouseMove);
    document.addEventListener("mouseup", onGlobalMouseUp);
}

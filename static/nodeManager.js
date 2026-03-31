import { state, setExpandedPropertyNodeIds, setNextId, setNodes, setSelectedNodeIds } from './appStore.js';
import { addConsoleLog, escapeHtml } from './appUtils.js';

const NODE_W = 180;
const NODE_H = 80;
const LOOP_HEADER_H = 54;
const BRANCH_HEADER_H = 54;
const ROOT_GAP_X = 56;
const ROOT_GAP_Y = 56;
const CHILD_STACK_GAP = 18;
const CANVAS_PADDING = 48;
const DELETE_SWEEP_RADIUS = 26;
const PASTE_OFFSET_STEP = 28;
const MAX_UNDO_HISTORY = 80;

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
function buildChildrenByParent() {
    const childrenByParent = new Map();
    for (let node of state.nodes.values()) {
        if (node.parentId == null) continue;
        if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
        childrenByParent.get(node.parentId).push(node);
    }
    return childrenByParent;
}

function getOrderedChildNodes(parentNode, side = null) {
    if (!parentNode) return [];

    if (parentNode.type === 'loop') {
        const ids = Array.isArray(parentNode.properties?.bodyNodeIds) ? parentNode.properties.bodyNodeIds : [];
        return ids.map(id => state.nodes.get(id)).filter(node => node && node.parentId === parentNode.id);
    }

    if (parentNode.type === 'branch') {
        const key = side === 'false' ? 'falseBodyNodeIds' : 'trueBodyNodeIds';
        const ids = Array.isArray(parentNode.properties?.[key]) ? parentNode.properties[key] : [];
        return ids
            .map(id => state.nodes.get(id))
            .filter(node => node && node.parentId === parentNode.id && (node.properties?.branchSide || 'true') === (side || 'true'));
    }

    return [];
}

function computeLocalBounds(nodes, childrenByParent = buildChildrenByParent()) {
    if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    let maxX = 0;
    let maxY = 0;
    for (let node of nodes) {
        const box = getNodeBox(node, childrenByParent);
        maxX = Math.max(maxX, (node.localX || 0) + box.width);
        maxY = Math.max(maxY, (node.localY || 0) + box.height);
    }
    return { minX: 0, minY: 0, maxX, maxY };
}

function getNodeBox(node, childrenByParent = buildChildrenByParent()) {
    if (!node) return { width: NODE_W, height: NODE_H };

    if (node.type === 'loop') {
        const kids = getOrderedChildNodes(node);
        const bounds = computeLocalBounds(kids, childrenByParent);
        const pad = 16;
        const minW = node.properties?.minWidth || 260;
        const minH = node.properties?.minHeight || 180;
        return {
            width: Math.max(minW, bounds.maxX + pad * 2),
            height: Math.max(minH, LOOP_HEADER_H + bounds.maxY + pad * 2 + 40)
        };
    }

    if (node.type === 'branch') {
        const trueKids = getOrderedChildNodes(node, 'true');
        const falseKids = getOrderedChildNodes(node, 'false');
        const trueBounds = computeLocalBounds(trueKids, childrenByParent);
        const falseBounds = computeLocalBounds(falseKids, childrenByParent);
        const pad = 18;
        const minW = node.properties?.minWidth || 320;
        const minH = node.properties?.minHeight || 200;
        const colW = Math.max(trueBounds.maxX, falseBounds.maxX, 160) + pad * 2;
        const bodyH = Math.max(trueBounds.maxY, falseBounds.maxY, 140) + pad * 2;
        return {
            width: Math.max(minW, colW * 2 + 40),
            height: Math.max(minH, BRANCH_HEADER_H + bodyH + 40)
        };
    }

    return { width: NODE_W, height: NODE_H };
}

function getNodePosition(node) {
    if (!node) return { x: 0, y: 0 };
    return node.parentId != null
        ? { x: node.localX || 0, y: node.localY || 0 }
        : { x: node.x || 0, y: node.y || 0 };
}

function setNodePosition(node, x, y) {
    if (!node) return;
    if (node.parentId != null) {
        node.localX = x;
        node.localY = y;
    } else {
        node.x = x;
        node.y = y;
    }
}

function getSiblingNodes(node) {
    return getSiblingNodesExcluding(node);
}

function getSiblingNodesExcluding(node, excludedIds = []) {
    const siblings = [];
    const excluded = new Set(excludedIds);
    for (let other of state.nodes.values()) {
        if (!other || other.id === node.id) continue;
        if (excluded.has(other.id)) continue;
        if (other.parentId !== node.parentId) continue;

        if (node.parentId != null) {
            const parentNode = state.nodes.get(node.parentId);
            if (parentNode?.type === 'branch') {
                const nodeSide = node.properties?.branchSide || 'true';
                const otherSide = other.properties?.branchSide || 'true';
                if (nodeSide !== otherSide) continue;
            }
        }

        siblings.push(other);
    }
    return siblings;
}

function getNodeRect(node, pos = getNodePosition(node), childrenByParent = buildChildrenByParent()) {
    const box = getNodeBox(node, childrenByParent);
    return {
        x: pos.x,
        y: pos.y,
        width: box.width,
        height: box.height
    };
}

function overlapArea(a, b) {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (width <= 0 || height <= 0) return 0;
    return width * height;
}

function rectsOverlap(a, b, padding = 18) {
    return a.x < b.x + b.width + padding &&
        a.x + a.width + padding > b.x &&
        a.y < b.y + b.height + padding &&
        a.y + a.height + padding > b.y;
}

function buildCandidateOffsets(ring) {
    if (ring === 0) return [[0, 0]];

    const offsets = [];
    for (let dx = -ring; dx <= ring; dx++) {
        offsets.push([dx, -ring], [dx, ring]);
    }
    for (let dy = -ring + 1; dy <= ring - 1; dy++) {
        offsets.push([-ring, dy], [ring, dy]);
    }
    return offsets;
}

function getNonOverlappingCandidates(node, desiredX, desiredY, childrenByParent = buildChildrenByParent(), options = {}) {
    const siblings = getSiblingNodesExcluding(node, options.excludedIds || []);
    const occupiedRects = Array.isArray(options.occupiedRects) ? options.occupiedRects : [];
    const box = getNodeBox(node, childrenByParent);
    const minX = node.parentId != null ? 12 : CANVAS_PADDING / 2;
    const minY = node.parentId != null ? 16 : CANVAS_PADDING / 2;
    const stepX = node.parentId != null ? 24 : 36;
    const stepY = node.parentId != null ? 22 : 30;
    const candidates = [];
    const seen = new Set();

    const pushCandidate = (x, y) => {
        const key = `${x},${y}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ x, y });
    };

    for (let ring = 0; ring < 24; ring++) {
        const offsets = buildCandidateOffsets(ring);
        for (let [dx, dy] of offsets) {
            const candidate = {
                x: Math.max(minX, desiredX + dx * stepX),
                y: Math.max(minY, desiredY + dy * stepY),
                width: box.width,
                height: box.height
            };

            const hasCollision = siblings.some(other => {
                const otherPos = getNodePosition(other);
                const otherBox = getNodeBox(other, childrenByParent);
                return rectsOverlap(candidate, {
                    x: otherPos.x,
                    y: otherPos.y,
                    width: otherBox.width,
                    height: otherBox.height
                });
            }) || occupiedRects.some(rect => rectsOverlap(candidate, rect));

            if (!hasCollision) {
                pushCandidate(candidate.x, candidate.y);
            }
        }
    }

    if (candidates.length > 0) return candidates;

    let fallbackY = Math.max(minY, desiredY);
    for (let sibling of siblings) {
        const siblingPos = getNodePosition(sibling);
        const siblingBox = getNodeBox(sibling, childrenByParent);
        fallbackY = Math.max(fallbackY, siblingPos.y + siblingBox.height + CHILD_STACK_GAP);
    }
    pushCandidate(Math.max(minX, desiredX), fallbackY);
    return candidates;
}

function findNonOverlappingPosition(node, desiredX, desiredY, childrenByParent = buildChildrenByParent(), options = {}) {
    return getNonOverlappingCandidates(node, desiredX, desiredY, childrenByParent, options)[0];
}

export function placeNodeWithoutOverlapById(nodeId, preferred = null) {
    const node = state.nodes.get(nodeId);
    if (!node) return;
    const childrenByParent = buildChildrenByParent();
    const current = preferred || getNodePosition(node);
    const nextPos = findNonOverlappingPosition(node, current.x, current.y, childrenByParent);
    setNodePosition(node, nextPos.x, nextPos.y);
}

function queueNodePositionAnimation(nodeId, fromPos, toPos) {
    if (!fromPos || !toPos) return;
    const dx = fromPos.x - toPos.x;
    const dy = fromPos.y - toPos.y;
    if (dx === 0 && dy === 0) return;
    pendingPositionAnimations.set(nodeId, { dx, dy });
}

function findBestOverlappingSibling(node) {
    if (!node) return null;

    const childrenByParent = buildChildrenByParent();
    const nodeRect = getNodeRect(node, getNodePosition(node), childrenByParent);
    let best = null;
    let bestArea = 0;

    for (let sibling of getSiblingNodes(node)) {
        const siblingRect = getNodeRect(sibling, getNodePosition(sibling), childrenByParent);
        const area = overlapArea(nodeRect, siblingRect);
        if (area > bestArea) {
            best = sibling;
            bestArea = area;
        }
    }

    return bestArea > 0 ? best : null;
}

function distanceSquared(a, b) {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function findBestSwapPositions(nodeA, nodeB, targetA, targetB, childrenByParent) {
    const excludedIds = [nodeA.id, nodeB.id];
    const candidatesA = getNonOverlappingCandidates(nodeA, targetA.x, targetA.y, childrenByParent, {
        excludedIds
    }).slice(0, 18);
    const candidatesB = getNonOverlappingCandidates(nodeB, targetB.x, targetB.y, childrenByParent, {
        excludedIds
    }).slice(0, 18);

    let best = null;
    let bestScore = Infinity;

    for (let posA of candidatesA) {
        const rectA = getNodeRect(nodeA, posA, childrenByParent);
        for (let posB of candidatesB) {
            const rectB = getNodeRect(nodeB, posB, childrenByParent);
            if (rectsOverlap(rectA, rectB)) continue;

            const score = distanceSquared(posA, targetA) + distanceSquared(posB, targetB);
            if (score < bestScore) {
                best = { nextA: posA, nextB: posB };
                bestScore = score;
            }
        }
    }

    if (best) return best;

    const nextA = candidatesA[0] || targetA;
    const rectA = getNodeRect(nodeA, nextA, childrenByParent);
    const nextB = findNonOverlappingPosition(nodeB, targetB.x, targetB.y, childrenByParent, {
        excludedIds,
        occupiedRects: [rectA]
    });
    return { nextA, nextB };
}

function swapNodePositions(nodeA, nodeB, fallbackForB = null) {
    if (!nodeA || !nodeB) return false;

    const posA = getNodePosition(nodeA);
    const posB = getNodePosition(nodeB);
    const childrenByParent = buildChildrenByParent();
    const desiredA = { x: posB.x, y: posB.y };
    const desiredB = fallbackForB || { x: posA.x, y: posA.y };
    const { nextA, nextB } = findBestSwapPositions(nodeA, nodeB, desiredA, desiredB, childrenByParent);

    setNodePosition(nodeA, nextA.x, nextA.y);
    setNodePosition(nodeB, nextB.x, nextB.y);
    queueNodePositionAnimation(nodeA.id, posA, nextA);
    queueNodePositionAnimation(nodeB.id, posB, nextB);

    if (nodeA.parentId != null) {
        const parent = state.nodes.get(nodeA.parentId);
        syncContainerOrderFromPositions(parent);
    }
    return true;
}

function insertNodeIdAfter(arr, nodeId, afterId) {
    const filtered = arr.filter(id => id !== nodeId);
    const idx = filtered.indexOf(afterId);
    if (idx === -1) {
        filtered.push(nodeId);
        return filtered;
    }
    filtered.splice(idx + 1, 0, nodeId);
    return filtered;
}

function attachNodeIntoSourceContainer(targetNode, sourceNode) {
    if (!targetNode || !sourceNode || sourceNode.parentId == null) return false;

    const parentNode = state.nodes.get(sourceNode.parentId);
    if (!parentNode) return false;

    const sourceSide = sourceNode.properties?.branchSide || 'true';
    const slot = parentNode.type === 'loop'
        ? 'loopBody'
        : (sourceSide === 'false' ? 'falseBody' : 'trueBody');

    if (!attachNodeToContainer(targetNode, parentNode, slot)) return false;

    if (parentNode.type === 'loop') {
        parentNode.properties.bodyNodeIds = insertNodeIdAfter(parentNode.properties.bodyNodeIds || [], targetNode.id, sourceNode.id);
    } else if (parentNode.type === 'branch') {
        const key = sourceSide === 'false' ? 'falseBodyNodeIds' : 'trueBodyNodeIds';
        parentNode.properties[key] = insertNodeIdAfter(parentNode.properties[key] || [], targetNode.id, sourceNode.id);
    }

    layoutContainerChildren(parentNode);
    return true;
}

function getContainerInsertPosition(parentNode, side = null) {
    const children = getOrderedChildNodes(parentNode, side);
    const x = 18;
    let y = parentNode?.type === 'branch' ? 28 : 18;

    for (let child of children) {
        const box = getNodeBox(child);
        y = Math.max(y, (child.localY || 0) + box.height + CHILD_STACK_GAP);
    }

    return { x, y };
}

function syncContainerOrderFromPositions(parentNode) {
    if (!parentNode) return;

    if (parentNode.type === 'loop') {
        parentNode.properties.bodyNodeIds = getOrderedChildNodes(parentNode)
            .sort((a, b) => (a.localY - b.localY) || (a.localX - b.localX) || (a.id - b.id))
            .map(node => node.id);
        return;
    }

    if (parentNode.type === 'branch') {
        const buildSide = (side, key) => {
            parentNode.properties[key] = getOrderedChildNodes(parentNode, side)
                .sort((a, b) => (a.localY - b.localY) || (a.localX - b.localX) || (a.id - b.id))
                .map(node => node.id);
        };
        buildSide('true', 'trueBodyNodeIds');
        buildSide('false', 'falseBodyNodeIds');
    }
}

function layoutContainerChildren(parentNode) {
    if (!parentNode) return;

    if (parentNode.type === 'loop') {
        let y = 18;
        for (let child of getOrderedChildNodes(parentNode)) {
            child.localX = 18;
            child.localY = y;
            const box = getNodeBox(child);
            y += box.height + CHILD_STACK_GAP;
        }
        return;
    }

    if (parentNode.type === 'branch') {
        const layoutSide = (side) => {
            let y = 28;
            for (let child of getOrderedChildNodes(parentNode, side)) {
                child.localX = 18;
                child.localY = y;
                const box = getNodeBox(child);
                y += box.height + CHILD_STACK_GAP;
            }
        };
        layoutSide('true');
        layoutSide('false');
    }
}

function autoArrangeContainerTree(node) {
    if (!node) return;

    if (node.type === 'loop') {
        for (let child of getOrderedChildNodes(node)) autoArrangeContainerTree(child);
        layoutContainerChildren(node);
        return;
    }

    if (node.type === 'branch') {
        for (let child of getOrderedChildNodes(node, 'true')) autoArrangeContainerTree(child);
        for (let child of getOrderedChildNodes(node, 'false')) autoArrangeContainerTree(child);
        layoutContainerChildren(node);
    }
}

function collectRootChains() {
    const roots = Array.from(state.nodes.values()).filter(node => node.parentId == null);
    const startRoots = roots.filter(node => node.type === 'start').sort((a, b) => a.id - b.id);
    const otherRoots = roots.filter(node => node.type !== 'start').sort((a, b) => a.id - b.id);
    const visited = new Set();
    const chains = [];

    const consumeChain = (entryNode) => {
        if (!entryNode || visited.has(entryNode.id)) return;

        const chain = [];
        let current = entryNode;
        while (current && !visited.has(current.id) && current.parentId == null) {
            visited.add(current.id);
            chain.push(current);

            const nextId = current.properties?.nextNodeId;
            const nextNode = nextId ? state.nodes.get(nextId) : null;
            if (!nextNode || nextNode.parentId != null || visited.has(nextNode.id)) break;
            current = nextNode;
        }
        if (chain.length) chains.push(chain);
    };

    startRoots.forEach(consumeChain);
    otherRoots.forEach(consumeChain);

    for (let root of roots) {
        if (!visited.has(root.id)) chains.push([root]);
    }

    return chains;
}

export function autoArrangeNodes() {
    const beforeSnapshot = snapshotCanvasState();
    const roots = Array.from(state.nodes.values()).filter(node => node.parentId == null);
    roots.forEach(autoArrangeContainerTree);

    const chains = collectRootChains();
    let cursorY = CANVAS_PADDING;

    for (let chain of chains) {
        let cursorX = CANVAS_PADDING;
        let rowHeight = 0;

        for (let node of chain) {
            const box = getNodeBox(node);
            node.x = cursorX;
            node.y = cursorY;
            cursorX += box.width + ROOT_GAP_X;
            rowHeight = Math.max(rowHeight, box.height);
        }

        cursorY += rowHeight + ROOT_GAP_Y;
    }

    pushUndoSnapshot(beforeSnapshot);
    renderCanvas();
}

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

function getSelectedNodeIds() {
    const fallback = typeof state.selectedNodeId === 'number' ? [state.selectedNodeId] : [];
    const ids = Array.isArray(state.selectedNodeIds) && state.selectedNodeIds.length
        ? state.selectedNodeIds
        : fallback;
    const validIds = ids.filter(id => state.nodes.has(id));

    if (validIds.length !== ids.length || (state.selectedNodeId != null && !state.nodes.has(state.selectedNodeId))) {
        setSelectedNodeIds(validIds, validIds.includes(state.selectedNodeId) ? state.selectedNodeId : (validIds[0] ?? null));
    }

    return validIds;
}

function isNodeSelected(nodeId) {
    return getSelectedNodeIds().includes(nodeId);
}

function getPrimarySelectedNodeId() {
    const ids = getSelectedNodeIds();
    if (typeof state.selectedNodeId === 'number' && ids.includes(state.selectedNodeId)) return state.selectedNodeId;
    return ids[0] ?? null;
}

function updateSelection(ids, primaryId = null, expandedIds = ids) {
    const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(id => state.nodes.has(id))));
    setSelectedNodeIds(uniqueIds, primaryId);
    setExpandedPropertyNodeIds(Array.isArray(expandedIds) ? expandedIds.filter(id => uniqueIds.includes(id)) : uniqueIds);
}

function toggleNodeSelection(nodeId) {
    const currentIds = getSelectedNodeIds();
    if (currentIds.includes(nodeId)) {
        const nextIds = currentIds.filter(id => id !== nodeId);
        updateSelection(nextIds, nextIds[nextIds.length - 1] ?? null, state.expandedPropertyNodeIds);
    } else {
        updateSelection([...currentIds, nodeId], nodeId, [...(state.expandedPropertyNodeIds || []), nodeId]);
    }
    renderCanvas();
    renderPropertiesPanel();
}

function getSelectedNodes() {
    return getSelectedNodeIds()
        .map(id => state.nodes.get(id))
        .filter(Boolean);
}

function snapshotCanvasState() {
    return {
        nodes: cloneData(Array.from(state.nodes.values())),
        nextId: state.nextId,
        selectedNodeId: getPrimarySelectedNodeId(),
        selectedNodeIds: cloneData(getSelectedNodeIds()),
        expandedPropertyNodeIds: cloneData(state.expandedPropertyNodeIds || [])
    };
}

function serializeCanvasSnapshot(snapshot) {
    return JSON.stringify(snapshot);
}

function restoreCanvasSnapshot(snapshot) {
    if (!snapshot) return;

    const nodes = new Map();
    for (let node of cloneData(snapshot.nodes || [])) {
        nodes.set(node.id, node);
    }

    setNodes(nodes);
    setNextId(snapshot.nextId ?? 100);
    setSelectedNodeIds(snapshot.selectedNodeIds || [], snapshot.selectedNodeId ?? null);
    setExpandedPropertyNodeIds(snapshot.expandedPropertyNodeIds || []);
}

const undoHistory = [];
let isRestoringHistory = false;

function syncUndoUiState() {
    const undoBtn = document.getElementById('undoCanvasBtn');
    if (undoBtn) undoBtn.disabled = undoHistory.length === 0;

    const menu = document.getElementById('canvasContextMenu');
    if (menu) {
        const undoMenuBtn = menu.querySelector('[data-menu-action="undo"]');
        if (undoMenuBtn) undoMenuBtn.disabled = undoHistory.length === 0;
    }
}

function pushUndoSnapshot(beforeSnapshot, afterSnapshot = snapshotCanvasState()) {
    if (isRestoringHistory || !beforeSnapshot) return false;

    const beforeSerialized = serializeCanvasSnapshot(beforeSnapshot);
    const afterSerialized = serializeCanvasSnapshot(afterSnapshot);
    if (beforeSerialized === afterSerialized) return false;
    if (undoHistory.length && undoHistory[undoHistory.length - 1].serialized === beforeSerialized) {
        syncUndoUiState();
        return false;
    }

    undoHistory.push({ serialized: beforeSerialized, snapshot: beforeSnapshot });
    if (undoHistory.length > MAX_UNDO_HISTORY) undoHistory.shift();
    syncUndoUiState();
    return true;
}

export function canUndoCanvasChange() {
    return undoHistory.length > 0;
}

export function captureCanvasHistorySnapshot() {
    return snapshotCanvasState();
}

export function commitCanvasHistorySnapshot(beforeSnapshot) {
    return pushUndoSnapshot(beforeSnapshot);
}

export function resetCanvasHistory() {
    undoHistory.length = 0;
    syncUndoUiState();
}

export function undoCanvasChange() {
    if (!undoHistory.length) return false;
    const entry = undoHistory.pop();
    isRestoringHistory = true;
    try {
        restoreCanvasSnapshot(entry.snapshot);
        hideCanvasContextMenu();
        renderCanvas();
        renderPropertiesPanel();
        addConsoleLog('已撤回上一步画布修改。', 'info');
    } finally {
        isRestoringHistory = false;
        syncUndoUiState();
    }
    return true;
}

function collectDescendantIds(rootId, bucket = new Set()) {
    if (!state.nodes.has(rootId) || bucket.has(rootId)) return bucket;
    bucket.add(rootId);
    for (let node of state.nodes.values()) {
        if (node.parentId === rootId) collectDescendantIds(node.id, bucket);
    }
    return bucket;
}

function deleteNodesByIds(ids, options = {}) {
    const idsToDelete = new Set();
    (Array.isArray(ids) ? ids : []).forEach(id => collectDescendantIds(id, idsToDelete));
    if (!idsToDelete.size) return;
    const beforeSnapshot = options.skipHistory ? null : snapshotCanvasState();

    for (let node of state.nodes.values()) {
        if (idsToDelete.has(node.id)) continue;
        if (node.type === 'loop' && Array.isArray(node.properties.bodyNodeIds)) {
            node.properties.bodyNodeIds = node.properties.bodyNodeIds.filter(x => !idsToDelete.has(x));
        }
        if (node.type === 'branch') {
            if (node.properties.trueBranchId != null && idsToDelete.has(node.properties.trueBranchId)) node.properties.trueBranchId = null;
            if (node.properties.falseBranchId != null && idsToDelete.has(node.properties.falseBranchId)) node.properties.falseBranchId = null;
            if (Array.isArray(node.properties.trueBodyNodeIds)) {
                node.properties.trueBodyNodeIds = node.properties.trueBodyNodeIds.filter(x => !idsToDelete.has(x));
            }
            if (Array.isArray(node.properties.falseBodyNodeIds)) {
                node.properties.falseBodyNodeIds = node.properties.falseBodyNodeIds.filter(x => !idsToDelete.has(x));
            }
        }
        if (node.properties?.nextNodeId != null && idsToDelete.has(node.properties.nextNodeId)) {
            node.properties.nextNodeId = null;
        }
    }

    idsToDelete.forEach(id => state.nodes.delete(id));

    const remainingSelected = getSelectedNodeIds().filter(id => !idsToDelete.has(id));
    updateSelection(remainingSelected, remainingSelected[remainingSelected.length - 1] ?? null, (state.expandedPropertyNodeIds || []).filter(id => !idsToDelete.has(id)));
    if (!options.skipHistory) pushUndoSnapshot(beforeSnapshot);
    renderCanvas();
    renderPropertiesPanel();

    if (!options.silent) {
        addConsoleLog(`删除节点 ${Array.from(idsToDelete).join(', ')}`, "info");
    }
}

// 删除节点
export function deleteNodeById(id) {
    deleteNodesByIds([id]);
}

export function deleteSelectedNodes() {
    deleteNodesByIds(getSelectedNodeIds());
}

// 选中节点
export function setSelectedNode(id) {
    if (typeof id === 'number' && state.nodes.has(id)) {
        updateSelection([id], id, [id]);
    } else {
        updateSelection([], null, []);
    }
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

    if (slot === 'loopBody') {
        const arr = Array.isArray(parentNode.properties.bodyNodeIds) ? parentNode.properties.bodyNodeIds : [];
        if (!arr.includes(targetNode.id)) arr.push(targetNode.id);
        parentNode.properties.bodyNodeIds = arr;
        const insertPos = getContainerInsertPosition(parentNode);
        targetNode.localX = insertPos.x;
        targetNode.localY = insertPos.y;
        placeNodeWithoutOverlapById(targetNode.id, insertPos);
        syncContainerOrderFromPositions(parentNode);
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
        const insertPos = getContainerInsertPosition(parentNode, side);
        targetNode.localX = insertPos.x;
        targetNode.localY = insertPos.y;
        placeNodeWithoutOverlapById(targetNode.id, insertPos);
        syncContainerOrderFromPositions(parentNode);
        return true;
    }

    return false;
}

function getNodeNameOptions(selectedId, includeNone = false) {
    const noneOption = includeNone ? `<option value="" ${selectedId == null ? 'selected' : ''}>无</option>` : '';
    return noneOption + Array.from(state.nodes.values())
        .map(n => {
            const nm = escapeHtml(n.properties?.name || typeLabel(n.type));
            return `<option value="${n.id}" ${selectedId == n.id ? 'selected' : ''}>${nm}</option>`;
        })
        .join('');
}

function getNodeContextInfo(node) {
    if (!node || node.parentId == null) return [];
    const parentNode = state.nodes.get(node.parentId);
    if (!parentNode) return ['所在容器：已失效'];

    const parentName = escapeHtml(parentNode.properties?.name || typeLabel(parentNode.type));
    if (parentNode.type === 'loop') {
        const ids = Array.isArray(parentNode.properties?.bodyNodeIds) ? parentNode.properties.bodyNodeIds : [];
        const index = ids.indexOf(node.id);
        return [
            `所在循环体：${parentName}`,
            index >= 0 ? `循环体顺序：第 ${index + 1} 个` : '循环体顺序：未记录'
        ];
    }

    if (parentNode.type === 'branch') {
        const side = node.properties?.branchSide === 'false' ? '假分支' : '真分支';
        const key = node.properties?.branchSide === 'false' ? 'falseBodyNodeIds' : 'trueBodyNodeIds';
        const ids = Array.isArray(parentNode.properties?.[key]) ? parentNode.properties[key] : [];
        const index = ids.indexOf(node.id);
        return [
            `所在分支体：${parentName} / ${side}`,
            index >= 0 ? `${side}顺序：第 ${index + 1} 个` : `${side}顺序：未记录`
        ];
    }

    return [];
}

function renderContainerBodyList(node, ids, actionPrefix, emptyText) {
    const safeIds = Array.isArray(ids) ? ids : [];
    return safeIds.map((id, idx) => {
        const child = state.nodes.get(id);
        const title = child
            ? `${escapeHtml(child.properties?.name || typeLabel(child.type))} (#${id})`
            : `未知节点 (#${id})`;
        return `<div class="prop-row-inline">
            <div class="prop-row-text">${idx + 1}. ${title}</div>
            <button class="prop-btn" data-node-id="${node.id}" data-action="${actionPrefix}Up" data-idx="${idx}" title="上移">↑</button>
            <button class="prop-btn" data-node-id="${node.id}" data-action="${actionPrefix}Down" data-idx="${idx}" title="下移">↓</button>
            <button class="prop-btn" data-node-id="${node.id}" data-action="${actionPrefix}Remove" data-idx="${idx}" title="移除">移除</button>
        </div>`;
    }).join('') || `<div class="help-text">${emptyText}</div>`;
}

function renderNodePropertyEditor(node, options = {}) {
    const props = node.properties || {};
    const contextInfo = getNodeContextInfo(node)
        .map(text => `<div class="prop-meta-item">${text}</div>`)
        .join('');

    let html = `<div class="prop-group">
        <div class="prop-label">节点类型: <strong>${typeLabel(node.type)}</strong></div>
        ${contextInfo ? `<div class="prop-meta">${contextInfo}</div>` : ''}
    </div>`;

    html += `<div class="prop-group">
        <label class="prop-label">节点名称（同类型不可重名）</label>
        <input class="prop-input" data-node-id="${node.id}" data-field="name" value="${escapeHtml(props.name || '')}" placeholder="请输入节点名称">
    </div>`;

    if (node.type === 'start') {
        html += `<div class="prop-group"><label class="prop-label">下一个节点（顺序流）</label>
        <select class="prop-select" data-node-id="${node.id}" data-field="nextNodeId">${getNodeNameOptions(props.nextNodeId, true)}</select></div>`;
    } else if (node.type === 'print') {
        html += `<div class="prop-group"><label class="prop-label">打印消息</label>
        <input class="prop-input" data-node-id="${node.id}" data-field="message" value="${escapeHtml(props.message || '')}" placeholder="输出内容"></div>
        <div class="prop-group"><label class="prop-label">执行后下一节点</label>
        <select class="prop-select" data-node-id="${node.id}" data-field="nextNodeId">${getNodeNameOptions(props.nextNodeId, true)}</select></div>`;
    } else if (node.type === 'sequence') {
        html += `<div class="prop-group"><label class="prop-label">备注</label>
        <input class="prop-input" data-node-id="${node.id}" data-field="comment" value="${escapeHtml(props.comment || '')}"></div>
        <div class="prop-group"><label class="prop-label">下一节点</label>
        <select class="prop-select" data-node-id="${node.id}" data-field="nextNodeId">${getNodeNameOptions(props.nextNodeId, true)}</select></div>`;
    } else if (node.type === 'loop') {
        const condType = props.loopConditionType || 'count';
        html += `<div class="prop-group"><label class="prop-label">循环条件类型</label>
            <select class="prop-select" data-node-id="${node.id}" data-field="loopConditionType">
                <option value="count" ${condType === 'count' ? 'selected' : ''}>按次数</option>
                <option value="expr" ${condType === 'expr' ? 'selected' : ''}>表达式（占位）</option>
            </select>
        </div>`;
        html += `<div class="prop-group"><label class="prop-label">循环次数</label>
            <input class="prop-input" type="number" data-node-id="${node.id}" data-field="loopCount" value="${props.loopCount ?? 1}" min="1">
        </div>`;
        html += `<div class="prop-group"><label class="prop-label">循环表达式（占位）</label>
            <input class="prop-input" data-node-id="${node.id}" data-field="loopConditionExpr" value="${escapeHtml(props.loopConditionExpr || '')}" placeholder="例如: i &lt; 5">
        </div>`;
        html += `<div class="prop-group"><label class="prop-label">循环体节点顺序</label>
            ${renderContainerBodyList(node, props.bodyNodeIds, 'loopBody', '循环体为空：从循环节点的循环体端口连线到目标节点即可加入。')}
        </div>`;
        html += `<div class="prop-group"><label class="prop-label">循环结束后节点</label>
            <select class="prop-select" data-node-id="${node.id}" data-field="nextNodeId">${getNodeNameOptions(props.nextNodeId, true)}</select>
        </div>`;
    } else if (node.type === 'branch') {
        const boolVal = props.branchCondition === true;
        html += `<div class="prop-group"><label class="prop-label">分支条件结果（占位）</label>
            <select class="prop-select" data-node-id="${node.id}" data-field="branchCondition">
                <option value="true" ${boolVal ? 'selected' : ''}>真</option>
                <option value="false" ${!boolVal ? 'selected' : ''}>假</option>
            </select>
        </div>`;
        html += `<div class="prop-group"><label class="prop-label">真分支节点顺序</label>
            ${renderContainerBodyList(node, props.trueBodyNodeIds, 'branchTrueBody', '真分支为空：从真分支端口连线到目标节点即可加入。')}
        </div>`;
        html += `<div class="prop-group"><label class="prop-label">假分支节点顺序</label>
            ${renderContainerBodyList(node, props.falseBodyNodeIds, 'branchFalseBody', '假分支为空：从假分支端口连线到目标节点即可加入。')}
        </div>`;
        html += `<div class="prop-group"><label class="prop-label">分支结束后节点</label>
            <select class="prop-select" data-node-id="${node.id}" data-field="nextNodeId">${getNodeNameOptions(props.nextNodeId, true)}</select></div>`;
    }

    if (!options.collapsible) return html;

    const nodeName = escapeHtml(props.name || typeLabel(node.type));
    const subtitle = getNodeContextInfo(node)[1] || `ID: ${node.id}`;
    return `<details class="prop-card" data-node-card-id="${node.id}" ${options.open ? 'open' : ''}>
        <summary class="prop-card-summary">
            <span>${nodeName}</span>
            <span class="prop-card-subtitle">${escapeHtml(subtitle)}</span>
        </summary>
        <div class="prop-card-body">${html}</div>
    </details>`;
}

// 渲染右侧属性面板
function renderPropertiesPanel() {
    const propDiv = document.getElementById("propContent");
    if (!propDiv) return;

    const selectedIds = getSelectedNodeIds();
    const selectedNodes = selectedIds.map(id => state.nodes.get(id)).filter(Boolean);
    if (!selectedNodes.length) {
        propDiv.innerHTML = '<div class="help-text">点击画布中的节点查看并修改属性；按住 Ctrl 再左键可多选节点。</div>';
        return;
    }

    const expandedIds = new Set((state.expandedPropertyNodeIds || []).filter(id => selectedIds.includes(id)));
    if (!expandedIds.size) {
        const primaryId = getPrimarySelectedNodeId();
        if (primaryId != null) expandedIds.add(primaryId);
    }

    let html = '';
    if (selectedNodes.length === 1) {
        html = renderNodePropertyEditor(selectedNodes[0]);
        html += `<div class="help-text">提示：可以通过节点右侧端口拖拽连线；按住 Ctrl 再左键可继续多选。</div>`;
    } else {
        html = `<div class="prop-group">
            <div class="prop-label">已选中 ${selectedNodes.length} 个节点</div>
            <div class="help-text">点击节点名称可展开具体属性，Ctrl + 左键可继续增减选择。</div>
        </div>`;
        html += selectedNodes
            .map(node => renderNodePropertyEditor(node, { collapsible: true, open: expandedIds.has(node.id) }))
            .join('');
    }

    propDiv.innerHTML = html;

    propDiv.querySelectorAll('[data-node-card-id]').forEach(card => {
        card.addEventListener('toggle', () => {
            const nodeId = Number(card.getAttribute('data-node-card-id'));
            const nextExpanded = new Set(state.expandedPropertyNodeIds || []);
            if (card.open) nextExpanded.add(nodeId);
            else nextExpanded.delete(nodeId);
            setExpandedPropertyNodeIds(Array.from(nextExpanded));
        });
    });

    propDiv.querySelectorAll("[data-field][data-node-id]").forEach(el => {
        el.addEventListener("change", () => {
            const nodeId = Number(el.getAttribute("data-node-id"));
            const field = el.getAttribute("data-field");
            const node = state.nodes.get(nodeId);
            if (!node || !field) return;
            const beforeSnapshot = snapshotCanvasState();

            let val = el.value;
            if (field === "loopCount") val = parseInt(val, 10) || 1;
            if (field === "branchCondition") val = (val === "true");
            if (field === "name") {
                const r = ensureUniqueNameWithinType(node.type, val, node.id);
                if (!r.ok) {
                    addConsoleLog(`重命名失败：${r.reason}`, "error");
                    el.value = node.properties?.name || "";
                    return;
                }
                val = r.name;
            }
            if (field === "nextNodeId" || field === "trueBranchId" || field === "falseBranchId") {
                val = val === "" ? null : (isNaN(Number(val)) ? null : Number(val));
            }

            node.properties[field] = val;
            pushUndoSnapshot(beforeSnapshot);
            renderCanvas();
            renderPropertiesPanel();
            addConsoleLog(`更新节点 ${node.id} 属性: ${field}=${val}`, "info");
        });
    });

    propDiv.querySelectorAll("[data-action][data-node-id]").forEach(btn => {
        btn.addEventListener("click", () => {
            const nodeId = Number(btn.getAttribute("data-node-id"));
            const node = state.nodes.get(nodeId);
            if (!node) return;
            const beforeSnapshot = snapshotCanvasState();

            const action = btn.getAttribute("data-action");
            const idx = parseInt(btn.getAttribute("data-idx"), 10);
            let arr = null;
            let side = null;

            if (node.type === 'loop' && action.startsWith('loopBody')) {
                arr = Array.isArray(node.properties.bodyNodeIds) ? [...node.properties.bodyNodeIds] : [];
            } else if (node.type === 'branch' && action.startsWith('branchTrueBody')) {
                arr = Array.isArray(node.properties.trueBodyNodeIds) ? [...node.properties.trueBodyNodeIds] : [];
                side = 'true';
            } else if (node.type === 'branch' && action.startsWith('branchFalseBody')) {
                arr = Array.isArray(node.properties.falseBodyNodeIds) ? [...node.properties.falseBodyNodeIds] : [];
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

            layoutContainerChildren(node);
            pushUndoSnapshot(beforeSnapshot);
            renderCanvas();
            renderPropertiesPanel();
        });
    });
}

function scheduleConnectionRefresh() {
    if (connectionRefreshRaf != null) cancelAnimationFrame(connectionRefreshRaf);
    connectionRefreshRaf = requestAnimationFrame(() => {
        connectionRefreshRaf = requestAnimationFrame(() => {
            connectionRefreshRaf = null;
            drawConnections();
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
    const canvasArea = document.getElementById("canvasArea");
    if (!canvasDiv) return;
    // 移除所有节点元素（含容器内部）
    canvasDiv.querySelectorAll('.flow-node').forEach(div => div.remove());
    canvasDiv.querySelectorAll('.loop-group').forEach(div => div.remove());

    const childrenByParent = buildChildrenByParent();

    if (canvasArea) {
        canvasArea.classList.toggle('tool-connect', state.activeCanvasTool === 'connect');
        canvasArea.classList.toggle('tool-delete', state.activeCanvasTool === 'delete');
    }
    canvasDiv.classList.toggle('delete-sweep-active', isDeleteSweeping);

    const renderNode = (node, mountEl, mode) => {
        const nodeDiv = document.createElement("div");
        nodeDiv.className = "flow-node";
        if (isNodeSelected(node.id)) nodeDiv.classList.add("selected");
        if (state.debugCurrentNodeId === node.id) nodeDiv.classList.add("debug-current");
        if (state.activeCanvasTool === 'connect') nodeDiv.classList.add("connect-mode");
        if (state.activeCanvasTool === 'delete') nodeDiv.classList.add("delete-mode");
        nodeDiv.style.position = "absolute";
        nodeDiv.setAttribute("data-id", node.id);

        if (mode === 'root') {
            nodeDiv.style.left = node.x + "px";
            nodeDiv.style.top = node.y + "px";
        } else {
            nodeDiv.style.left = (node.localX || 0) + "px";
            nodeDiv.style.top = (node.localY || 0) + "px";
        }

        const pendingAnimation = pendingPositionAnimations.get(node.id);
        if (pendingAnimation) {
            pendingPositionAnimations.delete(node.id);
            nodeDiv.style.transform = `translate(${pendingAnimation.dx}px, ${pendingAnimation.dy}px)`;
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
            const { width: w, height: h } = getNodeBox(node, childrenByParent);
            const headerH = node.properties.headerHeight || 54;
            nodeDiv.style.width = w + 'px';
            nodeDiv.style.height = h + 'px';
            const container = nodeDiv.querySelector('.container-children');
            if (container) container.style.height = Math.max(120, h - headerH - 34) + 'px';
        }
        if (node.type === 'branch') {
            const { width: w, height: h } = getNodeBox(node, childrenByParent);
            const headerH = node.properties.headerHeight || 54;
            nodeDiv.style.width = w + 'px';
            nodeDiv.style.height = h + 'px';
            nodeDiv.querySelectorAll('.branch-col').forEach(c => { c.style.height = Math.max(140, h - headerH - 34) + 'px'; });
        }

        nodeDiv.addEventListener("click", (e) => {
            e.stopPropagation();
            if (ignoreNextClick) { ignoreNextClick = false; return; }
            if (e.target?.getAttribute && e.target.getAttribute('data-action') === 'toggleBreakpoint') {
                const beforeSnapshot = snapshotCanvasState();
                node.properties.breakpoint = !node.properties.breakpoint;
                pushUndoSnapshot(beforeSnapshot);
                renderCanvas();
                if (isNodeSelected(node.id)) renderPropertiesPanel();
                return;
            }
            if(e.target.classList && e.target.classList.contains("delete-node-btn")) {
                deleteNodeById(node.id);
                return;
            }
            if (e.ctrlKey || e.metaKey) {
                toggleNodeSelection(node.id);
                return;
            }
            setSelectedNode(node.id);
        });

        nodeDiv.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (e.altKey) return;
            if (e.ctrlKey || e.metaKey) return;
            if(e.target.classList && (e.target.classList.contains("delete-node-btn") || e.target.classList.contains("connect-point") || e.target.classList.contains("breakpoint-dot"))) return;
            e.stopPropagation();
            if (state.activeCanvasTool === 'delete') return;
            if (state.activeCanvasTool !== 'select') return;
            isDraggingNode = true;
            currentNodeMoving = node.id;
            dragStartNodePosition = { ...getNodePosition(node) };
            dragStartCanvasSnapshot = snapshotCanvasState();
            didMoveNode = false;
            ignoreNextClick = false;
            const rect = nodeDiv.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            nodeDiv.style.cursor = "grabbing";
            e.preventDefault();
        });

        mountEl.appendChild(nodeDiv);

        if (pendingAnimation) {
            requestAnimationFrame(() => {
                nodeDiv.style.transition = 'transform 180ms ease, box-shadow 0.1s';
                nodeDiv.style.transform = 'translate(0, 0)';
                nodeDiv.addEventListener('transitionend', () => {
                    nodeDiv.style.transition = 'box-shadow 0.1s';
                    scheduleConnectionRefresh();
                }, { once: true });
            });
        }

        if (node.type === 'loop') {
            const container = nodeDiv.querySelector('.container-children');
            const kids = getOrderedChildNodes(node);
            if (container) for (let kid of kids) renderNode(kid, container, 'child');
        }
        if (node.type === 'branch') {
            const kids = [
                ...getOrderedChildNodes(node, 'true'),
                ...getOrderedChildNodes(node, 'false')
            ];
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
    let maxX = canvasArea?.clientWidth || 0;
    let maxY = canvasArea?.clientHeight || 0;
    for (let node of state.nodes.values()) {
        if (node.parentId != null) continue;
        const box = getNodeBox(node, childrenByParent);
        maxX = Math.max(maxX, (node.x || 0) + box.width + CANVAS_PADDING);
        maxY = Math.max(maxY, (node.y || 0) + box.height + CANVAS_PADDING);
    }
    canvasDiv.style.width = `${Math.max(maxX, (canvasArea?.clientWidth || 0) + 1)}px`;
    canvasDiv.style.height = `${Math.max(maxY, (canvasArea?.clientHeight || 0) + 1)}px`;
    const svg = document.getElementById('connectionsSvg');
    if (svg) {
        svg.setAttribute('width', canvasDiv.style.width);
        svg.setAttribute('height', canvasDiv.style.height);
    }

    document.querySelectorAll('.connect-point').forEach(point => {
        point.removeEventListener('mousedown', onConnectPointMouseDown);
        point.addEventListener('mousedown', onConnectPointMouseDown);
    });

    // 全局拖拽事件（由nodeManager统一管理）
    setupCanvasInteractions();
    setupGlobalDragEvents();

    drawConnections();
    scheduleConnectionRefresh();
    syncUndoUiState();
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
let isPanningCanvas = false;
let panStartX = 0;
let panStartY = 0;
let panStartScrollLeft = 0;
let panStartScrollTop = 0;
let isDeleteSweeping = false;
let deleteSweepMarker = null;
let lastDeletePoint = null;
let deleteSweepStartSnapshot = null;
let didDeleteSweepNodes = false;
let dragStartNodePosition = null;
let dragStartCanvasSnapshot = null;
let portDragStartSnapshot = null;
let didMovePort = false;
const pendingPositionAnimations = new Map();
let connectionRefreshRaf = null;
let clipboardPayload = null;
let clipboardPasteCount = 0;
let contextMenuTargetNodeId = null;
let contextMenuCanvasPoint = null;

function cloneData(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function getCanvasPointFromClient(clientX, clientY) {
    const canvasArea = document.getElementById("canvasArea");
    if (!canvasArea) return { x: CANVAS_PADDING, y: CANVAS_PADDING };
    const rect = canvasArea.getBoundingClientRect();
    return {
        x: clientX - rect.left + canvasArea.scrollLeft,
        y: clientY - rect.top + canvasArea.scrollTop
    };
}

function getRenderedCanvasPosition(node) {
    if (!node) return { x: CANVAS_PADDING, y: CANVAS_PADDING };
    const canvasDiv = document.getElementById("canvas");
    const nodeEl = canvasDiv?.querySelector(`.flow-node[data-id="${node.id}"]`);
    if (canvasDiv && nodeEl) {
        const canvasRect = canvasDiv.getBoundingClientRect();
        const nodeRect = nodeEl.getBoundingClientRect();
        return {
            x: nodeRect.left - canvasRect.left,
            y: nodeRect.top - canvasRect.top
        };
    }
    return node.parentId == null
        ? { x: node.x || 0, y: node.y || 0 }
        : { x: CANVAS_PADDING, y: CANVAS_PADDING };
}

function makeUniqueNameForPaste(type, desiredName, reservedNames = new Set()) {
    const sourceName = String(desiredName || defaultNameForType(type)).trim() || defaultNameForType(type);
    const isTaken = (name) => {
        if (reservedNames.has(name)) return true;
        for (let node of state.nodes.values()) {
            if (node.type !== type) continue;
            const existing = String(node.properties?.name || '').trim();
            if (existing === name) return true;
        }
        return false;
    };

    if (!isTaken(sourceName)) {
        reservedNames.add(sourceName);
        return sourceName;
    }

    let index = 1;
    while (true) {
        const candidate = index === 1 ? `${sourceName}-副本` : `${sourceName}-副本${index}`;
        if (!isTaken(candidate)) {
            reservedNames.add(candidate);
            return candidate;
        }
        index += 1;
    }
}

function getClipboardTargetIds(preferredNodeId = null) {
    const selectedIds = getSelectedNodeIds();
    if (preferredNodeId != null && state.nodes.has(preferredNodeId) && !selectedIds.includes(preferredNodeId)) {
        return [preferredNodeId];
    }
    return selectedIds;
}

function serializeNodesForClipboard(nodeIds) {
    const ids = Array.from(new Set((Array.isArray(nodeIds) ? nodeIds : []).filter(id => state.nodes.has(id))));
    const idSet = new Set(ids);

    return ids.map(id => {
        const node = state.nodes.get(id);
        const canvasPos = getRenderedCanvasPosition(node);
        const box = getNodeBox(node);
        const snapshot = {
            sourceId: node.id,
            type: node.type,
            parentId: idSet.has(node.parentId) ? node.parentId : null,
            x: node.x || 0,
            y: node.y || 0,
            localX: node.localX || 0,
            localY: node.localY || 0,
            canvasX: canvasPos.x,
            canvasY: canvasPos.y,
            width: box.width,
            height: box.height,
            properties: cloneData(node.properties || {})
        };

        snapshot.properties.nextNodeId = null;
        if ('trueBranchId' in snapshot.properties) snapshot.properties.trueBranchId = null;
        if ('falseBranchId' in snapshot.properties) snapshot.properties.falseBranchId = null;

        if (snapshot.type === 'loop') {
            snapshot.properties.bodyNodeIds = (node.properties?.bodyNodeIds || []).filter(childId => idSet.has(childId));
        }
        if (snapshot.type === 'branch') {
            snapshot.properties.trueBodyNodeIds = (node.properties?.trueBodyNodeIds || []).filter(childId => idSet.has(childId));
            snapshot.properties.falseBodyNodeIds = (node.properties?.falseBodyNodeIds || []).filter(childId => idSet.has(childId));
        }
        if (snapshot.parentId == null) delete snapshot.properties.branchSide;

        return snapshot;
    });
}

function getDefaultPastePoint() {
    const canvasArea = document.getElementById("canvasArea");
    if (!canvasArea) return { x: CANVAS_PADDING, y: CANVAS_PADDING };
    return {
        x: canvasArea.scrollLeft + CANVAS_PADDING,
        y: canvasArea.scrollTop + CANVAS_PADDING
    };
}

function hideCanvasContextMenu() {
    const menu = document.getElementById('canvasContextMenu');
    if (menu) {
        menu.classList.remove('open');
        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
    }
    contextMenuTargetNodeId = null;
    contextMenuCanvasPoint = null;
}

function updateCanvasContextMenuState() {
    const menu = document.getElementById('canvasContextMenu');
    if (!menu) return;
    const targetIds = getClipboardTargetIds(contextMenuTargetNodeId);
    const hasSelection = targetIds.length > 0;
    const hasClipboard = !!(clipboardPayload && clipboardPayload.length);

    menu.querySelectorAll('[data-menu-action]').forEach(button => {
        const action = button.getAttribute('data-menu-action');
        const disabled = action === 'undo'
            ? !canUndoCanvasChange()
            : ((action === 'copy' || action === 'cut') ? !hasSelection : !hasClipboard);
        button.disabled = disabled;
    });
}

function showCanvasContextMenu(clientX, clientY, nodeId = null) {
    const menu = document.getElementById('canvasContextMenu');
    if (!menu) return;

    contextMenuTargetNodeId = nodeId;
    contextMenuCanvasPoint = getCanvasPointFromClient(clientX, clientY);
    updateCanvasContextMenuState();

    menu.classList.add('open');
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
        menu.style.left = `${Math.max(8, window.innerWidth - menuRect.width - 8)}px`;
    }
    if (menuRect.bottom > window.innerHeight - 8) {
        menu.style.top = `${Math.max(8, window.innerHeight - menuRect.height - 8)}px`;
    }
}

function bindCanvasContextMenuActions() {
    const menu = document.getElementById('canvasContextMenu');
    if (!menu || menu.dataset.bound === 'true') return;
    menu.dataset.bound = 'true';

    menu.querySelectorAll('[data-menu-action]').forEach(button => {
        button.addEventListener('click', () => {
            const action = button.getAttribute('data-menu-action');
            if (action === 'undo') undoCanvasChange();
            if (action === 'copy') copySelectedNodes(contextMenuTargetNodeId);
            if (action === 'cut') cutSelectedNodes(contextMenuTargetNodeId);
            if (action === 'paste') pasteClipboardNodes();
            hideCanvasContextMenu();
        });
    });
}

export function copySelectedNodes(preferredNodeId = null) {
    const targetIds = getClipboardTargetIds(preferredNodeId);
    if (!targetIds.length) {
        addConsoleLog('没有可复制的节点。', 'error');
        return false;
    }

    clipboardPayload = serializeNodesForClipboard(targetIds);
    clipboardPasteCount = 0;
    updateCanvasContextMenuState();
    addConsoleLog(`已复制 ${targetIds.length} 个节点。`, 'info');
    return true;
}

export function cutSelectedNodes(preferredNodeId = null) {
    const targetIds = getClipboardTargetIds(preferredNodeId);
    if (!targetIds.length) {
        addConsoleLog('没有可剪切的节点。', 'error');
        return false;
    }

    clipboardPayload = serializeNodesForClipboard(targetIds);
    clipboardPasteCount = 0;
    deleteNodesByIds(targetIds, { silent: true });
    updateCanvasContextMenuState();
    addConsoleLog(`已剪切 ${targetIds.length} 个节点。`, 'info');
    return true;
}

export function pasteClipboardNodes() {
    if (!clipboardPayload || !clipboardPayload.length) {
        addConsoleLog('剪贴板中没有可粘贴的节点。', 'error');
        return false;
    }
    const beforeSnapshot = snapshotCanvasState();

    const pasteBase = contextMenuCanvasPoint || getDefaultPastePoint();
    const offset = clipboardPasteCount * PASTE_OFFSET_STEP;
    clipboardPasteCount += 1;

    const rootSnapshots = clipboardPayload.filter(snapshot => snapshot.parentId == null);
    const minRootX = Math.min(...rootSnapshots.map(snapshot => snapshot.canvasX ?? snapshot.x ?? 0));
    const minRootY = Math.min(...rootSnapshots.map(snapshot => snapshot.canvasY ?? snapshot.y ?? 0));
    const idMap = new Map();
    const reservedNames = new Set();

    clipboardPayload.forEach(snapshot => {
        const rootX = pasteBase.x + offset + ((snapshot.canvasX ?? snapshot.x ?? 0) - minRootX);
        const rootY = pasteBase.y + offset + ((snapshot.canvasY ?? snapshot.y ?? 0) - minRootY);
        const clonedNode = createNode(snapshot.type, rootX, rootY);
        clonedNode.properties = cloneData(snapshot.properties || {});
        clonedNode.properties.name = makeUniqueNameForPaste(snapshot.type, clonedNode.properties?.name, reservedNames);
        clonedNode.parentId = null;
        clonedNode.localX = 0;
        clonedNode.localY = 0;
        state.nodes.set(clonedNode.id, clonedNode);
        idMap.set(snapshot.sourceId, clonedNode.id);
    });

    clipboardPayload.forEach(snapshot => {
        const clonedNode = state.nodes.get(idMap.get(snapshot.sourceId));
        if (!clonedNode) return;

        const mappedParentId = snapshot.parentId != null ? idMap.get(snapshot.parentId) : null;
        if (mappedParentId != null) {
            clonedNode.parentId = mappedParentId;
            clonedNode.localX = snapshot.localX || 0;
            clonedNode.localY = snapshot.localY || 0;
        } else {
            clonedNode.parentId = null;
            clonedNode.x = pasteBase.x + offset + ((snapshot.canvasX ?? snapshot.x ?? 0) - minRootX);
            clonedNode.y = pasteBase.y + offset + ((snapshot.canvasY ?? snapshot.y ?? 0) - minRootY);
            delete clonedNode.properties.branchSide;
        }
    });

    clipboardPayload.forEach(snapshot => {
        const clonedNode = state.nodes.get(idMap.get(snapshot.sourceId));
        if (!clonedNode) return;

        if (snapshot.type === 'loop') {
            clonedNode.properties.bodyNodeIds = (snapshot.properties?.bodyNodeIds || [])
                .map(id => idMap.get(id))
                .filter(Boolean);
        }
        if (snapshot.type === 'branch') {
            clonedNode.properties.trueBodyNodeIds = (snapshot.properties?.trueBodyNodeIds || [])
                .map(id => idMap.get(id))
                .filter(Boolean);
            clonedNode.properties.falseBodyNodeIds = (snapshot.properties?.falseBodyNodeIds || [])
                .map(id => idMap.get(id))
                .filter(Boolean);
        }
    });

    for (let clonedId of idMap.values()) {
        const clonedNode = state.nodes.get(clonedId);
        if (!clonedNode || clonedNode.parentId != null) continue;
        placeNodeWithoutOverlapById(clonedId, { x: clonedNode.x, y: clonedNode.y });
    }

    const pastedIds = Array.from(idMap.values());
    updateSelection(pastedIds, pastedIds[pastedIds.length - 1] ?? null, pastedIds);
    pushUndoSnapshot(beforeSnapshot);
    renderCanvas();
    renderPropertiesPanel();
    addConsoleLog(`已粘贴 ${pastedIds.length} 个节点（未保留连接关系）。`, 'info');
    return true;
}

function updateDeleteSweepMarker(clientX, clientY) {
    const canvasDiv = document.getElementById("canvas");
    if (!canvasDiv) return;

    if (!deleteSweepMarker) {
        deleteSweepMarker = document.createElement('div');
        deleteSweepMarker.className = 'delete-sweep';
        deleteSweepMarker.style.width = `${DELETE_SWEEP_RADIUS * 2}px`;
        deleteSweepMarker.style.height = `${DELETE_SWEEP_RADIUS * 2}px`;
        canvasDiv.appendChild(deleteSweepMarker);
    }

    const rect = canvasDiv.getBoundingClientRect();
    deleteSweepMarker.style.left = `${clientX - rect.left}px`;
    deleteSweepMarker.style.top = `${clientY - rect.top}px`;
}

function finishDeleteSweep() {
    isDeleteSweeping = false;
    lastDeletePoint = null;
    deleteSweepStartSnapshot = null;
    didDeleteSweepNodes = false;
    if (deleteSweepMarker) {
        deleteSweepMarker.remove();
        deleteSweepMarker = null;
    }
}

function sweepDeleteAtPoint(clientX, clientY) {
    if (state.activeCanvasTool !== 'delete') return;

    const point = { x: clientX, y: clientY };
    const samples = [];

    if (lastDeletePoint) {
        const dx = point.x - lastDeletePoint.x;
        const dy = point.y - lastDeletePoint.y;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const steps = Math.max(1, Math.ceil(distance / 10));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            samples.push({
                x: lastDeletePoint.x + dx * t,
                y: lastDeletePoint.y + dy * t
            });
        }
    } else {
        samples.push(point);
    }

    const idsToDelete = new Set();
    for (let sample of samples) {
        const hitElements = document.elementsFromPoint(sample.x, sample.y);
        for (let el of hitElements) {
            const nodeEl = el?.closest?.('.flow-node');
            if (!nodeEl) continue;
            const nodeId = Number(nodeEl.getAttribute('data-id'));
            if (Number.isFinite(nodeId)) idsToDelete.add(nodeId);
        }
    }

    lastDeletePoint = point;
    updateDeleteSweepMarker(clientX, clientY);

    if (!idsToDelete.size) return;
    didDeleteSweepNodes = true;
    deleteNodesByIds(Array.from(idsToDelete), { skipHistory: true });
}

function beginDeleteSweep(e) {
    if (state.activeCanvasTool !== 'delete' || e.button !== 0) return;
    isDeleteSweeping = true;
    lastDeletePoint = null;
    deleteSweepStartSnapshot = snapshotCanvasState();
    didDeleteSweepNodes = false;
    sweepDeleteAtPoint(e.clientX, e.clientY);
    e.preventDefault();
}

function onCanvasAreaMouseDown(e) {
    const canvasArea = document.getElementById("canvasArea");
    if (!canvasArea) return;
    hideCanvasContextMenu();

    if (e.button === 0 && e.altKey) {
        isPanningCanvas = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartScrollLeft = canvasArea.scrollLeft;
        panStartScrollTop = canvasArea.scrollTop;
        canvasArea.classList.add('panning');
        e.preventDefault();
        return;
    }

    if (e.button !== 0) return;

    if (state.activeCanvasTool === 'delete' && !e.target.closest('.flow-node')) {
        beginDeleteSweep(e);
        return;
    }

    if (!e.target.closest('.flow-node') && !e.target.closest('.connect-point') && !(e.ctrlKey || e.metaKey)) {
        setSelectedNode(null);
    }
}

function onCanvasAreaContextMenu(e) {
    if (isPanningCanvas) {
        e.preventDefault();
        return;
    }

    e.preventDefault();
    const nodeEl = e.target.closest('.flow-node');
    const nodeId = nodeEl ? Number(nodeEl.getAttribute('data-id')) : null;

    if (nodeId && !isNodeSelected(nodeId)) {
        updateSelection([nodeId], nodeId, [nodeId]);
        renderCanvas();
        renderPropertiesPanel();
    }

    showCanvasContextMenu(e.clientX, e.clientY, Number.isFinite(nodeId) ? nodeId : null);
}

function onDocumentPointerDown(e) {
    if (e.target.closest('#canvasContextMenu')) return;
    hideCanvasContextMenu();
}

function setupCanvasInteractions() {
    const canvasArea = document.getElementById("canvasArea");
    if (!canvasArea) return;

    canvasArea.removeEventListener("mousedown", onCanvasAreaMouseDown);
    canvasArea.addEventListener("mousedown", onCanvasAreaMouseDown);
    canvasArea.removeEventListener("contextmenu", onCanvasAreaContextMenu);
    canvasArea.addEventListener("contextmenu", onCanvasAreaContextMenu);
    canvasArea.removeEventListener("scroll", scheduleConnectionRefresh);
    canvasArea.addEventListener("scroll", scheduleConnectionRefresh);
    document.removeEventListener("mousedown", onDocumentPointerDown);
    document.addEventListener("mousedown", onDocumentPointerDown);
    window.removeEventListener("resize", scheduleConnectionRefresh);
    window.addEventListener("resize", scheduleConnectionRefresh);
    bindCanvasContextMenuActions();
}

function onConnectPointMouseDown(e) {
    if (e.button !== 0) return;
    if (e.altKey) return;
    e.stopPropagation();
    const nodeId = parseInt(e.target.getAttribute('data-id'));
    const field = e.target.getAttribute('data-field') || null;
    if (nodeId) {
        // 按住 Shift 可拖动端口到节点任意位置（持久化到 portPositions）
        if (e.shiftKey && field) {
            isDraggingPort = true;
            draggingPortNodeId = nodeId;
            draggingPortField = field;
            portDragStartSnapshot = snapshotCanvasState();
            didMovePort = false;
            return;
        }
        isDraggingConnection = true;
        draggingFromNodeId = nodeId;
        draggingFromField = field;
    }
}

function onGlobalMouseMove(e) {
    const canvasDiv = document.getElementById("canvas");
    const canvasArea = document.getElementById("canvasArea");
    if (isPanningCanvas && canvasArea) {
        canvasArea.scrollLeft = panStartScrollLeft - (e.clientX - panStartX);
        canvasArea.scrollTop = panStartScrollTop - (e.clientY - panStartY);
        return;
    }
    if (isDeleteSweeping) {
        sweepDeleteAtPoint(e.clientX, e.clientY);
        return;
    }
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
            node.localX = Math.max(12, newX);
            node.localY = Math.max(16, newY);
            syncContainerOrderFromPositions(parentNode);
        } else {
            const containerRect = canvasArea.getBoundingClientRect();
            const newX = e.clientX - dragOffsetX - containerRect.left + canvasArea.scrollLeft;
            const newY = e.clientY - dragOffsetY - containerRect.top + canvasArea.scrollTop;
            node.x = Math.max(CANVAS_PADDING / 2, newX);
            node.y = Math.max(CANVAS_PADDING / 2, newY);
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
        didMovePort = true;
        renderCanvas();
    } else if (isDraggingConnection && draggingFromNodeId !== null) {
        const containerRect = canvasDiv.getBoundingClientRect();
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
    const canvasArea = document.getElementById("canvasArea");
    if (isPanningCanvas) {
        isPanningCanvas = false;
        if (canvasArea) canvasArea.classList.remove('panning');
    }
    if (isDeleteSweeping) {
        if (didDeleteSweepNodes) pushUndoSnapshot(deleteSweepStartSnapshot);
        finishDeleteSweep();
        renderCanvas();
        return;
    }
    if (isDraggingPort) {
        isDraggingPort = false;
        draggingPortNodeId = null;
        draggingPortField = null;
        if (didMovePort) pushUndoSnapshot(portDragStartSnapshot);
        portDragStartSnapshot = null;
        didMovePort = false;
        return;
    }
    if (isDraggingNode) {
        isDraggingNode = false;
        const movedNode = state.nodes.get(currentNodeMoving);
        currentNodeMoving = null;
        // 只有发生过拖拽移动才重建画布，避免“点击但未移动”导致 click 选中事件丢失
        if (didMoveNode) {
            // 拖拽结束后，可能会触发一次 click；忽略下一次 click 防止误选中
            ignoreNextClick = true;
            const overlappingSibling = findBestOverlappingSibling(movedNode);
            if (overlappingSibling) {
                swapNodePositions(movedNode, overlappingSibling, dragStartNodePosition);
            } else if (movedNode) {
                const beforeAdjust = getNodePosition(movedNode);
                placeNodeWithoutOverlapById(movedNode.id, beforeAdjust);
                const afterAdjust = getNodePosition(movedNode);
                queueNodePositionAnimation(movedNode.id, beforeAdjust, afterAdjust);
            }
            if (movedNode?.parentId != null) {
                const parentNode = state.nodes.get(movedNode.parentId);
                syncContainerOrderFromPositions(parentNode);
                layoutContainerChildren(parentNode);
            }
            pushUndoSnapshot(dragStartCanvasSnapshot);
            renderCanvas();
            renderPropertiesPanel();
        }
        didMoveNode = false;
        dragStartNodePosition = null;
        dragStartCanvasSnapshot = null;
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
    const beforeSnapshot = snapshotCanvasState();
    if (sourceNode.parentId != null && sourceNode.parentId !== targetNode.parentId) {
        attachNodeIntoSourceContainer(targetNode, sourceNode);
    }

    // 如果从“指定端口”发起连线，则直接写入对应字段，不再弹窗选择。
    if (fieldOverride) {
        if (fieldOverride === 'loopBody') {
            if (sourceNode.type !== 'loop') return;
            if (!attachNodeToContainer(targetNode, sourceNode, 'loopBody')) {
                addConsoleLog(`Cannot place node ${targetId} into container ${sourceId}: nesting would create a cycle`, "error");
                return;
            }
            addConsoleLog(`Added to loop body: ${sourceId} += ${targetId}`, "info");
            pushUndoSnapshot(beforeSnapshot);
            renderCanvas();
            if (isNodeSelected(sourceId)) renderPropertiesPanel();
            return;
        }
        if (fieldOverride === 'trueBody' || fieldOverride === 'falseBody') {
            if (sourceNode.type !== 'branch') return;
            if (!attachNodeToContainer(targetNode, sourceNode, fieldOverride)) {
                addConsoleLog(`Cannot place node ${targetId} into container ${sourceId}: nesting would create a cycle`, "error");
                return;
            }
            addConsoleLog(`Added to branch body: ${sourceId} += ${targetId} (${fieldOverride})`, "info");
            pushUndoSnapshot(beforeSnapshot);
            renderCanvas();
            if (isNodeSelected(sourceId)) renderPropertiesPanel();
            return;
        }
        sourceNode.properties[fieldOverride] = targetId;
        addConsoleLog(`连接: ${sourceId} → ${targetId} (${fieldOverride})`, "info");
        pushUndoSnapshot(beforeSnapshot);
        renderCanvas();
        if (isNodeSelected(sourceId)) renderPropertiesPanel();
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
    pushUndoSnapshot(beforeSnapshot);
    renderCanvas();
    if (isNodeSelected(sourceId)) renderPropertiesPanel();
}

function setupGlobalDragEvents() {
    document.removeEventListener("mousemove", onGlobalMouseMove);
    document.removeEventListener("mouseup", onGlobalMouseUp);
    document.addEventListener("mousemove", onGlobalMouseMove);
    document.addEventListener("mouseup", onGlobalMouseUp);
}

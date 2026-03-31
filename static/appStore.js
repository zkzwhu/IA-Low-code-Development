export const state = {
    nodes: new Map(),
    nextId: 100,
    selectedNodeId: null,
    selectedNodeIds: [],
    expandedPropertyNodeIds: [],
    consoleMode: 'detail',
    activeConsoleTab: 'run',
    debugCurrentNodeId: null,
    activeCanvasTool: 'select'
};

if (typeof window !== 'undefined') {
    window.state = state;
}

export function setNodes(newNodes) {
    state.nodes = newNodes;
}

export function setNextId(id) {
    state.nextId = id;
}

export function setSelectedNodeId(id) {
    state.selectedNodeId = id;
    state.selectedNodeIds = typeof id === 'number' ? [id] : [];
}

export function setSelectedNodeIds(ids, primaryId = null) {
    const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
        .filter(id => typeof id === 'number')));
    state.selectedNodeIds = uniqueIds;
    if (primaryId != null && uniqueIds.includes(primaryId)) {
        state.selectedNodeId = primaryId;
    } else {
        state.selectedNodeId = uniqueIds[0] ?? null;
    }
}

export function setExpandedPropertyNodeIds(ids) {
    state.expandedPropertyNodeIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
        .filter(id => typeof id === 'number')));
}

export function setConsoleMode(mode) {
    if (mode === 'detail' || mode === 'result') {
        state.consoleMode = mode;
    }
}

export function setActiveConsoleTab(tab) {
    if (tab === 'run' || tab === 'debug') {
        state.activeConsoleTab = tab;
    }
}

export function setDebugCurrentNodeId(id) {
    state.debugCurrentNodeId = typeof id === 'number' ? id : null;
}

export function setActiveCanvasTool(tool) {
    if (tool === 'select' || tool === 'connect' || tool === 'delete') {
        state.activeCanvasTool = tool;
    }
}

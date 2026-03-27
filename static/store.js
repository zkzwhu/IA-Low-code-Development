// 全局状态存储
export const state = {
    nodes: new Map(),          // id -> node对象
    nextId: 100,
    selectedNodeId: null,
    consoleMode: 'detail'      // 'detail' 或 'result'
};

// 兼容：如果某些脚本未按模块方式导入导致找不到 state，
// 这里把 state 挂到 window，避免出现 “state is not defined”。
if (typeof window !== 'undefined') {
    window.state = state;
}

// 更新状态的方法
export function setNodes(newNodes) {
    state.nodes = newNodes;
}

export function setNextId(id) {
    state.nextId = id;
}

export function setSelectedNodeId(id) {
    state.selectedNodeId = id;
}

export function setConsoleMode(mode) {
    if (mode === 'detail' || mode === 'result') {
        state.consoleMode = mode;
    }
}
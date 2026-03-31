import { state } from './appStore.js';
import { addConsoleLog, showModal } from './appUtils.js';
import { renderCanvas, resetCanvasHistory, setSelectedNode } from './nodeManager.js';

// API调用
async function saveProjectToServer() {
    const data = {
        nodes: Array.from(state.nodes.values()),
        next_id: state.nextId
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
            state.nodes.clear();
            for(let node of data.nodes) {
                state.nodes.set(node.id, node);
            }
            state.nextId = data.next_id;
            resetCanvasHistory();
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

function newProject() {
    showModal({
        title: "新建项目",
        bodyHtml: `<div>新建项目将清空当前工作流，确定吗？</div>`,
        okText: "确定清空",
        cancelText: "取消",
        onOk: () => {
            state.nodes.clear();
            state.nextId = 100;
            resetCanvasHistory();
            renderCanvas();
            setSelectedNode(null);
            addConsoleLog("已新建空白项目", "info");
        }
    });
}

export function initFileMenu() {
    document.getElementById("newProjectBtn").onclick = newProject;
    document.getElementById("saveProjectBtn").onclick = saveProjectToServer;
    document.getElementById("loadProjectBtn").onclick = loadProjectFromServer;
}

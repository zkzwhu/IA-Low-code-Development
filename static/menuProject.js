import { state } from './appStore.js';
import { addConsoleLog } from './appUtils.js';
import { renderCanvas, resetCanvasHistory, setSelectedNode } from './nodeManager.js';

function exportProjectJSON() {
    const data = { nodes: Array.from(state.nodes.values()), next_id: state.nextId };
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
            state.nodes.clear();
            for(let node of data.nodes) {
                state.nodes.set(node.id, node);
            }
            state.nextId = data.next_id;
            resetCanvasHistory();
            renderCanvas();
            setSelectedNode(null);
            addConsoleLog("导入项目成功", "info");
        } catch(err) {
            addConsoleLog("导入失败, 文件格式错误", "error");
        }
    };
    reader.readAsText(file);
}

export function initProjectMenu() {
    document.getElementById("exportProjectBtn").onclick = exportProjectJSON;
    document.getElementById("importProjectBtn").onclick = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json";
        input.onchange = (e) => { if(e.target.files[0]) importProjectJSON(e.target.files[0]); };
        input.click();
    };
}

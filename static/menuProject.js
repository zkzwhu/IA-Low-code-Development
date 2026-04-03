import { state, setWorkflowPorts } from './appStore.js';
import { addConsoleLog, escapeHtml, showModal } from './appUtils.js';
import { getNodePortFieldOptions, importWorkflowProjectData, serializeWorkflowProjectData } from './workflowProjectService.js';

function createWorkflowPortId() {
    return `workflow-port-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function exportProjectJSON() {
    const data = serializeWorkflowProjectData();
    const str = JSON.stringify(data, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'workflow_project.json';
    a.click();
    addConsoleLog('已导出工作流 JSON 文件', 'info');
}

function importProjectJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            importWorkflowProjectData(data, {
                name: file.name.replace(/\.json$/i, ''),
                announce: true
            });
        } catch (error) {
            addConsoleLog('导入失败，文件格式错误', 'error');
        }
    };
    reader.readAsText(file);
}

function getNodeOptions(selectedNodeId) {
    const options = Array.from(state.nodes.values())
        .sort((a, b) => a.id - b.id)
        .map(node => {
            const nodeName = node.properties?.name || `${node.type}#${node.id}`;
            return `<option value="${node.id}" ${Number(selectedNodeId) === node.id ? 'selected' : ''}>${escapeHtml(nodeName)}</option>`;
        })
        .join('');

    return `<option value="">请选择节点</option>${options}`;
}

function getFieldOptions(nodeId, selectedField) {
    const node = state.nodes.get(Number(nodeId));
    if (!node) return '<option value="">请选择端口</option>';

    return getNodePortFieldOptions(node.type)
        .map(option => `<option value="${option.field}" ${selectedField === option.field ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
        .join('');
}

function renderWorkflowPortsEditor(modalBody, draftPorts) {
    modalBody.innerHTML = `
        <div class="port-editor-toolbar">
            <div class="help-text">为工作流维护可对外暴露的项目端口，后续大屏应用可以基于这些端口进行绑定。</div>
            <button class="prop-btn" type="button" id="addWorkflowPortRowBtn">添加端口</button>
        </div>
        <div class="port-editor-list">
            ${draftPorts.map((port, index) => `
                <div class="port-editor-item" data-port-row="${port.id}">
                    <div class="port-editor-head">
                        <div class="port-editor-title">端口 ${index + 1}</div>
                        <button class="prop-btn" type="button" data-remove-port="${port.id}">删除</button>
                    </div>
                    <div class="port-editor-grid">
                        <div class="prop-group">
                            <label class="prop-label">端口名称</label>
                            <input class="prop-input" data-port-field="name" data-port-id="${port.id}" value="${escapeHtml(port.name || '')}" placeholder="例如 soilHumidity">
                        </div>
                        <div class="prop-group">
                            <label class="prop-label">数据类型</label>
                            <select class="prop-select" data-port-field="dataType" data-port-id="${port.id}">
                                <option value="string" ${port.dataType === 'string' ? 'selected' : ''}>字符串</option>
                                <option value="int" ${port.dataType === 'int' ? 'selected' : ''}>整形</option>
                            </select>
                        </div>
                        <div class="prop-group">
                            <label class="prop-label">连接节点</label>
                            <select class="prop-select" data-port-field="nodeId" data-port-id="${port.id}">
                                ${getNodeOptions(port.nodeId)}
                            </select>
                        </div>
                        <div class="prop-group">
                            <label class="prop-label">节点端口</label>
                            <select class="prop-select" data-port-field="field" data-port-id="${port.id}">
                                ${getFieldOptions(port.nodeId, port.field)}
                            </select>
                        </div>
                    </div>
                </div>
            `).join('') || '<div class="help-text">当前还没有项目端口，点击右上角“添加端口”即可创建。</div>'}
        </div>
    `;

    const syncDraftField = (portId, field, value) => {
        const target = draftPorts.find(port => port.id === portId);
        if (!target) return;
        if (field === 'nodeId') {
            target.nodeId = value === '' ? null : Number(value);
            const availableFields = getNodePortFieldOptions(state.nodes.get(target.nodeId)?.type || '');
            if (!availableFields.some(option => option.field === target.field)) {
                target.field = availableFields[0]?.field || '';
            }
        } else {
            target[field] = value;
        }
    };

    modalBody.querySelectorAll('[data-port-field]').forEach(element => {
        element.addEventListener('change', () => {
            const portId = element.getAttribute('data-port-id');
            const field = element.getAttribute('data-port-field');
            syncDraftField(portId, field, element.value);
            if (field === 'nodeId') renderWorkflowPortsEditor(modalBody, draftPorts);
        });
    });

    modalBody.querySelectorAll('[data-remove-port]').forEach(button => {
        button.addEventListener('click', () => {
            const portId = button.getAttribute('data-remove-port');
            const nextPorts = draftPorts.filter(port => port.id !== portId);
            draftPorts.splice(0, draftPorts.length, ...nextPorts);
            renderWorkflowPortsEditor(modalBody, draftPorts);
        });
    });

    const addBtn = modalBody.querySelector('#addWorkflowPortRowBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            draftPorts.push({
                id: createWorkflowPortId(),
                name: `端口${draftPorts.length + 1}`,
                dataType: 'string',
                nodeId: null,
                field: ''
            });
            renderWorkflowPortsEditor(modalBody, draftPorts);
        });
    }
}

function validateWorkflowPorts(draftPorts) {
    const nameSet = new Set();

    for (const port of draftPorts) {
        const trimmedName = String(port.name || '').trim();
        if (!trimmedName) {
            return { ok: false, message: '项目端口名称不能为空。' };
        }
        if (nameSet.has(trimmedName)) {
            return { ok: false, message: `项目端口名称不能重复：${trimmedName}` };
        }
        if (!Number.isFinite(Number(port.nodeId)) || !state.nodes.has(Number(port.nodeId))) {
            return { ok: false, message: `端口「${trimmedName}」尚未连接到有效节点。` };
        }

        const node = state.nodes.get(Number(port.nodeId));
        const fieldOptions = getNodePortFieldOptions(node.type);
        if (!fieldOptions.some(option => option.field === port.field)) {
            return { ok: false, message: `端口「${trimmedName}」连接的节点端口无效。` };
        }
        nameSet.add(trimmedName);
    }

    return { ok: true };
}

function openWorkflowPortsManager() {
    const draftPorts = (state.workflowPorts || []).map(port => ({
        id: String(port.id || createWorkflowPortId()),
        name: String(port.name || ''),
        dataType: port.dataType === 'int' ? 'int' : 'string',
        nodeId: Number.isFinite(Number(port.nodeId)) ? Number(port.nodeId) : null,
        field: typeof port.field === 'string' ? port.field : ''
    }));

    showModal({
        title: '项目端口',
        bodyHtml: '<div id="workflowPortsEditorRoot"></div>',
        okText: '保存端口',
        cancelText: '取消',
        onOk: () => {
            const validated = validateWorkflowPorts(draftPorts);
            if (!validated.ok) {
                addConsoleLog(validated.message, 'error');
                return false;
            }

            setWorkflowPorts(draftPorts.map(port => ({
                ...port,
                name: String(port.name).trim(),
                nodeId: Number(port.nodeId)
            })));
            addConsoleLog(`已更新 ${draftPorts.length} 个工作流项目端口`, 'info');
            return true;
        }
    });

    const modalBody = document.getElementById('modalBody');
    const editorRoot = modalBody?.querySelector('#workflowPortsEditorRoot');
    if (!editorRoot) return;
    renderWorkflowPortsEditor(editorRoot, draftPorts);
}

export function initProjectMenu() {
    const exportBtn = document.getElementById('exportProjectBtn');
    const importBtn = document.getElementById('importProjectBtn');
    const managePortsBtn = document.getElementById('managePortsBtn');

    if (exportBtn) exportBtn.onclick = exportProjectJSON;
    if (managePortsBtn) managePortsBtn.onclick = openWorkflowPortsManager;
    if (importBtn) {
        importBtn.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json';
            input.onchange = (e) => {
                if (e.target.files[0]) importProjectJSON(e.target.files[0]);
            };
            input.click();
        };
    }
}

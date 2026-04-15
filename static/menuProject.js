import { state, setWorkflowPorts, setWorkflowVariables } from './appStore.js';
import { addConsoleLog, escapeHtml, showModal } from './appUtils.js';
import {
    getNodePortFieldOptions,
    getWorkflowVariableById,
    importWorkflowProjectData,
    normalizeWorkflowPort,
    normalizeWorkflowVariable,
    serializeWorkflowProjectData
} from './workflowProjectService.js';
import { renderCanvas } from './nodeManager.js';

function createWorkflowPortId() {
    return `workflow-port-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createWorkflowVariableId() {
    return `workflow-variable-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function exportProjectJSON() {
    const data = serializeWorkflowProjectData();
    const str = JSON.stringify(data, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'workflow_project.json';
    a.click();
    addConsoleLog('已导出工作流 JSON 文件。', 'info');
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
            addConsoleLog('导入失败，文件格式错误。', 'error');
        }
    };
    reader.readAsText(file);
}

function getBindableOutputNodes() {
    return Array.from(state.nodes.values())
        .filter(node => getNodePortFieldOptions(node.type).length > 0)
        .sort((a, b) => a.id - b.id);
}

function getNodeOptions(selectedNodeId) {
    const options = getBindableOutputNodes()
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

function getDerivedPortType(nodeId, field, fallbackType = 'string') {
    const node = state.nodes.get(Number(nodeId));
    if (node?.type === 'output' && field === 'outputValue') {
        const variable = getWorkflowVariableById(node.properties?.variableId);
        if (variable) return variable.dataType;
    }
    return fallbackType === 'int' ? 'int' : (fallbackType === 'csv' ? 'csv' : 'string');
}

function syncNodeVariableReferences(validVariableIds) {
    for (const node of state.nodes.values()) {
        if (node.type === 'print') {
            const variableId = node.properties?.variableId;
            if (node.properties?.messageSource === 'variable' && variableId && !validVariableIds.has(variableId)) {
                node.properties.messageSource = 'manual';
                node.properties.variableId = null;
            }
        }

        if (node.type === 'output') {
            const variableId = node.properties?.variableId;
            if (variableId && !validVariableIds.has(variableId)) {
                node.properties.variableId = null;
            }
        }

        if (node.type === 'get_sensor_info' || node.type === 'db_query') {
            const variableId = node.properties?.targetVariableId;
            if (variableId && !validVariableIds.has(variableId)) {
                node.properties.targetVariableId = null;
            }
        }
    }
}

function syncWorkflowPortTypesFromNodes() {
    const nextPorts = (state.workflowPorts || []).map(port => {
        const normalized = normalizeWorkflowPort({ ...port });
        normalized.dataType = getDerivedPortType(normalized.nodeId, normalized.field, normalized.dataType);
        return normalized;
    });
    setWorkflowPorts(nextPorts);
}

function renderWorkflowPortsEditor(modalBody, draftPorts) {
    modalBody.innerHTML = `
        <div class="port-editor-toolbar">
            <div class="help-text">项目端口用于把工作流中的输出节点暴露给大屏应用绑定使用。</div>
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
                            <input class="prop-input" data-port-field="name" data-port-id="${port.id}" value="${escapeHtml(port.name || '')}" placeholder="例如 weatherText">
                        </div>
                        <div class="prop-group">
                            <label class="prop-label">数据类型</label>
                            <select class="prop-select" data-port-field="dataType" data-port-id="${port.id}">
                                <option value="string" ${port.dataType === 'string' ? 'selected' : ''}>字符串</option>
                                <option value="csv" ${port.dataType === 'csv' ? 'selected' : ''}>CSV</option>
                                <option value="int" ${port.dataType === 'int' ? 'selected' : ''}>整型</option>
                            </select>
                        </div>
                        <div class="prop-group">
                            <label class="prop-label">输出节点</label>
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
                    <div class="help-text">若绑定的是输出端口节点，数据类型会自动跟随该节点引用的变量类型。</div>
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
            target.dataType = getDerivedPortType(target.nodeId, target.field, target.dataType);
        } else if (field === 'field') {
            target.field = value;
            target.dataType = getDerivedPortType(target.nodeId, target.field, target.dataType);
        } else {
            target[field] = value;
        }
    };

    modalBody.querySelectorAll('[data-port-field]').forEach(element => {
        element.addEventListener('change', () => {
            const portId = element.getAttribute('data-port-id');
            const field = element.getAttribute('data-port-field');
            syncDraftField(portId, field, element.value);
            if (field === 'nodeId' || field === 'field') renderWorkflowPortsEditor(modalBody, draftPorts);
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
            return { ok: false, message: `端口“${trimmedName}”尚未绑定到有效的输出节点。` };
        }

        const node = state.nodes.get(Number(port.nodeId));
        const fieldOptions = getNodePortFieldOptions(node.type);
        if (!fieldOptions.some(option => option.field === port.field)) {
            return { ok: false, message: `端口“${trimmedName}”绑定的节点端口无效。` };
        }
        nameSet.add(trimmedName);
    }

    return { ok: true };
}

function openWorkflowPortsManager() {
    const draftPorts = (state.workflowPorts || []).map(port => ({
        id: String(port.id || createWorkflowPortId()),
        name: String(port.name || ''),
        dataType: port.dataType === 'int' ? 'int' : (port.dataType === 'csv' ? 'csv' : 'string'),
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

            setWorkflowPorts(draftPorts.map(port => normalizeWorkflowPort({
                ...port,
                name: String(port.name).trim(),
                nodeId: Number(port.nodeId),
                dataType: getDerivedPortType(port.nodeId, port.field, port.dataType)
            })));
            addConsoleLog(`已更新 ${draftPorts.length} 个项目端口。`, 'info');
            return true;
        }
    });

    const modalBody = document.getElementById('modalBody');
    const editorRoot = modalBody?.querySelector('#workflowPortsEditorRoot');
    if (!editorRoot) return;
    renderWorkflowPortsEditor(editorRoot, draftPorts);
}

function renderWorkflowVariablesEditor(modalBody, draftVariables) {
    modalBody.innerHTML = `
        <div class="port-editor-toolbar">
            <div class="help-text">变量可被打印节点和输出端口节点引用，支持字符串、CSV 与整型。</div>
            <button class="prop-btn" type="button" id="addWorkflowVariableRowBtn">添加变量</button>
        </div>
        <div class="port-editor-list">
            ${draftVariables.map((variable, index) => `
                <div class="port-editor-item" data-variable-row="${variable.id}">
                    <div class="port-editor-head">
                        <div class="port-editor-title">变量 ${index + 1}</div>
                        <button class="prop-btn" type="button" data-remove-variable="${variable.id}">删除</button>
                    </div>
                    <div class="port-editor-grid">
                        <div class="prop-group">
                            <label class="prop-label">变量名称</label>
                            <input class="prop-input" data-variable-field="name" data-variable-id="${variable.id}" value="${escapeHtml(variable.name || '')}" placeholder="例如 sensorTitle">
                        </div>
                        <div class="prop-group">
                            <label class="prop-label">数据类型</label>
                            <select class="prop-select" data-variable-field="dataType" data-variable-id="${variable.id}">
                                <option value="string" ${variable.dataType === 'string' ? 'selected' : ''}>字符串</option>
                                <option value="csv" ${variable.dataType === 'csv' ? 'selected' : ''}>CSV</option>
                                <option value="int" ${variable.dataType === 'int' ? 'selected' : ''}>整型</option>
                            </select>
                        </div>
                        <div class="prop-group" style="grid-column: 1 / -1;">
                            <label class="prop-label">默认值</label>
                            <input class="prop-input" ${variable.dataType === 'int' ? 'type="number"' : ''} data-variable-field="defaultValue" data-variable-id="${variable.id}" value="${escapeHtml(variable.defaultValue ?? '')}" placeholder="未运行时的初始值">
                        </div>
                    </div>
                </div>
            `).join('') || '<div class="help-text">当前还没有变量，点击右上角“添加变量”即可创建。</div>'}
        </div>
    `;

    const syncDraftField = (variableId, field, value) => {
        const target = draftVariables.find(variable => variable.id === variableId);
        if (!target) return;
        if (field === 'dataType') {
            target.dataType = value === 'int' ? 'int' : (value === 'csv' ? 'csv' : 'string');
            target.defaultValue = target.dataType === 'int'
                ? (Number.isFinite(Number(target.defaultValue)) ? Number(target.defaultValue) : 0)
                : String(target.defaultValue ?? '');
        } else if (field === 'defaultValue') {
            target.defaultValue = target.dataType === 'int'
                ? (value === '' ? 0 : Number(value))
                : value;
        } else {
            target[field] = value;
        }
    };

    modalBody.querySelectorAll('[data-variable-field]').forEach(element => {
        element.addEventListener('change', () => {
            const variableId = element.getAttribute('data-variable-id');
            const field = element.getAttribute('data-variable-field');
            syncDraftField(variableId, field, element.value);
            if (field === 'dataType') renderWorkflowVariablesEditor(modalBody, draftVariables);
        });
    });

    modalBody.querySelectorAll('[data-remove-variable]').forEach(button => {
        button.addEventListener('click', () => {
            const variableId = button.getAttribute('data-remove-variable');
            const nextVariables = draftVariables.filter(variable => variable.id !== variableId);
            draftVariables.splice(0, draftVariables.length, ...nextVariables);
            renderWorkflowVariablesEditor(modalBody, draftVariables);
        });
    });

    const addBtn = modalBody.querySelector('#addWorkflowVariableRowBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            draftVariables.push({
                id: createWorkflowVariableId(),
                name: `变量${draftVariables.length + 1}`,
                dataType: 'string',
                defaultValue: ''
            });
            renderWorkflowVariablesEditor(modalBody, draftVariables);
        });
    }
}

function validateWorkflowVariables(draftVariables) {
    const nameSet = new Set();

    for (const variable of draftVariables) {
        const trimmedName = String(variable.name || '').trim();
        if (!trimmedName) {
            return { ok: false, message: '变量名称不能为空。' };
        }
        if (nameSet.has(trimmedName)) {
            return { ok: false, message: `变量名称不能重复：${trimmedName}` };
        }
        if (variable.dataType === 'int' && !Number.isFinite(Number(variable.defaultValue))) {
            return { ok: false, message: `变量“${trimmedName}”的默认值不是合法整型。` };
        }
        nameSet.add(trimmedName);
    }

    return { ok: true };
}

function openWorkflowVariablesManager() {
    const draftVariables = (state.workflowVariables || []).map(variable => ({
        id: String(variable.id || createWorkflowVariableId()),
        name: String(variable.name || ''),
        dataType: variable.dataType === 'int' ? 'int' : (variable.dataType === 'csv' ? 'csv' : 'string'),
        defaultValue: variable.dataType === 'int'
            ? (Number.isFinite(Number(variable.defaultValue)) ? Number(variable.defaultValue) : 0)
            : String(variable.defaultValue ?? '')
    }));

    showModal({
        title: '工作流变量',
        bodyHtml: '<div id="workflowVariablesEditorRoot"></div>',
        okText: '保存变量',
        cancelText: '取消',
        onOk: () => {
            const validated = validateWorkflowVariables(draftVariables);
            if (!validated.ok) {
                addConsoleLog(validated.message, 'error');
                return false;
            }

            const nextVariables = draftVariables.map(variable => normalizeWorkflowVariable({
                ...variable,
                name: String(variable.name).trim(),
                defaultValue: variable.dataType === 'int'
                    ? Number(variable.defaultValue || 0)
                    : String(variable.defaultValue ?? '')
            }));
            const validVariableIds = new Set(nextVariables.map(variable => variable.id));

            setWorkflowVariables(nextVariables);
            syncNodeVariableReferences(validVariableIds);
            syncWorkflowPortTypesFromNodes();
            renderCanvas();
            addConsoleLog(`已更新 ${nextVariables.length} 个工作流变量。`, 'info');
            return true;
        }
    });

    const modalBody = document.getElementById('modalBody');
    const editorRoot = modalBody?.querySelector('#workflowVariablesEditorRoot');
    if (!editorRoot) return;
    renderWorkflowVariablesEditor(editorRoot, draftVariables);
}

export function initProjectMenu() {
    const exportBtn = document.getElementById('exportProjectBtn');
    const importBtn = document.getElementById('importProjectBtn');
    const managePortsBtn = document.getElementById('managePortsBtn');
    const manageVariablesBtn = document.getElementById('manageVariablesBtn');

    if (exportBtn) exportBtn.onclick = exportProjectJSON;
    if (managePortsBtn) managePortsBtn.onclick = openWorkflowPortsManager;
    if (manageVariablesBtn) manageVariablesBtn.onclick = openWorkflowVariablesManager;
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

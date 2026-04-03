import { state } from './appStore.js';
import { addConsoleLog, escapeHtml, showModal } from './appUtils.js';
import { createNewWorkflowProject, listWorkflowProjects, openWorkflowProjectById, saveCurrentWorkflowProject } from './workflowProjectService.js';

function formatProjectTime(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '时间未知';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function newProject() {
    showModal({
        title: '新建工作流项目',
        bodyHtml: '<div>将创建一个新的本地工作流项目，并切换到空白画布。</div>',
        okText: '创建项目',
        cancelText: '取消',
        onOk: () => {
            createNewWorkflowProject({ announce: true });
        }
    });
}

function saveProjectLocally() {
    const currentName = state.currentProject?.name || '';
    showModal({
        title: '保存本地项目',
        bodyHtml: `
            <div class="prop-group">
                <label class="prop-label">项目名称</label>
                <input class="prop-input" id="workflowProjectNameInput" value="${escapeHtml(currentName)}" placeholder="请输入项目名称">
            </div>
        `,
        okText: '保存',
        cancelText: '取消',
        onOk: ({ bodyEl }) => {
            const input = bodyEl.querySelector('#workflowProjectNameInput');
            const nextName = input?.value?.trim();
            if (!nextName) {
                addConsoleLog('请输入项目名称后再保存。', 'error');
                return false;
            }
            saveCurrentWorkflowProject({ name: nextName, silent: false, touchOpen: true });
            return true;
        }
    });
}

function openProjectPicker() {
    const projects = listWorkflowProjects();
    showModal({
        title: '打开本地工作流',
        bodyHtml: projects.length
            ? `<div class="project-picker-list">${projects.map(project => `
                <div class="project-picker-item">
                    <button class="project-picker-btn" type="button" data-open-local-project="${project.id}">
                        <strong>${escapeHtml(project.name)}</strong>
                        <span>最近活动：${formatProjectTime(project.lastOpenedAt || project.updatedAt)}</span>
                    </button>
                </div>
            `).join('')}</div>`
            : '<div class="help-text">当前还没有保存过本地工作流项目。</div>',
        okText: '关闭',
        showCancel: false
    });

    const modalBody = document.getElementById('modalBody');
    if (!modalBody) return;

    modalBody.querySelectorAll('[data-open-local-project]').forEach(button => {
        button.addEventListener('click', () => {
            const projectId = button.getAttribute('data-open-local-project');
            const opened = openWorkflowProjectById(projectId, { announce: true });
            if (!opened) {
                addConsoleLog('打开本地项目失败。', 'error');
                return;
            }
            const modalCancelBtn = document.getElementById('modalCancelBtn');
            if (modalCancelBtn) modalCancelBtn.click();
        });
    });
}

export function initFileMenu() {
    document.getElementById('newProjectBtn').onclick = newProject;
    document.getElementById('saveProjectBtn').onclick = saveProjectLocally;
    document.getElementById('loadProjectBtn').onclick = openProjectPicker;
}

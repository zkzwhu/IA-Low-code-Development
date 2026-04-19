import { state } from './appStore.js';
import { addConsoleLog, escapeHtml, showModal } from './appUtils.js';
import { requireAuthenticated } from './authService.js';
import { getUserProject, listUserProjects, saveUserProject } from './cloudProjectService.js';
import { downloadCloudProjectToLocalFile } from './projectDownloadService.js';
import {
    createNewWorkflowProject,
    listWorkflowProjects,
    openWorkflowProjectById,
    saveCurrentWorkflowProject,
    serializeWorkflowProjectData,
    syncWorkflowProjectFromCloud
} from './workflowProjectService.js';

function formatProjectTime(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '时间未知';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function closeWorkflowModal() {
    const modalCancelBtn = document.getElementById('modalCancelBtn');
    if (modalCancelBtn) modalCancelBtn.click();
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
            closeWorkflowModal();
        });
    });
}

function openCloudProjectPicker(projects) {
    showModal({
        title: '下载数据库项目文件',
        bodyHtml: projects.length
            ? `<div class="project-picker-list">${projects.map(project => `
                <div class="project-picker-item">
                    <button class="project-picker-btn" type="button" data-download-cloud-project="${project.id}" data-download-cloud-project-name="${escapeHtml(project.name)}">
                        <strong>${escapeHtml(project.name)}</strong>
                        <span>项目类型：工作流 · 更新时间：${formatProjectTime(project.updatedAt)}</span>
                    </button>
                </div>
            `).join('')}</div>`
            : '<div class="help-text">当前数据库中还没有可下载的工作流项目。</div>',
        okText: '关闭',
        showCancel: false
    });

    const modalBody = document.getElementById('modalBody');
    if (!modalBody) return;

    modalBody.querySelectorAll('[data-download-cloud-project]').forEach(button => {
        button.addEventListener('click', async () => {
            const projectId = button.getAttribute('data-download-cloud-project');
            const projectName = button.getAttribute('data-download-cloud-project-name') || 'workflow-project';
            closeWorkflowModal();

            try {
                const result = await downloadCloudProjectToLocalFile({
                    projectId,
                    projectType: 'workflow',
                    projectName,
                    loadProject: getUserProject
                });

                if (result?.ok) {
                    addConsoleLog(`已将工作流项目下载到本地目录：${result.targetLabel}`, 'info');
                }
            } catch (error) {
                addConsoleLog(error?.message || '下载工作流项目文件失败。', 'error');
            }
        });
    });
}

async function downloadProjectFromCloud() {
    const auth = await requireAuthenticated('下载数据库中的工作流项目文件前需要先登录。');
    if (!auth) return;

    try {
        const projects = await listUserProjects('workflow');
        openCloudProjectPicker(projects);
    } catch (error) {
        addConsoleLog(error?.message || '获取数据库工作流项目列表失败。', 'error');
    }
}

async function saveProjectToCloud() {
    const auth = await requireAuthenticated('保存项目到数据库需要先登录。');
    if (!auth) return;

    const currentName = state.currentProject?.name || '';
    showModal({
        title: '保存到数据库',
        bodyHtml: `
            <div class="prop-group">
                <label class="prop-label">项目名称</label>
                <input class="prop-input" id="workflowCloudProjectNameInput" value="${escapeHtml(currentName)}" placeholder="请输入数据库项目名称">
            </div>
            <div class="help-text">未登录时仍可继续编辑，只有保存到数据库或下载项目文件时才要求登录。</div>
        `,
        okText: '保存到数据库',
        cancelText: '取消',
        onOk: async ({ bodyEl }) => {
            const input = bodyEl.querySelector('#workflowCloudProjectNameInput');
            const nextName = input?.value?.trim();
            if (!nextName) {
                addConsoleLog('请输入项目名称后再保存到数据库。', 'error');
                return false;
            }

            const payload = serializeWorkflowProjectData();
            let projectId = state.currentProject?.cloudProjectId || null;
            let cloudProject = null;

            try {
                cloudProject = await saveUserProject({
                    projectId,
                    projectType: 'workflow',
                    name: nextName,
                    data: payload
                });
            } catch (error) {
                if (projectId && error?.code === 'PROJECT_NOT_FOUND') {
                    cloudProject = await saveUserProject({
                        projectType: 'workflow',
                        name: nextName,
                        data: payload
                    });
                } else {
                    addConsoleLog(error?.message || '保存到数据库失败。', 'error');
                    return false;
                }
            }

            const synced = syncWorkflowProjectFromCloud({
                ...cloudProject,
                data: payload
            }, { announce: false });

            if (synced) {
                addConsoleLog(`已保存到数据库，并同步当前工作流映射：${synced.name}`, 'info');
            } else {
                addConsoleLog('已保存到数据库。', 'info');
            }
            return true;
        }
    });
}

export function initFileMenu() {
    const newProjectBtn = document.getElementById('newProjectBtn');
    const saveProjectBtn = document.getElementById('saveProjectBtn');
    const saveCloudProjectBtn = document.getElementById('saveCloudProjectBtn');
    const loadProjectBtn = document.getElementById('loadProjectBtn');
    const downloadCloudProjectBtn = document.getElementById('downloadCloudProjectBtn');

    if (newProjectBtn) newProjectBtn.onclick = newProject;
    if (saveProjectBtn) saveProjectBtn.onclick = saveProjectLocally;
    if (saveCloudProjectBtn) saveCloudProjectBtn.onclick = saveProjectToCloud;
    if (loadProjectBtn) loadProjectBtn.onclick = openProjectPicker;
    if (downloadCloudProjectBtn) downloadCloudProjectBtn.onclick = downloadProjectFromCloud;
}

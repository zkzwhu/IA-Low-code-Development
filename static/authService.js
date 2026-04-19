import { showSharedDialog } from './dialogService.js';

const authState = {
    fetched: false,
    authenticated: false,
    user: null,
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function cloneAuthState() {
    return {
        fetched: authState.fetched,
        authenticated: authState.authenticated,
        user: authState.user ? { ...authState.user } : null,
    };
}

function applyAuthPayload(payload) {
    authState.fetched = true;
    authState.authenticated = Boolean(payload?.authenticated || payload?.user);
    authState.user = payload?.user && typeof payload.user === 'object'
        ? { ...payload.user }
        : null;

    const nextState = cloneAuthState();
    window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: nextState }));
    return nextState;
}

async function parseJsonResponse(response) {
    try {
        return await response.json();
    } catch (error) {
        return {};
    }
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
        const error = new Error(result?.message || '请求失败，请稍后重试。');
        error.code = result?.error_code || `HTTP_${response.status}`;
        throw error;
    }
    return result;
}

function getAuthModeMarkup(reason = '') {
    return `
        <div id="authDialogRoot" data-auth-mode="login">
            ${reason ? `<div class="shared-help-text">${escapeHtml(reason)}</div>` : ''}
            <div class="shared-auth-controls" style="justify-content:flex-start;">
                <button type="button" class="shared-auth-btn secondary" data-auth-switch="login">登录</button>
                <button type="button" class="shared-auth-btn secondary" data-auth-switch="register">注册</button>
            </div>
            <div class="shared-form-grid">
                <div class="shared-field">
                    <label for="authUsernameInput">用户名</label>
                    <input class="shared-input" id="authUsernameInput" autocomplete="username" placeholder="至少 3 个字符">
                </div>
                <div class="shared-field" data-auth-register-field style="display:none;">
                    <label for="authDisplayNameInput">显示名称</label>
                    <input class="shared-input" id="authDisplayNameInput" autocomplete="nickname" placeholder="可选，不填则使用用户名">
                </div>
                <div class="shared-field">
                    <label for="authPasswordInput">密码</label>
                    <input class="shared-input" id="authPasswordInput" type="password" autocomplete="current-password" placeholder="至少 6 个字符">
                </div>
                <div class="shared-field" data-auth-register-field style="display:none;">
                    <label for="authConfirmPasswordInput">确认密码</label>
                    <input class="shared-input" id="authConfirmPasswordInput" type="password" autocomplete="new-password" placeholder="再次输入密码">
                </div>
            </div>
            <div class="shared-help-text">系统会默认创建一个演示账号：root / root123456。</div>
        </div>
    `;
}

function updateAuthDialogMode(root, api, mode = 'login') {
    const nextMode = mode === 'register' ? 'register' : 'login';
    root.dataset.authMode = nextMode;

    root.querySelectorAll('[data-auth-switch]').forEach((button) => {
        const buttonMode = button.getAttribute('data-auth-switch');
        button.classList.toggle('primary', buttonMode === nextMode);
        button.classList.toggle('secondary', buttonMode !== nextMode);
    });

    root.querySelectorAll('[data-auth-register-field]').forEach((element) => {
        element.style.display = nextMode === 'register' ? '' : 'none';
    });

    api.confirmBtn.textContent = nextMode === 'register' ? '注册并登录' : '登录';
    api.titleEl.textContent = nextMode === 'register' ? '注册账号' : '登录账号';
}

export function getAuthState() {
    return cloneAuthState();
}

export async function refreshAuthSession() {
    try {
        const result = await requestJson('/api/auth/session', {
            method: 'GET',
            cache: 'no-store',
        });
        return applyAuthPayload(result);
    } catch (error) {
        return applyAuthPayload({ authenticated: false, user: null });
    }
}

export async function logoutUser() {
    await requestJson('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    return applyAuthPayload({ authenticated: false, user: null });
}

export async function showAuthDialog({ reason = '', mode = 'login' } = {}) {
    const result = await showSharedDialog({
        title: mode === 'register' ? '注册账号' : '登录账号',
        subtitle: reason || '未登录时仍可使用编辑界面，但保存到数据库或从数据库下载项目时需要先登录。',
        bodyHtml: getAuthModeMarkup(reason),
        confirmText: mode === 'register' ? '注册并登录' : '登录',
        cancelText: '取消',
        onOpen: (api) => {
            const root = api.bodyEl.querySelector('#authDialogRoot');
            if (!root) return;

            const bindModeSwitch = (nextMode) => {
                updateAuthDialogMode(root, api, nextMode);
                const usernameInput = root.querySelector('#authUsernameInput');
                usernameInput?.focus();
            };

            root.querySelectorAll('[data-auth-switch]').forEach((button) => {
                button.addEventListener('click', () => {
                    bindModeSwitch(button.getAttribute('data-auth-switch') || 'login');
                });
            });

            bindModeSwitch(mode);
        },
        onConfirm: async ({ bodyEl, setMessage }) => {
            const root = bodyEl.querySelector('#authDialogRoot');
            const currentMode = root?.dataset.authMode === 'register' ? 'register' : 'login';
            const username = String(bodyEl.querySelector('#authUsernameInput')?.value || '').trim();
            const password = String(bodyEl.querySelector('#authPasswordInput')?.value || '');
            const displayName = String(bodyEl.querySelector('#authDisplayNameInput')?.value || '').trim();
            const confirmPassword = String(bodyEl.querySelector('#authConfirmPasswordInput')?.value || '');

            if (username.length < 3) {
                setMessage('用户名至少需要 3 个字符。', 'error');
                return false;
            }
            if (password.length < 6) {
                setMessage('密码至少需要 6 个字符。', 'error');
                return false;
            }
            if (currentMode === 'register' && password !== confirmPassword) {
                setMessage('两次输入的密码不一致。', 'error');
                return false;
            }

            const endpoint = currentMode === 'register' ? '/api/auth/register' : '/api/auth/login';
            const payload = currentMode === 'register'
                ? { username, password, display_name: displayName }
                : { username, password };
            const response = await requestJson(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            return applyAuthPayload({
                authenticated: true,
                user: response?.user || null,
            });
        },
    });

    return result || cloneAuthState();
}

export async function requireAuthenticated(reason = '') {
    const current = authState.fetched ? cloneAuthState() : await refreshAuthSession();
    if (current.authenticated) return current;

    const result = await showAuthDialog({ reason, mode: 'login' });
    return result?.authenticated ? result : null;
}

export function attachAuthControls(container, {
    loginText = '登录',
    logoutText = '退出',
    anonymousLabel = '未登录',
    formatUserLabel = (user) => `当前用户：${user.display_name || user.username}`,
    buttonVariant = 'secondary',
} = {}) {
    if (!container) return () => {};

    const render = (nextState = cloneAuthState()) => {
        const userLabel = nextState.authenticated && nextState.user
            ? formatUserLabel(nextState.user)
            : anonymousLabel;

        container.innerHTML = `
            <span class="shared-auth-badge ${nextState.authenticated ? '' : 'muted'}">${escapeHtml(userLabel)}</span>
            <button type="button" class="shared-auth-btn ${buttonVariant}" data-auth-action="${nextState.authenticated ? 'logout' : 'login'}">
                ${nextState.authenticated ? escapeHtml(logoutText) : escapeHtml(loginText)}
            </button>
        `;
    };

    const handleClick = async (event) => {
        const action = event.target?.getAttribute('data-auth-action');
        if (!action) return;

        try {
            if (action === 'login') {
                await showAuthDialog();
            } else if (action === 'logout') {
                await logoutUser();
            }
        } catch (error) {
            window.alert(error?.message || '操作失败，请稍后重试。');
        }
    };

    const handleStateChange = (event) => {
        render(event.detail || cloneAuthState());
    };

    container.classList.add('shared-auth-controls');
    container.addEventListener('click', handleClick);
    window.addEventListener('auth-state-changed', handleStateChange);
    render(cloneAuthState());

    if (!authState.fetched) {
        refreshAuthSession().then(render);
    }

    return () => {
        container.removeEventListener('click', handleClick);
        window.removeEventListener('auth-state-changed', handleStateChange);
    };
}

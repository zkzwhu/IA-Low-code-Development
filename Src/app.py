import os
from flask import Flask, render_template, request, jsonify

current_dir = os.path.dirname(os.path.abspath(__file__))
template_dir = os.path.join(current_dir, '..', 'templates')
static_dir = os.path.join(current_dir, '..', 'static')

app = Flask(__name__,
            template_folder=template_dir,
            static_folder=static_dir)

# 内存存储当前工作流
current_workflow = {
    "nodes": [],
    "next_id": 100
}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/workflow/save', methods=['POST'])
def save_workflow():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    current_workflow['nodes'] = data.get('nodes', [])
    current_workflow['next_id'] = data.get('next_id', 100)
    return jsonify({"status": "ok"})

@app.route('/api/workflow/load', methods=['GET'])
def load_workflow():
    return jsonify(current_workflow)

@app.route('/api/workflow/execute', methods=['POST'])
def execute_workflow():
    data = request.get_json()
    nodes_data = data.get('nodes', [])
    if not nodes_data:
        return jsonify({"logs": ["❌ 错误：没有节点数据"]})

    nodes_map = {node['id']: node for node in nodes_data}

    start_node = None
    for node in nodes_data:
        if node.get('type') == 'start':
            start_node = node
            break

    if not start_node:
        return jsonify({"logs": ["❌ 错误：未找到开始节点"]})

    logs = []
    step_limit = 500

    def add_log(msg):
        logs.append(msg)

    def exec_node(node_id, depth=0):
        nonlocal step_limit
        if step_limit <= 0:
            add_log("❌ 执行步数超限，可能死循环")
            return
        step_limit -= 1

        if node_id is None:
            return
        node = nodes_map.get(node_id)
        if not node:
            add_log(f"⚠️ 警告：节点 {node_id} 不存在")
            return

        indent = "  " * depth
        node_type = node.get('type', 'unknown')
        add_log(f"{indent}▶ 执行节点 [{node_type}] ID:{node_id}")

        props = node.get('properties', {})

        if node_type == 'print':
            msg = props.get('message', '(空消息)')
            add_log(f"{indent}🖨️ 打印: {msg}")
            next_id = props.get('nextNodeId')
            exec_node(next_id, depth)

        elif node_type == 'sequence':
            next_id = props.get('nextNodeId')
            exec_node(next_id, depth)

        elif node_type == 'start':
            next_id = props.get('nextNodeId')
            exec_node(next_id, depth)

        elif node_type == 'loop':
            cond_type = props.get('loopConditionType', 'count')
            loop_count = props.get('loopCount', 1)
            body_ids = props.get('bodyNodeIds', []) or []
            next_id = props.get('nextNodeId')

            # 目前执行器只实现 count 模式；expr 模式先按 1 次执行并提示
            if cond_type == 'expr':
                add_log(f"{indent}🔁 循环条件(expr) 尚未执行化，先按 1 次运行：{props.get('loopConditionExpr', '')}")
                loop_count = 1
            try:
                loop_count = int(loop_count)
            except Exception:
                loop_count = 1
            if loop_count < 1:
                loop_count = 1

            add_log(f"{indent}🔄 循环开始: 共 {loop_count} 次")
            for i in range(1, loop_count + 1):
                add_log(f"{indent}   ↻ 循环第 {i} 次")
                if body_ids:
                    for bid in body_ids:
                        exec_node(bid, depth + 1)
                else:
                    add_log(f"{indent}  ⚠️ 循环体为空")
            add_log(f"{indent}✅ 循环结束")
            exec_node(next_id, depth)

        elif node_type == 'branch':
            condition = props.get('branchCondition', True)
            true_branch = props.get('trueBranchId')
            false_branch = props.get('falseBranchId')
            add_log(f"{indent}🌿 分支判断: 条件 = {'真' if condition else '假'}")
            if condition and true_branch:
                exec_node(true_branch, depth + 1)
            elif not condition and false_branch:
                exec_node(false_branch, depth + 1)
            else:
                add_log(f"{indent}  ⚠️ 未选择有效分支")
            next_id = props.get('nextNodeId')
            exec_node(next_id, depth)

        else:
            add_log(f"{indent}⚠️ 未知节点类型: {node_type}")

    try:
        add_log("========== 开始执行工作流 ==========")
        exec_node(start_node['id'])
        add_log("========== 工作流执行完毕 ==========")
    except Exception as e:
        add_log(f"❌ 执行错误: {str(e)}")

    return jsonify({"logs": logs})

if __name__ == '__main__':
    app.run(debug=True)
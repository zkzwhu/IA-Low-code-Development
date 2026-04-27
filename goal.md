# 智慧农业工作流改造方案

目标链路统一为：`数据采集 -> 环境建模 -> 分析 -> 输出 -> 可视化`。

## 模块划分

1. 数据获取层：只允许 `get_sensor_info` 与 `db_query` 产生外部数据。
2. 环境建模层：新增 `environment_model`，只消费上游标准化数据包，不直接访问 API 或数据库。
3. 分析层：`analytics_summary` 等分析节点优先消费 `environment_model` 输出。
4. 输出层：只有 `output` 节点对外暴露结果，供大屏绑定。
5. 静态检测层：执行前检查无数据源、无建模层、无输出层、数据孤岛、分析节点无动态输入等问题。

## 环节 1：数据获取层

### 数据结构设计

数据获取节点统一输出 `ia.workflow.data_packet.v1` 数据包：

```json
{
  "contract": "ia.workflow.data_packet.v1",
  "sourceNodeType": "get_sensor_info",
  "sourceName": "获取传感器信息1",
  "timestamp": "2026-04-27T15:30:00",
  "latest": {
    "temperature": 25,
    "humidity": 60,
    "light_lux": 18000,
    "soil_moisture": 48,
    "pm25": 22,
    "pm10": 55,
    "atmospheric_pressure": 1012,
    "co2": null,
    "timestamp": "2026-04-27 15:30:00",
    "device_id": "SmartAgriculture_thermometer"
  },
  "records": []
}
```

### 节点输出规范

- `get_sensor_info`：读取设备列表或最近传感器数据，输出标准化数据包。
- `db_query`：仅允许只读 `SELECT`，查询结果映射为同一数据包。
- 其他节点禁止直接访问 API / 数据库，必须通过上游变量消费数据包。
- 大屏应用只能绑定 `output` 节点暴露的结果。

### 示例数据流

```text
get_sensor_info
  -> latest_sensor_packet
  -> environment_model.inputVariableId
  -> environment_model_result
  -> analytics_summary.inputVariableId
  -> environment_summary
  -> output.variableId
  -> 大屏组件绑定 output 端口
```

## 环节 2：environment_model 节点

### 1. 文献指标提取说明

节点指标体系参考以下研究思路：

- 设施农业/温室环境监测常用空气温度、空气湿度、光照强度、土壤湿度、CO2、PM2.5、PM10、大气压等传感器指标。
- 耕地质量评价通常从土壤理化性状、水分、养分、有机质、pH、灌溉能力、排水能力、清洁程度、障碍因素构建指标体系。
- 农业绿色发展评价常使用熵权法、TOPSIS、灰色关联分析、综合指数法等多指标综合评价方法。

### 2. 指标体系设计

| 指标 | 类型 | 来源字段 |
| --- | --- | --- |
| 空气温度 | 适宜区间型 | `temperature` |
| 空气湿度 | 适宜区间型 | `humidity` |
| 光照强度 | 适宜区间型 | `light_lux` |
| 土壤水分 | 适宜区间型 | `soil_moisture` / `soil_humidity` |
| PM2.5 | 负向指标 | `pm25` |
| PM10 | 负向指标 | `pm10` |
| 大气压 | 适宜区间型 | `atmospheric_pressure` |
| CO2 | 适宜区间型 | `co2` |

子指标包括 `temperatureHumidity`、`light`、`soilMoisture`、`airQuality`、`pressure`、`stability`。

### 3. 指标计算公式

适宜区间型指标：

```text
score = 100                              x in [low, high]
score = (x - hard_low) / (low - hard_low) * 100
score = (hard_high - x) / (hard_high - high) * 100
score 限制在 [0, 100]
```

负向指标：

```text
score = 100                              x <= excellent
score = (unacceptable - x) / (unacceptable - excellent) * 100
score 限制在 [0, 100]
```

综合评分：

```text
environmentScore =
  temperatureHumidity * 0.25 +
  light * 0.18 +
  soilMoisture * 0.24 +
  airQuality * 0.18 +
  pressure * 0.05 +
  stability * 0.10
```

等级规则：`>=85 优秀`，`>=70 良好`，`>=55 一般`，`<55 较差`。

### 4. 环境评价模型设计

当前实现支持“加权综合指数法”，并在节点配置中预留熵权法、TOPSIS、灰色关联分析选项。预留方法会记录在输出 `method` 中，实际计算回落到 `weighted_index`。

### 5. 节点输入输出结构

输入：

```json
{
  "inputVariableId": "latest_sensor_packet",
  "method": "weighted_index"
}
```

输出：

```json
{
  "environmentScore": 82.5,
  "environmentLevel": "良好",
  "riskType": "轻度干旱风险",
  "mainLimitingFactors": ["土壤湿度偏离适宜区间", "光照不足或过强"],
  "suggestions": ["建议根据土壤湿度执行分区灌溉或排水。"],
  "indicatorScores": {
    "temperatureHumidity": 88,
    "light": 72,
    "soilMoisture": 65,
    "airQuality": 93
  }
}
```

### 6. 后续联动方式

- `branch`：可基于 `environmentLevel` 或 `environmentScore` 做预警分支。
- `analytics_summary`：消费环境模型结果，生成总览、告警和建议。
- `output`：统一暴露评分、风险类型、限制因子、建议和大屏契约。
- 大屏：只能绑定 `output` 端口。

## 静态检测机制

执行前检测：

- 是否存在 `get_sensor_info` 或 `db_query`。
- 是否存在 `environment_model`。
- 是否存在 `output`。
- 数据获取节点是否写入变量。
- `environment_model` 是否有上游输入变量和输出变量。
- 分析节点是否有动态输入变量，避免直接访问数据库/API。
- 数据源是否通过连线流向 `environment_model`。
- `environment_model` 是否通过后续链路流向 `output`。
- 是否存在未连入工作流的孤立节点。

## 环节 3：节点联动与数据流机制

### 数据流结构

运行时维护四类数据：

```json
{
  "nodeValuesById": {
    "3": {
      "output": {}
    }
  },
  "variableValues": {
    "workflow-variable-id": "{}"
  },
  "portValuesById": {
    "workflow-port-id": "{}"
  },
  "portValuesByName": {
    "环境评分": "{}"
  }
}
```

约束：

- 节点输入来自上游节点输出变量或端口。
- 节点输出写入 `targetVariableId`，最终由 `output.variableId` 暴露为工作流端口。
- 大屏只读取 `workflow runtime store` 中的 `portValuesById` / `portValuesByName`。

### 执行引擎伪代码

```text
executeWorkflow(workflow):
  staticResult = detectStaticWorkflow(workflow)
  if staticResult.isStatic:
    return error(staticResult)

  edges = buildEdges(workflow.nodes)
  order = topologicalSort(nodes, edges)

  variableValues = initVariables(workflow.variables)
  nodeValuesById = {}

  for nodeId in order:
    node = nodes[nodeId]
    upstreamPayload = collectUpstreamValues(node, edges, nodeValuesById, variableValues)
    result = executeNode(node, upstreamPayload)
    nodeValuesById[nodeId] = result
    if node.targetVariableId:
      variableValues[node.targetVariableId] = result.output

  portValuesById = {}
  portValuesByName = {}
  for port in workflow.ports:
    outputNode = nodes[port.nodeId]
    value = variableValues[outputNode.variableId]
    portValuesById[port.id] = value
    portValuesByName[port.name] = value

  saveWorkflowRuntime(portValuesById, portValuesByName)
```

### 节点执行顺序算法

```text
topologicalSort(nodes, edges):
  indegree[node] = 0
  for edge in edges:
    indegree[edge.to] += 1

  queue = nodes where indegree == 0
  order = []

  while queue not empty:
    node = queue.pop()
    order.append(node)
    for next in adjacency[node]:
      indegree[next] -= 1
      if indegree[next] == 0:
        queue.push(next)

  if len(order) != len(nodes):
    report cycle
  return order
```

当前实现中，`nextNodeId`、`trueBranchId`、`falseBranchId`、`bodyNodeIds`、`trueBodyNodeIds`、`falseBodyNodeIds` 都会被视为有效连线，运行前会计算拓扑顺序并输出到执行日志。

## 环节 4：数据分析节点

### 分析节点逻辑设计

分析节点必须消费：

- `environment_model` 输出的环境模型结果。
- 或上游数据获取节点传递来的标准化数据包。

节点类型：

- `branch`：基于上游模型字段执行 if/else，例如 `environmentScore < 70`。
- `loop`：对上游 records 或指标列表循环处理，例如逐条检查异常值。
- `analytics_summary`：对环境模型结果生成摘要、告警、建议。
- `custom logic`：后续可扩展为字段、操作符、阈值、输出模板的规则节点。

### 示例规则

```json
[
  {
    "name": "高温预警",
    "when": "indicatorValues.temperature > 30",
    "then": {
      "riskType": "高温预警",
      "suggestion": "建议开启通风、遮阳或喷雾降温。"
    }
  },
  {
    "name": "灌溉建议",
    "when": "indicatorValues.soil_moisture < 30",
    "then": {
      "riskType": "干旱风险",
      "suggestion": "建议执行分区精准灌溉。"
    }
  },
  {
    "name": "空气质量预警",
    "when": "indicatorScores.airQuality < 60",
    "then": {
      "riskType": "空气质量风险",
      "suggestion": "建议检查通风、过滤和粉尘来源。"
    }
  }
]
```

### 数据流路径

```text
get_sensor_info / db_query
  -> 标准化数据包
  -> environment_model
  -> indicatorValues / indicatorScores / environmentScore
  -> branch / loop / analytics_summary
  -> output
  -> workflow runtime
  -> 大屏
```

## 环节 5：输出节点

### 输出结构

`output` 节点必须绑定变量：

```json
{
  "nodeId": 5,
  "type": "output",
  "properties": {
    "variableId": "environment_summary"
  }
}
```

工作流端口：

```json
{
  "id": "workflow-port-env-score",
  "name": "环境评分",
  "nodeId": 5,
  "field": "outputValue",
  "dataType": "string"
}
```

运行结果：

```json
{
  "portValuesById": {
    "workflow-port-env-score": "{\"environmentScore\":82.5}"
  },
  "portValuesByName": {
    "环境评分": "{\"environmentScore\":82.5}"
  }
}
```

### Runtime Store 对接

前端运行工作流后调用：

```text
saveWorkflowRuntime(projectId, {
  portValuesById,
  portValuesByName
})
```

大屏组件绑定时先按端口 ID 读取，端口 ID 不存在时再按端口名兜底。

## 环节 6：大屏数据绑定机制

### 数据绑定逻辑

组件数据源只支持：

```json
{
  "mode": "workflow-port",
  "workflowProjectId": "workflow-project-id",
  "workflowPortId": "workflow-port-id"
}
```

解析优先级：

1. 从 `workflow runtime` 读取 `portValuesById[portId]`。
2. 若端口 ID 未命中，读取 `portValuesByName[portName]`。
3. 根据组件类型解析数据：
   - 文本：直接显示字符串或数字。
   - 图表：解析 CSV 或结构化 JSON 中的图表数据。
   - 图片：解析图片 URL / Base64。
   - 农业专题卡：解析 `screen_contract` / 环境模型 JSON。

### 更新机制

- 编辑器内监听 `localStorage` 的 `ia.lowcode.workflow.runtime.v1` 变化并重新渲染。
- 生成的大屏页面每 3 秒检查 workflow runtime 快照。
- 如果绑定端口的 `updatedAt` 或值发生变化，页面自动刷新，确保文本、图表、图片和农业卡片都能拿到最新端口值。

### 示例绑定流程

```text
1. 工作流配置 output 节点，并创建端口“环境评分”
2. 运行工作流，结果写入 runtime:
   portValuesById["workflow-port-env-score"]
3. 大屏文本/图表/农业卡片选择“工作流端口”
4. 选择对应工作流项目和“环境评分”端口
5. 大屏从 runtime 读取端口值并渲染
6. 后续工作流再次运行，runtime 更新，大屏自动刷新
```

## 环节 7：工作流静态性检测机制

### 检测规则

满足任一条件即为静态工作流：

1. 没有 `get_sensor_info` / `db_query` 数据源节点。
2. 所有节点输入均为固定值，未引用上游动态变量。
3. 节点之间没有有效连接。
4. 输出节点绑定的变量不依赖上游动态数据。
5. 本次运行与上次运行的端口结果完全一致，可判定为运行结果恒定。

输出结构：

```json
{
  "isStatic": true,
  "reasons": [
    "未检测到数据源节点",
    "节点未建立数据连接"
  ]
}
```

### 检测流程伪代码

```text
detectStaticWorkflow(workflow, previousRuntime):
  reasons = []
  edges = buildEdges(workflow.nodes)

  if no data source:
    reasons.add("未检测到数据源节点")

  if edges is empty:
    reasons.add("节点未建立数据连接")

  dynamicVariables = variables written by data source nodes
  repeat:
    for node in nodes:
      if node.inputVariableId in dynamicVariables:
        dynamicVariables.add(node.targetVariableId)
  until no change

  for output in outputNodes:
    if output.variableId not in dynamicVariables:
      reasons.add("输出节点不依赖上游动态数据")

  if currentPortValues == previousRuntime.portValues:
    reasons.add("数据未发生变化，运行结果恒定")

  return {
    isStatic: reasons.length > 0,
    reasons
  }
```

### 执行引擎集成

- 运行前调用 `validate_workflow_static`，发现结构性静态问题时直接阻断执行。
- 运行后返回 `static_analysis`，供前端 UI 提示“当前工作流为静态”。
- 前端运行工作流后展示静态原因，并将有效结果写入 `workflow runtime store`。
- 大屏只读取 runtime 中的输出端口，不读取静态配置或节点内部变量。

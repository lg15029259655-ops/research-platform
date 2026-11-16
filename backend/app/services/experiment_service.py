"""实验流程导图：AI 编排实验阶段 + 确定性模板兜底。

为什么单独一个服务：设计页的这张图只依赖研究目标与约束，不复用论文片段，与
research.py 里的四个任务输入形态不同；单独成文件便于单测，也避免 research.py
继续膨胀。

两条硬约束：
1. 分类必须落在前端图标的 11 个粗分类里，否则设计页会出现没有图标的节点；
2. 任何 AI 失败（超时 / 结构化失败 / 其他异常）都回退到确定性模板，绝不 504——
   设计页的主视觉不能因为模型慢就变空白。
"""

import asyncio
import logging

from .research_ai import StructuredAIError, run_task

logger = logging.getLogger(__name__)

# 11 个粗分类的展示名与包含项。与前端 frontend/src/lib/experiment-categories.ts 一一对应：
# id 用于图标与后端校验，name/includes 只作为提示词上下文，帮助模型把具体实验归到正确的粗类。
CATEGORY_NAMES: dict[str, str] = {
    "data_analysis": "数据分析 · 生信",
    "cell_experiment": "细胞实验",
    "animal_experiment": "动物实验",
    "molecular_experiment": "分子实验",
    "clinical_sample": "临床样本",
    "imaging": "影像 / 显微",
    "materials_prep": "材料制备",
    "engineering_test": "工程 / 仿真",
    "modeling_algorithm": "建模 / 算法",
    "survey_statistics": "问卷 / 统计",
    "result_conclusion": "结论 / 验证",
}

CATEGORY_INCLUDES: dict[str, tuple[str, ...]] = {
    "data_analysis": ("数据库筛选", "差异表达分析", "富集分析", "免疫浸润分析", "单细胞分析", "预后模型"),
    "cell_experiment": ("细胞培养", "共培养", "敲低/敲除", "过表达", "增殖/凋亡", "迁移/侵袭", "克隆形成"),
    "animal_experiment": ("模型构建", "分组对照", "给药", "活体成像", "取材", "组织切片", "生存分析"),
    "molecular_experiment": ("Western blot", "qPCR", "ELISA", "Co-IP", "ChIP", "免疫组化", "质谱"),
    "clinical_sample": ("组织芯片", "病例队列", "随访", "病理评分", "伦理审批"),
    "imaging": ("共聚焦", "电镜", "活细胞成像", "MRI/CT/PET"),
    "materials_prep": ("合成", "制备", "SEM/XRD 表征", "性能与稳定性测试"),
    "engineering_test": ("有限元仿真", "样机", "台架测试", "可靠性", "部署验证"),
    "modeling_algorithm": ("模型构建", "基线对照", "消融实验", "基准测试", "泛化评估"),
    "survey_statistics": ("量表设计", "抽样", "回归模型", "政策数据分析"),
    "result_conclusion": ("假设验证", "结果整合", "边界与外推", "下一步计划"),
}

CATEGORY_IDS: tuple[str, ...] = tuple(CATEGORY_NAMES)

MAX_STAGES = 6
MIN_STAGES = 3
MAX_CHILDREN = 5
MAX_TITLE = 24
MAX_DETAIL = 60


def _truncate(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _unique_id(candidate: str, fallback: str, seen: set[str]) -> str:
    """模型偶尔给重复或空 id；前端用 id 做 key，重复会导致节点渲染错乱。"""
    base = candidate.strip() or fallback
    value = base
    suffix = 1
    while value in seen:
        suffix += 1
        value = f"{base}-{suffix}"
    seen.add(value)
    return value


def validate_workflow(workflow: dict) -> list[dict]:
    """把（可能不规范的）流程树裁剪成接口契约允许的形状。

    Pydantic 的 ExperimentWorkflow 已经用 Literal 限制 category，这里再校验一次：
    - 直接调用本函数（单测、模板、未来其它数据源）不会绕过；
    - 非法分类的节点整支丢弃（stage 被丢时 children 连带），
      而不是让整份结果失败——模型只写错一个分类，不该把其余节点也废掉。
    """
    raw_stages = workflow.get("stages") if isinstance(workflow, dict) else None
    if not isinstance(raw_stages, list):
        return []

    stages: list[dict] = []
    seen: set[str] = set()
    for stage_index, raw_stage in enumerate(raw_stages):
        if len(stages) >= MAX_STAGES:
            break
        if not isinstance(raw_stage, dict):
            continue
        category = str(raw_stage.get("category", "")).strip()
        title = _truncate(raw_stage.get("title"), MAX_TITLE)
        if category not in CATEGORY_NAMES or not title:
            continue
        stage_id = _unique_id(str(raw_stage.get("id") or ""), f"S{stage_index + 1}", seen)

        raw_children = raw_stage.get("children")
        children: list[dict] = []
        for child_index, raw_child in enumerate(raw_children if isinstance(raw_children, list) else []):
            if len(children) >= MAX_CHILDREN:
                break
            if not isinstance(raw_child, dict):
                continue
            child_category = str(raw_child.get("category", "")).strip()
            child_title = _truncate(raw_child.get("title"), MAX_TITLE)
            if child_category not in CATEGORY_NAMES or not child_title:
                continue
            child_id = _unique_id(str(raw_child.get("id") or ""), f"{stage_id}-{child_index + 1}", seen)
            # 契约要求树深最多两层：叶子节点的 children 一律清空。
            children.append({
                "id": child_id,
                "title": child_title,
                "category": child_category,
                "detail": _truncate(raw_child.get("detail"), MAX_DETAIL),
                "children": [],
            })

        stages.append({
            "id": stage_id,
            "title": title,
            "category": category,
            "detail": _truncate(raw_stage.get("detail"), MAX_DETAIL),
            "children": children,
        })
    return stages


# 领域关键词只用于"模板兜底"时选一套通用骨架；AI 正常时不会用到。
# 顺序有讲究：先材料/工程（关键词更具体），再社科，最后 CS；都不匹配按生物医学默认。
_DOMAIN_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("materials", ("材料", "合成", "表征", "催化", "电极", "电池", "合金", "聚合物", "钙钛矿",
                   "material", "catalyst", "polymer", "alloy", "electrode", "perovskite")),
    ("engineering", ("工程", "仿真", "有限元", "样机", "台架", "传感器", "机器人", "可靠性",
                     "engineering", "simulation", "finite element", "robot", "sensor")),
    ("social", ("问卷", "量表", "调查", "政策", "回归", "社会", "教育", "经济",
                "survey", "policy", "regression", "social", "economic")),
    ("cs", ("算法", "神经网络", "训练", "基准", "消融", "泛化", "深度学习", "分类器", "检测模型",
            "algorithm", "neural", "benchmark", "transformer", "machine learning", "ablation")),
)

# 每套模板：(阶段标题, 分类, 阶段说明, [(子实验标题, 分类, 说明), ...])
# 说明文字只描述"做什么/看什么"，不写样本量、浓度、剂量、周期等具体数值。
_TEMPLATES: dict[str, tuple[tuple[str, str, str, tuple[tuple[str, str, str], ...]], ...]] = {
    "biomed": (
        ("数据分析与线索", "data_analysis", "先明确可检验的假设与主要结局，再从已有数据里找候选线索", (
            ("数据库与队列筛选", "data_analysis", "确定可用的公开数据或队列，记录纳排标准"),
            ("差异表达与富集分析", "data_analysis", "找出组间差异并看富集到哪些通路"),
            ("预实验数据核对", "data_analysis", "检查数据质量与批次效应，确认可复现"),
        )),
        ("细胞水平验证", "cell_experiment", "在细胞模型上验证核心表型与机制方向", (
            ("细胞培养与分组", "cell_experiment", "设置对照与处理组，先确认细胞状态一致"),
            ("敲低/过表达与表型检测", "cell_experiment", "改变目标基因后看表型是否随之变化"),
            ("增殖/迁移等功能实验", "cell_experiment", "用功能实验判断表型的方向与强度"),
        )),
        ("动物水平验证", "animal_experiment", "在动物模型上确认在体效应并观察安全性线索", (
            ("模型构建与分组", "animal_experiment", "建立疾病模型并随机分组，记录基线差异"),
            ("给药与样本取材", "animal_experiment", "按方案处理并规范取材，避免批次偏差"),
            ("组织切片与表型评估", "animal_experiment", "用病理与组化评估在体表型"),
        )),
        ("分子机制与样本核对", "molecular_experiment", "用分子实验与临床样本验证机制与适用性", (
            ("蛋白/核酸表达检测", "molecular_experiment", "检测目标通路的表达变化并设置内参"),
            ("通路与互作验证", "molecular_experiment", "验证关键互作是否成立，排除旁路解释"),
            ("临床样本一致性", "clinical_sample", "在样本中核对关联方向，注意伦理与随访信息"),
        )),
        ("结论与边界", "result_conclusion", "整合证据、说明外推边界并给出下一步", (
            ("假设逐条核对", "result_conclusion", "对照主假设逐条判断支持或证据不足"),
            ("局限与替代解释", "result_conclusion", "列出混杂、模型差异与外推限制"),
        )),
    ),
    "materials": (
        ("材料设计与合成", "materials_prep", "先定组分与结构目标，再做可重复的合成制备", (
            ("组分与结构设计", "materials_prep", "明确要优化的组成或结构变量"),
            ("合成与制备", "materials_prep", "按可重复流程制备样品并留样"),
            ("工艺记录与对照样品", "materials_prep", "记录工艺差异，准备对照样品"),
        )),
        ("表征与性能测试", "materials_prep", "用表征确认结构，用性能测试确认目标指标", (
            ("形貌与结构表征", "materials_prep", "用显微与衍射手段确认结构与形貌"),
            ("性能测试", "materials_prep", "在统一条件下比较关键性能指标"),
            ("对照与重复性", "materials_prep", "检查平行样与批次间一致性"),
        )),
        ("稳定性与机理验证", "materials_prep", "确认长期稳定性并解释性能来源", (
            ("循环稳定性测试", "materials_prep", "反复循环后看性能衰减趋势"),
            ("机理表征", "materials_prep", "结合谱学手段解释性能变化原因"),
            ("失效样品分析", "materials_prep", "分析衰减样品，定位失效环节"),
        )),
        ("结论与边界", "result_conclusion", "总结优势与适用条件，说明外推限制", (
            ("指标整合与比较", "result_conclusion", "把各项指标放在同一口径下比较"),
            ("应用边界与下一步", "result_conclusion", "说明适用条件与仍需补做的验证"),
        )),
    ),
    "engineering": (
        ("需求与方案", "engineering_test", "把目标拆成可测量的指标与约束，再比较方案", (
            ("约束与指标定义", "engineering_test", "明确性能、成本与使用环境约束"),
            ("方案对比", "engineering_test", "比较候选方案的技术路线与风险"),
            ("风险评估", "engineering_test", "列出关键失效模式与验证优先级"),
        )),
        ("建模与仿真", "modeling_algorithm", "先用仿真筛选方案，减少样机试错", (
            ("模型建立", "modeling_algorithm", "建立能反映主要物理过程的分析模型"),
            ("仿真工况设计", "modeling_algorithm", "覆盖典型工况与边界条件"),
            ("敏感性分析", "modeling_algorithm", "看关键参数变化对结果的影响"),
        )),
        ("样机与台架测试", "engineering_test", "在真实样机上验证仿真结论", (
            ("样机实现", "engineering_test", "按方案实现样机并记录装配差异"),
            ("台架测试", "engineering_test", "在受控条件下测量关键指标"),
            ("数据采集与校准", "engineering_test", "校准传感器并保留原始数据"),
        )),
        ("可靠性与部署", "result_conclusion", "验证长期可靠性与部署条件", (
            ("可靠性验证", "result_conclusion", "按使用场景做重复与耐久评估"),
            ("部署与运维条件", "result_conclusion", "确认部署环境与维护要求"),
            ("结论与下一步", "result_conclusion", "总结指标达成情况与待改进点"),
        )),
    ),
    "social": (
        ("研究设计与假设", "survey_statistics", "先明确变量与假设，再决定抽样与测量方式", (
            ("假设与变量定义", "survey_statistics", "写清自变量、因变量与主要混淆因素"),
            ("量表与问卷设计", "survey_statistics", "参考成熟量表，避免引导性表述"),
            ("抽样方案", "survey_statistics", "说明目标人群与抽样方式"),
        )),
        ("数据采集与清洗", "survey_statistics", "保证样本代表性并记录数据处理规则", (
            ("数据收集", "survey_statistics", "按统一流程收集并记录缺失情况"),
            ("质量控制", "survey_statistics", "检查作答一致性与异常值"),
            ("数据清洗与编码", "survey_statistics", "固定清洗规则，保留可追溯版本"),
        )),
        ("统计建模", "survey_statistics", "用合适模型检验假设并做稳健性检查", (
            ("描述统计", "survey_statistics", "先看分布与基本关联"),
            ("回归模型", "survey_statistics", "控制混淆后检验主要假设"),
            ("稳健性检查", "survey_statistics", "换设定或子样本复核结论"),
        )),
        ("结论与边界", "result_conclusion", "说明因果解释的边界与政策含义", (
            ("假设检验结论", "result_conclusion", "逐条对照假设给出判断"),
            ("外推与政策含义", "result_conclusion", "说明适用人群与解释限制"),
        )),
    ),
    "cs": (
        ("数据与任务定义", "data_analysis", "先把任务、评价指标与数据划分固定下来", (
            ("数据划分与基线", "data_analysis", "固定训练/验证/测试划分，避免泄漏"),
            ("预处理与特征", "data_analysis", "统一预处理流程，记录可复现参数"),
            ("评价指标", "data_analysis", "选与任务目标一致的指标"),
        )),
        ("模型构建与训练", "modeling_algorithm", "在固定数据划分上训练并做消融", (
            ("模型设计", "modeling_algorithm", "说明结构选择与关键模块的作用"),
            ("训练策略", "modeling_algorithm", "固定训练流程，记录随机种子"),
            ("消融实验", "modeling_algorithm", "逐项去掉模块，量化各自贡献"),
        )),
        ("对照与误差分析", "modeling_algorithm", "用基线与误差分析说明改进来源", (
            ("基线对照", "modeling_algorithm", "与同任务常用方法公平比较"),
            ("消融与敏感性", "modeling_algorithm", "检查结论对设定变化的稳健性"),
            ("误差分析", "modeling_algorithm", "定位错误类型，判断是否可修"),
        )),
        ("基准与泛化", "result_conclusion", "在独立基准上看泛化与代价", (
            ("基准评测", "result_conclusion", "在留出数据上报告结果"),
            ("泛化与鲁棒性", "result_conclusion", "换数据或扰动下复核表现"),
            ("结论与边界", "result_conclusion", "说明适用任务与计算代价"),
        )),
    ),
}


def detect_domain(goal: str) -> str:
    content = (goal or "").lower()
    for domain, keywords in _DOMAIN_KEYWORDS:
        if any(keyword.lower() in content for keyword in keywords):
            return domain
    return "biomed"


def template_stages(goal: str) -> list[dict]:
    """确定性兜底：按领域给一套中性骨架，保证设计页永远有 3 个以上阶段可看。"""
    template = _TEMPLATES[detect_domain(goal)]
    seen: set[str] = set()
    stages: list[dict] = []
    for stage_index, (title, category, detail, children) in enumerate(template):
        stage_id = _unique_id("", f"S{stage_index + 1}", seen)
        child_nodes = []
        for child_index, (child_title, child_category, child_detail) in enumerate(children):
            child_nodes.append({
                "id": _unique_id("", f"{stage_id}-{child_index + 1}", seen),
                "title": _truncate(child_title, MAX_TITLE),
                "category": child_category,
                "detail": _truncate(child_detail, MAX_DETAIL),
                "children": [],
            })
        stages.append({
            "id": stage_id,
            "title": _truncate(title, MAX_TITLE),
            "category": category,
            "detail": _truncate(detail, MAX_DETAIL),
            "children": child_nodes,
        })
    return stages


def _ai_context(goal: str, constraints: str) -> dict:
    return {
        "goal": goal,
        "constraints": constraints,
        "categories": [
            {"id": category_id, "name": CATEGORY_NAMES[category_id],
             "includes": list(CATEGORY_INCLUDES[category_id])}
            for category_id in CATEGORY_IDS
        ],
    }


async def execute_experiment(owner: str, goal: str, constraints: str = "", *, emit=None,
                             timeout: float | None = None) -> dict:
    """生成实验流程导图并保存为 artifact。

    emit 是 JobContext.emit，用于任务层推送阶段；直接调用（单测）时可为 None。
    timeout 只用于给同步调用方加兜底；异步任务层不传，由任务 deadline 管。
    """
    from ..research import save_artifact  # 延迟导入，避免 research <-> service 循环依赖

    goal = (goal or "").strip()
    constraints = (constraints or "").strip()

    if emit is not None:
        await emit("stage", {"stage": "planning", "label": "整理实验阶段"})

    generated_by = "template"
    stages: list[dict] = []
    try:
        if emit is not None:
            await emit("stage", {"stage": "thinking", "label": "编排实验流程"})

        async def invoke() -> dict:
            return await run_task("experiment_workflow", _ai_context(goal, constraints))

        raw = await asyncio.wait_for(invoke(), timeout=timeout) if timeout else await invoke()
        stages = validate_workflow(raw)
        if len(stages) < MIN_STAGES:
            # 模型只给了一两个阶段：与其展示残缺流程，不如换成完整模板。
            logger.warning("Experiment workflow too short (%s stages), using template", len(stages))
            stages = template_stages(goal)
        else:
            generated_by = "ai"
    except (asyncio.TimeoutError, StructuredAIError) as exc:
        logger.warning("Experiment workflow AI failed, using template: %s", type(exc).__name__)
        stages = template_stages(goal)
    except Exception as exc:  # noqa: BLE001 - 任何异常都不能让设计页 504
        logger.warning("Experiment workflow unexpected failure, using template: %s", type(exc).__name__)
        stages = template_stages(goal)

    if emit is not None:
        await emit("stage", {"stage": "validating", "label": "校验分类与节点"})

    payload = {
        "goal": goal,
        "constraints": constraints,
        "generated_by": generated_by,
        "stages": stages,
    }
    return save_artifact(owner, "experiment_workflow", [], payload)

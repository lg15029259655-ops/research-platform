# 实验流程图标 · 生成清单（供你自己生图）

> 历史记录：此清单描述同学最初预留的独立 PNG 插槽。当前版本已内置分类图集并自动匹配，无须按此清单重新生成图片；当前对应关系见 [生物研究流程图元素分类清单](Biological_Illustration_Categories.md)。以下保留作原始设计参考。

目标：**一套图标 + 文字**，把"实验设计流程"讲清楚，同时保持展示页面的视觉统一。图标由你用 GPT 生图，代码里已经留好空位——文件放进去就自动显示，没放就显示虚线占位框。

---

## 0. 怎么用（3 步）

1. 按下面 **§2 表格里的文件名** 生成图片，尺寸 **512×512 PNG**，透明背景或纯白背景。
2. 把图片放进：`frontend/public/icons/experiments/`
3. 刷新页面即可生效——**不需要改代码，也不需要重新构建**（public 目录是运行时读取的）。

> 只放一部分也可以：缺哪张就显示哪张的占位框，不影响布局。

---

## 1. 统一风格（与你发我的 4 张一致）

- 浅色扁平矢量插画，**深蓝描边**（约 `#0A2A4A`），填充用浅蓝（`#DCE9FA` / `#B9D3F3` / `#7FA8D9`）；
- 少量**淡紫**（`#CDBFE8`）、**青绿**（`#7FC8C4`）、**琥珀**（`#F2C879`）作点缀；
- 白色背景、圆角线条、细节克制；**不要文字、不要渐变、不要阴影**；
- 每个分类**只生成一张**，该分类下所有具体实验共用这张图，文字由流程节点自己显示。

可直接给 GPT 的通用后缀：

> flat vector illustration, navy outline (#0A2A4A), pastel blue fills (#DCE9FA, #B9D3F3, #7FA8D9) with small lavender/teal/amber accents, clean white background, rounded line art, minimal detail, centered, no text, no gradients, no shadows, 512x512, transparent background, icon style consistent with a medical research illustration set

---

## 2. 分类清单（按优先级）

### P0 · 先做这 5 张（覆盖大多数医学/生物演示）

| 文件名 | 分类 | 这一类包含（不用每个都画，只画"代表元素"） | 用在哪 |
|---|---|---|---|
| `data_analysis.png` | 数据分析 · 生信 | 数据库筛选、差异表达、富集分析、免疫浸润、单细胞、WGCNA、预后模型 | 流程导图第 1 阶段 + 设计沙盘节点 |
| `cell_experiment.png` | 细胞实验 | 培养传代、共培养、敲低/敲除、过表达、增殖/凋亡、迁移侵袭、克隆形成、免疫荧光 | 流程导图 + 设计沙盘 |
| `animal_experiment.png` | 动物实验 | 模型构建、分组对照、给药、活体成像、取材、组织切片、生存分析 | 流程导图 + 设计沙盘 |
| `molecular_experiment.png` | 分子实验 | WB、qPCR、ELISA、Co-IP、ChIP、免疫组化、质谱 | 流程导图 + 设计沙盘 |
| `clinical_sample.png` | 临床样本 | 组织芯片、病例队列、随访、病理评分、伦理审批 | 流程导图 |

### P1 · 有余力再补（跨学科/细化展示用）

| 文件名 | 分类 | 这一类包含 | 用在哪 |
|---|---|---|---|
| `imaging.png` | 影像 / 显微 | 共聚焦、电镜、活细胞成像、MRI/CT/PET | 流程导图 |
| `materials_prep.png` | 材料制备 | 合成、制备、SEM/XRD 表征、性能与稳定性 | 流程导图 + 设计沙盘 |
| `engineering_test.png` | 工程 / 仿真 | 有限元仿真、样机、台架、可靠性、部署验证 | 流程导图 + 设计沙盘 |
| `modeling_algorithm.png` | 建模 / 算法 | 模型构建、基线、消融、基准测试、泛化评估 | 流程导图 + 设计沙盘 |
| `survey_statistics.png` | 问卷 / 统计 | 量表、抽样、回归、政策数据 | 流程导图 |
| `result_conclusion.png` | 结论 / 验证 | 假设验证、结果整合、边界与外推、下一步计划 | 流程导图末段 |

> **最少可用集合 = 上面 P0 的 5 张。** 11 张全做当然更完整，但 5 张已经能覆盖绝大多数生物医学实验流程演示。

---

## 3. 每张图的生图提示词（可直接粘贴，追加 §1 的通用后缀）

**data_analysis.png（数据分析·生信）**
> An icon of bioinformatics analysis: a stack of database cylinders, next to a document/worksheet showing a gene-expression heatmap grid and a DNA double helix; a small bar chart hinting at differential expression. Keep it simple and readable at 48px.

**cell_experiment.png（细胞实验）**
> An icon of a cell experiment: one large stylized cell with nucleus, mitochondria and membrane protrusions, a petri dish and a pipette tip beside it.

**animal_experiment.png（动物实验）**
> An icon of a laboratory mouse (white mouse with pink ears and tail) standing beside a small cage outline and a syringe/vial, suggesting a controlled animal experiment.

**molecular_experiment.png（分子实验）**
> An icon of molecular biology experiments: a western blot membrane with three bands, a PCR tube strip, and a small antibody (Y-shape) symbol.

**clinical_sample.png（临床样本）**
> An icon of clinical samples: a tissue microarray slide (grid of small circles) with a pathology cassette and a stethoscope/clipboard silhouette.

**imaging.png（影像 / 显微）**
> An icon of microscopy/imaging: a confocal microscope outline with a glowing specimen circle and a small cross-section scan (MRI-like rings + crosshair).

**materials_prep.png（材料制备）**
> An icon of materials preparation: a flask with a nanostructure (lattice/grid of particles) and a small SEM-style tilted specimen stage, plus a thin-film wafer.

**engineering_test.png（工程 / 仿真）**
> An icon of engineering testing: a small 3D-printed prototype/circuit board with a sensor and a gauge dial, plus an outline of a finite-element mesh.

**modeling_algorithm.png（建模 / 算法）**
> An icon of model training/evaluation: a neural-network node graph (three layers of connected circles) beside a small loss curve and a confusion-matrix grid.

**survey_statistics.png（问卷 / 统计）**
> An icon of survey statistics: a clipboard questionnaire with checkboxes beside a bell-curve distribution and a scatter plot with a trend line.

**result_conclusion.png（结论 / 验证）**
> An icon of conclusion/validation: a checklist with two check marks, a lightbulb and an upward arrow, suggesting "verified hypothesis".

---

## 4. 关于你发我的第 4 张图（散点）的一个修正建议

那张图看起来是"差异基因分析"，但用散点+大小不一的圆点来表现，会被读成"相关性/气泡图"。如果要做差异基因这一类，建议换成**火山图**：

> An icon of differential gene analysis: a volcano plot with a symmetrical V-shaped cloud of dots, some highlighted red (up-regulated) and blue (down-regulated), with a DNA helix label symbol in the corner.

不过按我们的粗分类，差异基因属于 **data_analysis**（数据分析·生信），所以**可以不单独做这张**——省一张图。

---

## 5. 图标会出现在哪

1. **科研设计页 →「实验流程」tab**：新的流程图导图，每个大阶段（数据分析/细胞/动物/…）左侧一个图标，点击可展开该阶段的具体实验小点；小点复用同一张分类图标（小尺寸）。
2. **科研设计页 →「设计沙盘」**：每个设计节点左侧也会自动识别分类并挂上图标（例如节点写着"细胞共培养"→ 细胞图标）。
3. 如果以后想加分类：在 `frontend/src/lib/experiment-categories.ts` 里加一项（id/名称/关键词），再放一张同名 PNG 即可。

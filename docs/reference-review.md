# 参考项目取舍（比赛展示版）

已查看用户指定项目的官方仓库。当前没有复制这些项目的代码，也没有把它们安装为依赖。

| 项目 | 本版采用的思路 | 集成结论 |
| --- | --- | --- |
| [OpenScience](https://github.com/synthetic-sciences/openscience) | 把研究任务拆成清晰可见的步骤 | 现有逐单元阅读状态足够；不移植其完整研究工作台 |
| [PaperQA](https://github.com/Future-House/paper-qa) | 问题先定位相关论文证据，再向模型提供上下文 | 现有章节单元和相关文本选择实现轻量上下文；暂不集成 RAG |
| [EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer) | 程序控制页码、缩放和搜索 | 现有 React-PDF 已支持这些操作，保留它 |
| [MinerU](https://github.com/opendatalab/MinerU) | 复杂 PDF 结构化解析的备选路径 | 当前 PyMuPDF 规则可运行；先用真实论文评估误检，再决定是否引入 |
| [Docling](https://github.com/docling-project/docling) | 版面、表格与阅读顺序识别的备选路径 | 同上，当前未引入 |
| [Marker](https://github.com/datalab-to/marker) | PDF 到结构化文本的备选路径 | 同上，当前未引入 |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | 卡片、按钮、加载与空状态的视觉参考 | 当前 CSS 已足够，不安装整套组件 |
| [React Flow](https://github.com/xyflow/xyflow) | 关系图的节点与边表现 | 本版用简单节点箭头展示证据关系；暂不引入编辑器级依赖 |

下一步若要评估重型 PDF 解析器，应先准备至少数篇不同类型、不同排版的真实论文，记录标题、章节、主文 Figure、Table 与实际 PDF 页码的准确率。当前合成 PDF 测试只能验证流程，不能证明复杂排版识别质量。

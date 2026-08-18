---
title: "PPTAgent 与 DeepPresenter：论文讲解、代码解析与 Agent Harness 架构"
date: 2026-08-15
tags: ["PPTAgent", "DeepPresenter", "LLM Agent", "论文解析", "MCP"]
series: ["LLM Agent 论文讲解"]
featured: true
---

> 本文结合 `paper/` 目录下的两篇论文（`2501.03936.pdf` — PPTAgent，`2602.22839.pdf` — DeepPresenter）、`PPTAgent/` 仓库代码（`pptagent/` 旧版核心库 + `deeppresenter/` 当前运行时）以及 `PPTea-main/` 评测/实验代码，对两代系统的生成流程、评测流程、Agent Harness 主循环与框架架构进行系统讲解，并与"直接让 CodeX/LLM 生成 PPT"的方式做对比。

<!--more-->

## 1. 项目背景与两代系统总览

仓库 `PPTAgent/`（https://github.com/icip-cas/PPTAgent）包含两代论文的完整代码：

| 维度 | **PPTAgent** | **DeepPresenter** |
|---|---|---|
| 论文 | "PPTAgent: Generating and Evaluating Presentations Beyond Text-to-Slides"（EMNLP 2025） | "DeepPresenter: Environment-Grounded Reflection for Agentic Presentation Generation"（ACL 2026） |
| arXiv 编号 | 2501.03936 | 2602.22839 |
| 核心思想 | **两阶段、基于编辑**（edit-based）：先分析参考演示文稿提取布局与模式，再通过编辑动作修改参考幻灯片 | **双智能体 + 环境接地反思**：Researcher 自主调研写文稿，Presenter 自由式设计 HTML 幻灯片，通过 `inspect` 观察渲染产物进行反思修正 |
| 生成范式 | 模板复用/编辑式：在已有 PPTX 参考模板上执行编辑 API | 自由式（free-form）：从零写 HTML/CSS，渲染为图片再转 PPTX |
| 依赖 | 参考演示文稿（reference presentation）+ 输入文档 | 用户指令 +（可选附件）+ 网络检索 + 工具环境 |
| 角色 | planner / content_organizer / layout_selector / editor / coder / schema_extractor | Researcher（调研+文稿）、Presenter（视觉设计），可选 Planner、SubAgent |
| 评测 | PPTEval：Content / Design / Coherence 三维度（MLLM-as-a-judge） | Constraint（规则验证）/ Content / Style 三维度 + Diversity（Vendi Score），GPT-5 作为 judge |
| 对应代码 | `pptagent/`（旧版核心库） | `deeppresenter/`（当前运行时）+ `PPTea-main/sarl/`（评测） |

**时间线关系**：PPTAgent 是 2025 年 1 月开源的初代系统（基于编辑 API 的两阶段方案）；DeepPresenter 是 2025 年 12 月发布的重构版（"Agentic" 方案），保留了 `pptagent` 作为 MCP server（`pptagent-mcp`）供新系统调用。`deeppresenter/` 是当前的主产品面，`pptagent/` 是仍在包内、但主要用于 MCP server 入口的旧核心库。

---

## 2. PPTAgent：两阶段编辑式生成

### 2.1 问题定义与核心思想

**传统范式（text-to-slides）** 把生成演示文稿当作"从文档做抽象式摘要"，用预定义规则或模板把 LLM 输出转成幻灯片：

```
S = {e1, e2, ..., en} = f(C)        （公式 1：从内容 C 生成 n 个幻灯片元素）
```

其中每个元素要手动指定类型、内容、样式属性（如 `(Textbox, "Hello", {border, size, position...})`）。这种方式的缺陷：
- 需要手工指定样式属性，自动化困难；
- 输出文本密集、版式单调（图 1 右侧：Content: Tedious Text / Design: Boring layout / Coherence: Abrupt Start）。

**PPTAgent 的核心洞察**：人类制作 PPT 的流程通常是——**挑选优秀的示例幻灯片作为参考，然后把关键内容总结并迁移到这些参考幻灯片上**（Duarte, 2010）。因此 PPTAgent 把幻灯片生成分解为：

```
A = {a1, a2, ..., am} = g(C, Rj)    （公式 2：给定内容 C 与第 j 个参考幻灯片 Rj，生成 m 个可执行编辑动作）
```

即：**不是从零创建幻灯片，而是在参考幻灯片上执行一系列可执行的编辑动作**（如 replace_span、replace_image 等），从而保留参考幻灯片精心设计的版式与风格。

论文的三大贡献：
1. **PPTAgent**：把自动演示文稿生成重新定义为"以参考演示文稿为引导的编辑式过程"；
2. **PPTEval**：三维度（Content / Design / Coherence）的评测框架；
3. 发布 **Zenodo10K** 数据集（从 Zenodo 爬取的 10,448 份跨领域演示文稿）。

### 2.2 Stage I：Presentation Analysis（演示文稿分析）

对应代码：`pptagent/induct.py`（`SlideInducter` 类）与 `pptagent/model_utils.py`（聚类算法）。

目标：分析参考演示文稿，提取**幻灯片的版面类型（functional type）与内容模式（content schema）**，为后续的参考选择与幻灯片生成提供指导。

#### Step 1：幻灯片分类（Slide Clustering）

幻灯片按功能分为两类：
- **结构型幻灯片（structural slides）**：支撑演示文稿组织的（如开场、目录、章节页、结尾）；
- **内容型幻灯片（content slides）**：传达具体信息的（如要点页）。

分类方法（论文 2.2 节）：
- **结构型**：用 LLM 的长上下文能力分析整份演示文稿的文本，识别结构型幻灯片、标注其结构角色（Opening / TOC / Section Outline / Ending）并按功能分组。对应 `induct.py` 的 `category_split()`（`induct.py:95-110`），使用 `prompts/category_split.txt`，输出 `functional_cluster`（类别 → 幻灯片索引列表）与 `content_slides_index`。
- **内容型**：把幻灯片转成图片，用 ViT 做分层聚类（hierarchical clustering）把相似版面聚到一起。对应 `layout_split()`（`induct.py:112-151`）：
  1. 用 ViT（`google/vit-base-patch16-224-in21k`）对模板图片提取 embedding（`get_image_embedding()`）；
  2. 按 `(layout_name, content_type)`（text/image）预分组；
  3. 组内两两计算余弦相似度（`images_cosine_similarity()`）；
  4. 用贪婪聚合聚类 `get_cluster()`（`model_utils.py:291-345`）聚类，相似度阈值 `sim_bound=0.65`（论文 Algorithm 1）——聚类前把文本替换为占位符 "a"、图片替换为纯色背景以只关注版面；
  5. 每簇选 shape 最多的幻灯片作为模板幻灯片；
  6. 用视觉模型（`ASK_CATEGORY_PROMPT`）生成一行版面模式描述（如 "One Large Left-Aligned Image with a Right-Aligned Text Block"），并追加 `:text` 或 `:image` 后缀。

#### Step 2：Schema 提取（Schema Extraction）

对每个版面，取其模板幻灯片，提取所有段落文本与图片描述，调用 `schema_extractor` 智能体生成结构化 JSON schema（`content_induct()`，`induct.py:175-208`）。每个元素用 `(category, description, content)` 表示，例如：

```
Category   Description              Data
Title      Main title               Sample Library
Date       Date of the event        15 February 2018
Image      Primary image to          Picture: Children in a li-
           illustrate the slide     brary with ...
```

对应数据模型：`pptagent/presentation/layout.py` 中的 `Element`（name/data/type/suggested_characters/variable_length）与 `Layout`。Stage I 的最终产物是 `slide_induction.json`（见 `scripts/template_induct.py` 与 `templates/*/slide_induction.json`），包含每个版式的 elements、template_id、slides、functional_keys 与语言检测结果。

### 2.3 Stage II：Presentation Generation（演示文稿生成）

对应代码：`pptagent/pptgen.py`（`PPTGen` 抽象基类与 `PPTAgent` 具体实现）。

#### Step 1：大纲生成（Outline Generation）

用 LLM 生成结构化大纲（`generate_outline()`，`pptgen.py:239-256`），每个条目对应一张新幻灯片，包含：**参考幻灯片（基于 Stage I 的功能描述选择）+ 该幻灯片相关的文档内容**。大纲以结构化输出（`Outline.response_model(source_doc)`，见 `response/outline.py`）生成。

随后 `_add_functional_layouts()`（`pptgen.py:267-318`）自动插入结构型幻灯片：
- TOC（目录）与 Opening（开场）插在位置 0；
- Ending（结尾）插在最后；
- 每个新主题章节前插入 Section Outline（章节页）；
- 用 `edit_distance` 模糊匹配参考稿中对应的功能版式名。

#### Step 2：幻灯片生成（Slide Generation）——编辑式流水线

`generate_slide()`（`pptgen.py:392-432`）对大纲中的每个条目执行：

1. **选择版面** `_select_layout()`（`pptgen.py:434-467`）：先用 `content_organizer` 从检索内容中提取关键点，再由 `layout_selector` 根据内容与图片匹配情况选择最佳版式（`LayoutChoice.response_model(layouts)` 结构化输出），文本内容选 `:text` 版式、含图片的选 `:image` 版式。

2. **生成内容** `_generate_content()`（`pptgen.py:469-491`）：`editor` 智能体按照 schema 生成结构化内容（`EditorOutput.response_model(elements)`），再经 `_validate_content()`（`pptgen.py:531-571`）校验（图片是否存在、字符数是否超限，超长文本用 `length_rewrite()` 改写），最后 `_generate_commands()`（`pptgen.py:573-589`）把内容差异转成命令序列：对每个元素计算 `quantity_change = len(new) - len(old)`，产出 `(element_name, type, quantity_change, old_data, new_data)` 命令元组。

3. **编辑幻灯片** `_edit_slide()`（`pptgen.py:493-529`）：这是**自校正 REPL 循环**——
   - `coder` 智能体依据 API 文档（`CodeExecutor.get_apis_docs()` 内省 API 签名生成）与模板幻灯片的 HTML 表示，把命令翻译成 API 调用序列；
   - `CodeExecutor.execute_actions()`（`apis.py:127-203`）用 `eval(line, SAFE_EVAL_GLOBALS, ...)` 逐行执行 API 调用（`replace_paragraph`、`replace_image`、`del_paragraph`、`del_image`、`clone_paragraph`），出错则返回 `(api_lines, traceback)` 作为反馈；
   - LLM 分析反馈修正动作，最多重试 `retry_times`（默认 3）次，直到生成有效幻灯片。

#### 编辑 API 与 HTML 渲染（CodeRender）

论文的关键设计之一：**把参考幻灯片渲染成 HTML 表示**（`SlidePage.to_html()`，`presentation.py:193-216`），比直接操作 PPTX 的 XML（1006 行冗长冗余，见论文 Figure 11）更精确直观，让 LLM 能理解元素结构并精确修改。

五个编辑 API（`pptagent/apis.py`）：

| API | 说明 | 实现位置 |
|---|---|---|
| `replace_paragraph` | 替换段落内容（markdown→HTML→TextBlock 富文本解析） | `apis.py:403-438` |
| `replace_image` | 替换图片资源（等比缩放居中，表格图片转真表格） | `apis.py:441-473` |
| `del_paragraph` | 删除段落 | `apis.py:357-384` |
| `del_image` | 删除图片元素 | `apis.py:387-400` |
| `clone_paragraph` | 复制段落（插入 XML 到末段之后） | `apis.py:476-512` |

**Closure 模式**：编辑动作不直接应用到 PPTX，而是修改 `SlidePage` 表示并排队 `Closure` 对象（`shapes.py:218-246`），`SlidePage.build()` 时按 CLONE → REPLACE/STYLE → DELETE/POST_PROCESS → MERGE 的顺序执行（`shapes.py:622-642`）。这保证了删除段落时索引处理的正确性。

### 2.4 PPTEval 评测框架

对应代码：`pptagent/ppteval/ppteval.py` 与 `pptagent/prompts/ppteval/*.txt`。

PPTEval 采用 **MLLM-as-a-judge** 范式，评估三个维度（1-5 分制）：

| 维度 | 评分标准 | 评测对象 | Prompt |
|---|---|---|---|
| **Content** | 文本简洁、语法正确、有相关图片支撑 | 幻灯片级（逐页） | `ppteval_content.txt` |
| **Design** | 配色和谐、版面可读、视觉元素（几何形状等）提升吸引力 | 幻灯片级（逐页） | `ppteval_style.txt` |
| **Coherence** | 结构递进、包含必要的背景信息 | 整个演示文稿级 | `ppteval_coherence.txt` |

评测流程（`ppteval.py`）：
1. `eval_slide()`（`ppteval.py:54-82`）：对每张幻灯片图片，先用**视觉模型**生成内容描述（`content_descriptor`）与风格描述（`style_descriptor`），再用**文本模型**分别对描述评分（`text_scorer` / `vision_scorer`）。这种"**感知（VLM）与判断（LLM）分离**"的设计是 PPTEval 的关键。
2. `eval_coherence()`（`ppteval.py:85-108`）：提取整份演示文稿文本，先用 `ppt_extractor` 抽取幻灯片描述与背景元数据，再用 `logic_scorer` 评一致性。
3. 聚合：Content/Design 取所有幻灯片的平均分，Coherence 为整体分。

**与人类评分的一致性**（论文 5.5 节）：招募 4 名研究生评 250 份演示文稿（50 份真实 + 200 份生成），Fleiss' Kappa 平均 0.59；Pearson 相关 0.71、Spearman 相关 0.74，显著优于其他评测方法。

**与传统指标对比**（论文 Figure 7 热力图）：PPL 与 FID 与 Content/Design 几乎不相关（-0.02/-0.09），说明传统指标（PPL、ROUGE-L、FID）无法评估演示文稿质量——KCTV 拿到高 ROUGE-L（16.76）但低 Content（2.55），PPTAgent 则相反。

### 2.5 实验结果与消融

主结果（论文 Table 3，Qwen2.5_LM + Qwen2-VL_VM 配置）：

| 方法 | SR(%) | Content | Design | Coherence | Avg |
|---|---|---|---|---|---|
| DocPres（规则） | – | 2.98 | 2.37 | 3.28 | 2.87 |
| KCTV（模板） | 88.0 | 2.55 | 2.95 | 3.36 | 2.95 |
| **PPTAgent** | **95.0** | **3.28** | **3.27** | **4.48** | **3.67** |

消融（论文 Table 4）说明四个组件的贡献：
- **w/o CodeRender**（用 Guo et al. 的表示替换 HTML 渲染）：SR 从 95.0% 掉到 74.6% —— HTML 渲染显著降低交互复杂度；
- **w/o Schema**（去掉 schema 引导）：SR 从 95.0% 掉到 78.8% —— schema 对生成鲁棒性关键；
- **w/o Outline / w/o Structure**：Coherence 从 4.48 掉到 3.36/3.45 —— 大纲与结构型幻灯片分析对连贯性至关重要；
- 自校正机制（论文 Figure 6）：所有模型都能修正超过一半的错误，GPT-4o 自校正能力最强。

---

## 3. DeepPresenter：环境接地反思的双智能体框架

### 3.1 动机与核心贡献

DeepPresenter 指出现有演示文稿智能体的两个根本缺陷：

1. **依赖预定义工作流与固定模板**（如 PPTAgent 的编辑式流程、KCTV 的模板填充），无法适应多样化的用户意图，产出文本密集、研究深度不足、视觉设计与叙事脱节的幻灯片；
2. **内省式反思（introspective self-reflection）失效**：智能体操作的是中间表示（HTML/markdown），而用户感知的是**渲染后的产物**。很多缺陷（图片断裂、元素溢出、低对比度）只在感知状态（渲染后的幻灯片）中显现，内省反思无法察觉。

三大贡献：
1. **DeepPresenter**：通过共享观察空间协调两个专职智能体（Researcher + Presenter）的智能体框架；
2. **环境接地反思（Environment-Grounded Reflection）**：把自校正建立在渲染后产物的感知状态上，而非内部信号上；
3. **DeepPresenter-9B**：用"外在验证（extrinsic verification）"合成的轨迹进行监督微调，小模型以极低代价接近大模型性能。

### 3.2 任务形式化

把演示文稿生成形式化为**交互式智能体任务**：给定指令 I 与配备工具库 T 和文件系统 F 的智能体环境 E，生成高质量演示文稿 P。生成过程是多步轨迹：

```
τ = {(r1, a1, o1), ..., (rT, aT, oT)}
```

每步：智能体生成推理轨迹 r_t，选择动作 a_t ∈ T，从 E 收到观察 o_t。轨迹分解为两个连续阶段：

```
τ = τ_R ∘ τ_P
```

- τ_R：Researcher 轨迹；
- τ_P：Presenter 轨迹。

两个智能体通过 F 通信：Researcher 把结构化文稿 M 和相关资产持久化到文件系统，Presenter 消费它们。

### 3.3 双智能体协作：Researcher + Presenter

**Researcher Agent**（对应 `deeppresenter/agents/research.py` + `roles/Research.yaml`）：
- 不遵循预定义工作流，而是**自主规划探索**：执行多步检索（`search_web`、`search_images`、`search_papers`、`fetch_url`）、文档解析（`convert_to_markdown`）、必要时创建辅助资产（`image_generation`、matplotlib 绘图）；
- 探索深度与策略**适配用户意图**：技术性演讲需要调研相关工作，大众向演讲更重可理解的例子与生动插图；
- 最终把内容组织成按叙事流排布的结构化 Markdown 文稿 M（用 `---` 分页，图片本地化并相对路径引用），持久化到 F；
- 通过 `inspect_manuscript` 获取文稿诊断（页数、语言、图片资源可用性），最后调用 `finalize` 返回文稿路径。

**Presenter Agent**（对应 `deeppresenter/agents/design.py` + `roles/Design.yaml`）：
- 不填充预定义模板，而是**从零生成幻灯片**；
- 先制定全局设计计划（`designplan`：配色、字体、网格系统、字号规范），建立与主题共鸣的视觉基调（可持续主题用大地色系、学术教程用极简布局）；
- 把每张幻灯片生成为独立的 HTML 文件（`slides/slide_01.html`、`slide_02.html`...），遵循设计计划把文稿内容翻译成视觉元素；
- 每张幻灯片生成后调用 `inspect_slide`（渲染成像素图片）观察后渲染缺陷（溢出、重叠、低对比度），用 `thinking`（模型原生推理）规划针对性修改，然后 `edit` 修复；
- 全部完成后 `finalize` 返回幻灯片目录。

**多智能体并行扩展**（`main.py` 中 `multiagent_mode`）：父智能体可通过 `delegate_subagent` 本地工具把长文档/多主题调研、>=3 张幻灯片的批量生成**并行委派**给隔离工作区中的 SubAgent 实例（`agents/subagent.py`，max_turns=10），结果通过文件 + `finalize` 回传。论文 Figure 8(a) 的工具使用分析证实了角色分工：Researcher 大量使用 Retrieve 类工具（26.8%），Presenter 大量使用 File（40%）与 Reason（19.3%）类工具。

### 3.4 环境接地反思（Environment-Grounded Reflection）

这是 DeepPresenter 最核心的方法论创新（论文 Figure 2 对比）：

| | 自反思（Self-Reflection） | 环境接地反思（Env-Grounded Reflection） |
|---|---|---|
| 触发 | 不确定性（Uncertain ❓） | `inspect` 工具调用 |
| 输入 | 内部信号（无外部观察） | 渲染后的幻灯片图像 / 文稿诊断 |
| 缺陷 | 发现不了后渲染缺陷（溢出、重叠、低对比度、断裂图片） | 能发现 |

实现上是 **`inspect` 工具**作为显式的观察接口（`deeppresenter/tools/reflect.py`）：

- **`inspect_slide(html_file, aspect_ratio)`**（`reflect.py:28-62`）：用 Node 管道（html2pptx）校验 HTML 合法性；若 `REFLECTIVE_DESIGN`（`design_agent` 是多模态且 `heavy_reflect`）开启，还用 Playwright 把 HTML 渲染为 PDF→JPEG，以 `ImageContent`（base64 JPEG）返回给多模态设计智能体，使其**真正"看到"渲染后的幻灯片**；
- **`inspect_manuscript(md_file)`**（`reflect.py:66-117`）：解析 Markdown 文稿，统计页数、用 fastText LID 模型检测语言、校验所有图片引用（标记外链、缺失文件、缺失 alt 文本、重复使用），返回结构化诊断。

由此形成 **observe（观察）→ reflect（反思）→ revise（修正）** 闭环，观察结果与用户感知一致。

论文中的 `think` 工具并非一个注册的 MCP 工具，而是通过：
1. 模型原生的 reasoning 字段（`ChatMessage.reasoning`，`agent.py:183-186` 保留）；
2. Agent Harness 本身的 think-act-observe 循环结构实现。

### 3.5 数据合成与轨迹蒸馏（DeepPresenter-9B）

为了在推理时降低闭源模型的高成本，DeepPresenter 训练了紧凑模型 DeepPresenter-9B。训练管线（论文 Figure 3）三步：

**Step 1：任务构建（Query Construction）**
从 PersonaHub、arXiv、FinePDFs-Edu 三来源构建 1,152 个任务（1,024 训练 + 128 评测）。每个任务附加**可验证约束**（页数、语言、宽高比），如："I'm an English teacher... Please create a 14-slide presentation in 4:3 aspect ratio, with all content in Chinese."（统计见论文 Table 1：中英各半、三来源各半、自由/受限宽高比混合）。

**Step 2：验证引导的轨迹合成（Verification-Guided Trajectory Synthesis）**
关键问题：**自验证偏差（self-verification bias）**——智能体在自己产生的轨迹状态内评判自己的输出，验证与自我合理化纠缠，导致有缺陷的输出被接受。
解决方案：**外在验证（extrinsic verification）**——在隔离上下文中产生验证信号。智能体调用 `inspect` 得到观察 o_t 后，**独立的 critic 模型**（论文用 Gemini-3-Pro，`PPTea-main/sarl/coldstart/process_oversight.py` 实现）基于 o_t 与中间产物做验证，输出识别缺陷（如低对比度）并给出可操作修改建议（如调整文字颜色）的推理轨迹，作为 `think` 调用注入智能体上下文，引导其修正后继续 rollout。
论文 Figure 4 显示外在验证在各类缺陷（尤其是版面 layout 308 vs 212、渲染 render 101 vs 43）上检出数量远超自验证，说明自验证系统性漏检。

**Step 3：轨迹过滤（Trajectory Filtering）**
三级过滤（`PPTea-main/sarl/evaluation/` 中的评分 + `trajectory_collect.py` 的阈值）：
1. 规则验证约束符合度（页数/宽高比/语言）；
2. 用 GLM-4.6 评估一致性，删除未按外在验证轨迹做对齐修改的（反思-动作不一致）轨迹；
3. 用 GLM-4.6V 评估输出质量，过滤有关键缺陷（元素重叠、图片断裂）的轨迹。

最终 802 条轨迹通过过滤，在 GLM-4.6V-Flash 上用 MS-SWIFT 微调（batch 32、lr 1e-5、5 epochs、8×A800 约 80 GPU 小时），得到 DeepPresenter-9B。

论文 Figure 5 展示过滤前的失败分布：质量错误 43.0%（自由式生成难保质量）、环境错误 32.3%（长时程脆弱性：上下文溢出与基础设施故障）、约束违规 13.5%、一致性错误 11.2%。

### 3.6 实验结果

评测协议：128 个 held-out 任务，四个维度：

| 维度 | 方法 |
|---|---|
| **Constraint** | 规则验证：约束满足比例（页数/语言/宽高比），0-5 分 |
| **Content & Style** | 沿用 Zheng et al. (2025) 的 MLLM 评测框架，GPT-5 为 judge，0-5 分 |
| **Diversity** | DINOv2 特征 + Vendi Score（特征相似矩阵的特征值熵），0-1 |

主结果（论文 Table 2）：

| 框架 | 模型 | Constraint | Content | Style | Avg | Diversity |
|---|---|---|---|---|---|---|
| Gamma（商业） | – | 4.93 | 4.08 | 4.08 | 4.36 | 0.52 |
| PPTAgent | Gemini-3-Pro | 4.22 | 3.09 | 4.30 | 3.87 | 0.19 |
| KCTV | Claude-Sonnet-4.5 | 4.88 | 2.90 | 3.99 | 3.92 | 0.20 |
| **DeepPresenter** | **Gemini-3-Pro** | **4.70** | **4.25** | **4.37** | **4.44** | **0.79** |
| **DeepPresenter-9B** | 微调 | 4.77 | 3.52 | 4.29 | 4.19 | 0.53 |

要点：
- DeepPresenter + Gemini-3-Pro 达到 SOTA（4.44），超过商业系统 Gamma（4.36）与所有开源基线；
- Content 提升最大：Researcher 做意图自适应检索与综合，而非依赖固定工作流或用户提供材料；
- Style 提升来自内容感知设计与环境接地反思；
- **Diversity 0.79 是模板方法的 2 倍以上**（0.17-0.35），自由式生成带来视觉多样性；
- DeepPresenter-9B 以 802 条轨迹达到 4.19，超过所有开源基线，接近 GPT-5（4.22）而成本低得多（论文 Figure 6 的帕累托前沿）。

消融（论文 Table 3，Gemini-3-Pro）：
- w/o Grounded Reflection：4.44 → 4.32（关闭 inspect 后反思局限在渲染前产物）；
- w/o Dual-Agent：4.44 → 4.04（双智能体把长时程执行分解为专业化子任务贡献显著）；
- 训练策略：w/o Trajectory Filtering 使 DeepPresenter-9B 从 4.19 → 4.03；extrinsic verification 带来比纯微调高 67% 的提升（Table 4：+0.20 vs +0.12）。

人类评估（附录 A.1，2 名研究生评 32 份）：DeepPresenter 4.22 vs PPTAgent 3.46 / KCTV 3.48 / Gamma 4.09，相对排序与自动评测一致。

---

## 4. 代码架构总览：两条代码路径

```
PPTAgent/  （仓库根目录）
├── deeppresenter/          ← 当前主产品面（Agentic 运行时）
│   ├── main.py             ← AgentLoop 编排入口
│   ├── agents/             ← 智能体（agent.py 基类 + research/design/pptagent/planner/subagent）
│   ├── tools/              ← MCP 工具服务器（search/any2markdown/reflect/task/tool_agents）
│   ├── roles/              ← 角色定义（Research.yaml/Design.yaml/PPTAgent.yaml/Planner.yaml/SubAgent.yaml）
│   ├── utils/              ← 配置/常量/日志/webview/mineru/mcp_client
│   ├── html2pptx/          ← Node.js HTML→PPTX 转换管道
│   ├── cli/                ← Typer CLI（onboard/generate/serve/config/clean）
│   └── docker/             ← 沙箱 Docker 镜像与本地运行脚本
│
├── pptagent/               ← 旧版核心库（PPTAgent 论文的生成+评测）
│   ├── pptgen.py           ← Stage II 生成流水线（PPTGen/PPTAgent）
│   ├── induct.py           ← Stage I 版面归纳（SlideInducter）
│   ├── apis.py             ← 编辑 API 与 CodeExecutor
│   ├── agent.py            ← 通用 LLM 智能体（YAML 角色 + Jinja2）
│   ├── presentation/       ← PPTX 解析/HTML 渲染/Closure 构建
│   ├── document/           ← 文档解析（markdown→Document）
│   ├── ppteval/            ← PPTEval 评测框架
│   ├── roles/ prompts/     ← 角色与提示词模板
│   ├── mcp_server.py       ← pptagent-mcp（模板式幻灯片生成 MCP server）
│   └── templates/          ← 预处理的参考模板（beamer/cip/default/hit/thu/ucas）
│
└── PPTea-main/             ← 评测/蒸馏实验基础设施（独立仓库，deeppresenter 是软链接）
    └── sarl/
        ├── evaluation/     ← 各框架生成适配器 + 两阶段评分管线
        ├── coldstart/      ← SFT 轨迹收集与蒸馏训练
        ├── dataset/        ← 数据集构建（typings.py 数据模型）
        └── analysis/       ← 论文图表（帕累托/工具使用/缺陷分布）
```

---

## 5. Agent Harness 主循环详解

**Agent Harness**（`deeppresenter/agents/agent.py`，462 行）是整个 DeepPresenter 的核心：一个通用的 **think → act → observe** ReAct 式工具调用循环，所有具体智能体（Research/Design/PPTAgent/Planner/SubAgent）都复用这个基类。

### 5.1 通用智能体基类 Agent

**初始化**（`agent.py:57-136`）：
1. 从 `roles/<ClassName>.yaml` 加载角色配置（`RoleConfig`）：system prompt（分语言）、Jinja2 instruction 模板、`use_model`（用哪个 LLM 字段）、`ToolSet`（包含/排除哪些 MCP server 与工具）；
2. `self.llm = config[role_config.use_model]`（research_agent / design_agent / long_context_model）；
3. 记录 `context_window`（默认 40k = CONTEXT_LENGTH_LIMIT 200k / max_context_folds 5）、`max_context_turns`（5）、`max_turns`（可选上限）；
4. `_setup_toolset()`（`agent.py:138-155`）从 `agent_env` 解析工具列表（`"all"` 展开为所有已连接 server，再减排除项），生成 OpenAI function-tool 字典列表；
5. **拼接系统提示词**：角色 system prompt + `AGENT_PROMPT`（环境描述与工具调用规则：充分探索、并行工具调用、每轮最多 7 个工具、截断策略）+ `MA_RESEACHER_PROMPT`/`MA_RRESENTER_PROMPT`（多智能体委派指南）+ `OFFLINE_PROMPT`（离线模式）+ `CONTEXT_MODE_PROMPT`（上下文折叠模式）；
6. 初始化 `chat_history = [SYSTEM 消息]`。

### 5.2 action：LLM 思考与工具调用生成

**`action()`**（`agent.py:191-240`）——每一轮循环的 LLM 步骤：
1. 递增 `turn_count`，执行 `max_turns` 上限（剩余 <2 轮时注入 "finish now" 提示）；
2. 首次调用时把渲染好的 Jinja2 instruction 作为 USER 消息追加；
3. 调用 `self.llm.run(messages=self.chat_history, tools=self.tools)` —— **OpenAI 原生 function calling**；
4. 记录 token 用量到 `self.cost` 与 `self.context_length`；
5. 把 assistant 消息（content + tool_calls + 可选的 reasoning）追加到历史并返回。

### 5.3 execute：工具执行与观察收集

**`execute()`**（`agent.py:250-348`）——每一轮循环的动作步骤：
1. 取出 assistant 消息的 `tool_calls`，用 JSON schema 校验参数，强制 `MAX_TOOLCALL_PER_TURN`（默认 7）；
2. 检测特殊工具 **`finalize`**：暂存其 `outcome` 参数与 `finish_id`，并注入 `agent_name`；
3. **并行执行所有工具**：`asyncio.gather(self.agent_env.tool_execute(t)...)`（`agent.py:292`）；
4. 观察归一化：含图片的结果按模型类型格式化（Gemini/Qwen 转 `role=USER`，Claude 转 `image`+`source.base64`）；
5. 观察追加到 `chat_history`，错误记录到 `error_history`；
6. 若 `finalize` 被调用且其观察文本等于 outcome，**返回 outcome 字符串（表示循环完成）**；
7. **上下文预算告警**（`agent.py:325-336`）：context 超 50% 注入 `HALF_BUDGET_NOTICE_MSG`，超 80% 注入 `URGENT_BUDGET_NOTICE_MSG`；
8. **上下文溢出处理**（`agent.py:341-347`）：`context_length > context_window` 时，若启用折叠则 `compact_history()`，否则抛 RuntimeError；
9. 返回 outcome 字符串或观察 ChatMessage 列表。

### 5.4 上下文管理与 compact_history

**`compact_history()`**（`agent.py:356-401`）——防止上下文溢出的核心机制：
1. 保留 `keep_head=10` + `keep_tail=4` 条消息，中间的折叠；
2. 先保存完整历史（`message_only=True`）；
3. 用 `MEMORY_COMPACT_MSG`（`constants.py:154-184` 的详细摘要指令）配合 `self.chat_history + [summary_ask]` 请求 LLM 总结；
4. LLM 的摘要消息（可能含 tool_calls）被执行；追加 `CONTINUE_MSG`（最后折叠时 `LAST_ITER_MSG`）；
5. 重构历史为 `head + tail + [summary_ask, summary_message, *observations]`；
6. 受 `max_context_turns`（5 次折叠）限制。

配套的 `_split_history()`（`agent.py:403-421`）保证 tool-call/tool-result 消息配对保持在 head 中，用 `HIST_LOST_MSG` 标记截断点。

### 5.5 loop：各智能体的主循环

**`loop()`**（`agent.py:242-249`）是抽象异步生成器，所有具体智能体实现它，但模式相同：

```python
while True:
    agent_message = await self.action(**kwargs)   # 思考 + 生成工具调用
    yield agent_message                           # 流式输出进度
    outcome = await self.execute(self.chat_history[-1].tool_calls)  # 行动 + 观察
    if isinstance(outcome, list):
        for item in outcome:
            yield item                            # 流式输出观察
    else:
        yield outcome
        break                                     # finalize → 循环结束
```

这是标准的 **ReAct 式 harness**：action（LLM）→ execute（工具）→ 观察 → 重复直到 `finalize`。

各具体智能体的 loop：
- **Research**（`research.py:8-24`）：`loop(req, outline_path)` 跑通用循环，action 注入 deepresearch prompt + 附件 + 大纲路径；最终 finalize 返回 `.md` 文稿路径；
- **Design**（`design.py:5-20`）：`loop(req, markdown_file)` 创建 `slides/` 目录跑循环，`while True` 收到字符串 outcome 后跳出再 yield 一次（HTML 目录）；逐页 write + inspect_slide + 修复；
- **PPTAgent**（`pptagent.py:5-29`）：`loop(req, markdown_file)` 通过 `pptagent` MCP 工具（list_templates/set_template/create_slide/write_slide/generate_slide）做模板式生成；
- **Planner**（`planner.py:8-48`）：两阶段生成器——阶段 1 跑循环产出 outline JSON 路径；阶段 2 是**交互式修订循环**（`feedback = yield outcome`，CLI 通过 `.asend(feedback)` 推送修订指令，非空则追加为 USER 消息重新跑循环）；
- **SubAgent**（`subagent.py:46-51`）：通用循环，从 Context 文件读委派任务，产出 deliverable 文件后 finalize。

---

## 6. Agent Harness 框架架构：模块与角色

### 6.1 编排层 AgentLoop（main.py）

`deeppresenter/main.py`（233 行）是顶层编排入口，`AgentLoop.run()` 是 async generator，逐步 yield 进度 `ChatMessage` 与最终产物路径。管线如下：

```
AgentLoop.run()
├── 1. 设置阶段（main.py:58-84）
│   ├── 可选校验 LLM
│   ├── 附件复制到 workspace/attachments/（request.copy_to_workspace）
│   ├── 写入 .input_request.json
│   ├── 打开 AgentEnv 异步上下文
│   └── [multiagent_mode] 注册 delegate_subagent 本地工具
│
├── 2. 可选 Planner 阶段（main.py:87-110）
│   └── planner.loop(request) → outline JSON（可交互修订）
│
├── 3. Research 阶段（main.py:112-139）
│   └── research_agent.loop(request, outline_path) → manuscript.md
│
├── 4. 生成阶段，按 convert_type 分支（main.py:141-221）
│   ├── PPTAGENT：PPTAgent.loop(request, md_file) → .pptx
│   └── DEEPPRESENTER：Design.loop(request, md_file) → slides/*.html
│       └── 导出：convert_html_to_pptx()（Node html2pptx）
│           └── 失败回退：PlaywrightConverter.convert_to_pdf → .pdf
│
└── 5. 收尾（main.py:222-224）
    └── save_results() 写 intermediate_output.json（outline/manuscript/pptx/final 路径）
```

每个子阶段都 `save_history()` / `save_results()`（在 `finally` 中），日志写到 `workspace/.history/deeppresenter-loop.log`。

### 6.2 环境层 AgentEnv 与工具执行（env.py）

`deeppresenter/agents/env.py`（454 行）管理 MCP server、工具注册、沙箱与异步工具执行：

- **`__init__`**（`env.py:54-109`）：加载 `mcp.json` 的 `MCPServer` 定义（离线模式跳过 network server），计算 docker-in-docker 的 `HOST_WORKSPACE` 卷映射，构建 `envs` 字典（WORKSPACE/HOST_WORKSPACE/WORKSPACE_ID/CONFIG_FILE/PACKAGE_DIR...）传给 MCPClient，避免全局环境变量污染；注册工具注册表（`_local_tools`/`_tools_dict`/`_server_tools`/`_tool_to_server`）；`async_tool_mode` 开启时注册 `gather` 工具；
- **`__aenter__`**（`env.py:228-266`）：清理同名陈旧 docker 容器，并行连接所有 MCP server，缓存全部工具规格到 `.tools.json`；
- **`__aexit__`**（`env.py:268-300`）：断开 server，写 `tool_history.jsonl` 与 `tools_time_cost.json`（工具调用的完整审计日志）；
- **`register_tool`**（`env.py:347-372`）：把 Python 可调用对象注册为本地工具（用 FastMCP 的 typeadapter 从类型注解自动生成 JSON schema），用于 `delegate_subagent` 与 `gather`；
- **`tool_execute`**（`env.py:111-226`）：统一工具执行路径——jsonschema 校验参数 → `_execute_tool` → 包装成 `ChatMessage(role=TOOL)`。**结果截断**（`env.py:186-203`）：文本超 `TOOL_CUTOFF_LEN`（4096 字符）在最后一个换行截断并附 `CUTOFF_WARNING`，全文保存到本地文件供 `read_file` 按偏移读取；图片结果转 `image_url` 块。记录每个工具耗时/成功/失败；
- **`_execute_tool`**（`env.py:403-423`）异步工具模式：非白名单工具（gather/finalize/inspect_slide 除外）限时 5 秒，超时返回占位符并后台继续，智能体之后用 `gather` 收集结果——这允许智能体**并行执行多个长时程任务**。

工具调用路径：LLM 原生 function calling → `Agent.execute` → `agent_env.tool_execute` → 本地 Python 可调用 或 `MCPClient.session.call_tool`（`utils/mcp_client.py`，stdio/SSE 子进程连接，`MCP_CALL_TIMEOUT` 默认 1800 秒）。

### 6.3 MCP 工具服务器（tools/）

每个文件是独立的 FastMCP server（按 `mcp.json` 以子进程启动），提供以下工具：

| Server | 类别 | 工具 | 说明 |
|---|---|---|---|
| `Search`（`search.py`） | Retrieve | `search_web` / `search_images` / `fetch_url` / `download_file` | SerpAPI 优先、Tavily 备选；Playwright 渲染网页 + trafilatura/markdownify 提取；图片下载校验（WEBP→PNG） |
| `Any2Markdown`（`any2markdown.py`） | File | `convert_to_markdown` | PDF/DOCX 转 Markdown：MinerU（在线 API 或离线部署）或 MarkItDown；base64 图片落盘、链接改绝对路径、报告图片尺寸 |
| `DeepPresenter`（`reflect.py`） | **Reason** | **`inspect_slide`** / **`inspect_manuscript`** | 环境接地反思的两个观察接口（见 3.4 节） |
| `Task`（`task.py`） | **Control** | **`finalize`** | 循环终止工具，按智能体类型做最终校验（Planner 要 .json；Research 要 .md 并重写图片绝对路径+注入宽高比到 alt；PPTAgent 要有效 .pptx；Design 要 slide_*.html 目录） |
| `ToolAgents`（`tool_agents.py`） | Create/Reason | `image_generation` / `image_caption` / `document_summary` | 条件注册：配置了 t2i_model 才提供文生图；vision_model 提供图片分类+描述（Table/Chart/Logo + <50 词）；multiagent 模式提供长文档摘要 |
| `pptagent`（`pptagent/mcp_server.py`） | 模板生成 | `list_templates` / `set_template` / `create_slide` / `write_slide` / `generate_slide` / `markdown_table_to_image` / `save_generated_slides` | 旧版模板式生成，仅供 PPTAgent 智能体 |
| `sandbox`（`docker/server.ts`） | File | `read_file` / `write_file` / `move_file` / `edit_file` / `create_directory` / `list_directory` / `execute_command` | DesktopCommanderMCP 沙箱（Docker 或本地 Node 进程），`execute_command` 使智能体成为"沙箱化代码智能体"（可跑 shell/python/node/渲染 mermaid），`docker/config.json` 屏蔽危险命令（format/mkfs/dd/useradd...） |

工具按论文 Table 8 分为五类：**Retrieve**（信息获取）、**File**（文档操作）、**Reason**（检查与反思）、**Control**（任务管理）、**Create**（代码执行与资产生成）。

### 6.4 角色定义（roles/）

每个角色是一个 YAML，定义 system prompt（中英）、Jinja2 instruction 模板、use_model 与 toolset：

| 角色文件 | 智能体 | 模型 | 工具集亮点 | 指令要点 |
|---|---|---|---|---|
| `Research.yaml` | Research | research_agent | 除 pptagent 外所有 server；排除 inspect_slide | 深度调研（广→窄）、信息美学、Markdown 文稿（`---` 分页、图片本地化）、inspect_manuscript、finalize 返回 .md |
| `Design.yaml` | Design | design_agent（多模态） | sandbox + delegate_subagent + inspect_slide + finalize | HTML/CSS 固定版式设计、global.css、逐页生成 + inspect_slide 质量检查、按宽高比固定 body 尺寸 |
| `PPTAgent.yaml` | PPTAgent | research_agent | pptagent + sandbox + finalize | 从 Markdown 做模板式生成、表格转图片、finalize 返回 .pptx |
| `Planner.yaml` | Planner | research_agent | 除 tool_agents/deeppresenter 外所有；排除 search_images | 设计 JSON 大纲 `{"slides":[{index,title,context}]}`、finalize 返回 .json |
| `SubAgent.yaml` | SubAgent | design_agent | 除 pptagent 外所有；排除 delegate_subagent（禁递归） | 从 Context 文件完成单个委派子任务、产出自包含 deliverable、finalize |

附加动态提示词片段（`utils/constants.py`）：`AGENT_PROMPT`（环境描述+工具调用规则）、`MA_RESEACHER_PROMPT`/`MA_RRESENTER_PROMPT`（多智能体并行委派指南）、`OFFLINE_PROMPT`、`CONTEXT_MODE_PROMPT`、上下文预算告警与 `MEMORY_COMPACT_MSG`。

### 6.5 配置与常量（utils/）

- **`utils/config.py`**：`Endpoint`（单端点，路由 litellm 或 AsyncOpenAI，支持 tool-calling/结构化输出/纯对话）、`LLM`（多端点交替重试 + 并发信号量 + 多模态自动检测 + `generate_image` + `validate()`）、`DeepPresenterConfig`（`multiagent_mode`/`offline_mode`/`async_tool_mode`/`context_folding`/`context_window`/`max_context_folds`/`heavy_reflect` + 三个 LLM 字段）；
- **`utils/typings.py`**：`Role`（SYSTEM/USER/ASSISTANT/TOOL）、`ChatMessage`（统一消息模型，content 归一为 `{type:text/image_url}` 块列表）、`ToolSet`/`RoleConfig`、`Cost`、`ConvertType`（DEEPPRESENTER/PPTAGENT）、`PowerPointType`（16:9/4:3/A1-A4）、`InputRequest`（instruction/attachments/num_pages/template/powerpoint_type/convert_type/enable_planner/extra_info，`copy_to_workspace` 复制附件）；
- **`utils/constants.py`**：全部可调常量（`WORKSPACE_BASE`、`TOOL_CUTOFF_LEN=4096`、`MAX_TOOLCALL_PER_TURN=7`、`MAX_SUBAGENT_TURNS=10`、`CONTEXT_LENGTH_LIMIT=200k`、`MCP_CALL_TIMEOUT=1800s`、`PIXEL_MULTIPLE=16`）；
- **`utils/webview.py`**：`PlaywrightConverter`（共享 headless Chromium，HTML→按宽高比分页 PDF→pdf2image 栅格化为 slide_NN.jpg）与 `convert_html_to_pptx`（调 Node `html2pptx_cli.js`）；
- **`utils/mineru_api.py`**：MinerU PDF 解析（在线 mineru.net API 或离线自部署端点）。

### 6.6 沙箱与 HTML→PPTX 转换

- **沙箱**：DesktopCommanderMCP 的 Docker 镜像（`docker/SandBox.Dockerfile`）或集群本地模式（`run_sandbox_local.sh`，SLURM 无 Docker 环境下用本地 Node 进程），提供通用代码执行能力；
- **HTML→PPTX**（`html2pptx/`）：Node CLI 用 pptxgenjs + 自定义 `html2pptx.js` 转换器，支持 16:9/4:3/A1-A4 布局、`--validate`/`--soft` 选项，依赖 playwright 与 sharp；
- **配置示例**：`config.yaml.example`（LLM 块 + 模式开关）、`mcp.json.example`（7 个 MCP server，`$VAR` 占位符由 `MCPServer._process_escape` 从 AgentEnv.envs 解析）。

### 6.7 完整端到端流程图

```
pptagent generate "主题" -f 附件.pdf --planner
  └─ CLI commands.generate → AgentLoop(config, request)
       └─ AgentLoop.run()
            ├─ AgentEnv.__aenter__：并行连接 7 个 MCP server，缓存工具规格
            ├─ [enable_planner] Planner.loop：action/execute 循环 → outline.json → finalize
            │     └─ CLI 交互式修订（_edit_outline：Rich 表格展示，y 批准或自然语言修订）
            ├─ Research.loop：action → [search_web, fetch_url, convert_to_markdown,
            │     image_generation...] → execute（并行、4096 字符截断）→ 观察
            │     → inspect_manuscript → finalize(manuscript.md)
            │     [context >40k 触发 compact_history 摘要折叠]
            ├─ convert_type 分支：
            │   ├─ PPTAGENT：PPTAgent.loop → list_templates → set_template
            │   │     → create_slide → write_slide → generate_slide → finalize(.pptx)
            │   └─ DEEPPRESENTER：Design.loop
            │         → read manuscript → write global.css
            │         → [逐页] write slide_NN.html → inspect_slide（渲染+校验；
            │            heavy_reflect 时多模态智能体"看到"渲染 JPEG 并修复）
            │         → finalize(slides/)  [多智能体：delegate_subagent 并行生成]
            └─ 导出：convert_html_to_pptx(slides/, out.pptx, 宽高比, soft)
                  └─ node html2pptx_cli.js → pptxgenjs → .pptx
                  [失败回退：PlaywrightConverter.convert_to_pdf → .pdf]
```

---

## 7. PPTea-main：评测与蒸馏实验基础设施

### 7.1 PPTea-main 是什么

**PPTea-main 不是独立产品，而是 DeepPresenter 项目的实验/评测/蒸馏基础设施**：
- `deeppresenter/` 是指向 `../PPTAgent/deeppresenter` 的**软链接**；
- `sarl/` 包（0.1.0，docstring "SARL Package"）大量 import `deeppresenter.*` 与 `pptagent.*`；
- 它实现了 project-demand.md 描述的完整闭环：**各 Agent Harness 生成 → Workspace 对齐 → PPTEval 评分 → 分析 → 轨迹蒸馏**。

### 7.2 评测流程（两阶段评分管线）

`PPTea-main/sarl/evaluation/` 提供各竞争框架的**生成适配器**：

| 文件 | 框架 | 机制 |
|---|---|---|
| `deeppresenter_gen.py` | DeepPresenter | 调 `deeppresenter.main.AgentLoop.run()`，写 `.datapoint.json` 后立即 `score_workspace()` |
| `codex_gen.py` | Codex CLI（GPT-5） | `codex exec --sandbox danger-full-access` + `pptx-generator` Skill（`../Deeppresenter-skills/skills/pptx-generator`），`verify_workspace_ready()` 校验 PPTea 兼容别名 |
| `pptagent_gen.py` | PPTAgent（旧基线） | 包装 `pptagent.pptgen.PPTAgent`，模板归纳生成，soffice 转 PDF |
| `gamma.py` | Gamma（商业） | Gamma 公开 REST API，轮询完成后下载 PDF |
| `kctv.py` | KCTV（基线） | 两步 LLM：提取结构化 JSON → LaTeX，xelatex 渲染 PDF |

**Phase 1 —— Content & Style 评分**（`score_exp.py` → `score_workspace()`）：
1. 读 `.datapoint.json` 与 `intermediate_output.json` 找最终 PDF；
2. 定位幻灯片图片目录 `.slide_images-pdf-{stem}/slide_XX.jpg`（**所有框架的评测输入统一归一化为这个格式**）；
3. 校验 PPTea 文稿别名 `.slides.md`（必须等于 `manuscript.md`）；
4. **确定性约束检查**：`dp.verify()` 用 PyPDF 查页数、mediabox 查宽高比、fasttext LID 查语言 → 0-1 分 ×5；
5. **逐页 VLM 评分**（8 并发，GPT-5 多模态 judge）：
   - `content_descriptor` 描述内容 → `text_scorer` 打 Content 分；
   - `style_descriptor` 描述风格 → `vision_scorer` 打 Style 分；
6. 写 `slide_evals.json`（逐页）与 `evals.json`（平均：constraint/content/style）。

**Phase 2 —— 约束 VLM 评测**（`score_exp_complex.py` → `score_workspace_constraints()`）：
1. 仅对通过 Phase 1 阈值的 workspace 运行（默认 min_content=3.5 / min_style=3.5 / min_constraint=1.0）；
2. 对 DataPoint 中的每个 `Constraint`（STYLE 类评估所有页，其余评估指定页），用 `prompt/judge_constraints.txt` VLM judge 判定 satisfied(1.0)/partially(0.5)/not(0.0)；
3. 写 `constraint_evals.json`，更新 `evals.json` 的 `constraint_vlm`。

**辅助评测设施**：
- `divesity.py`：DINOv2 特征 + Vendi Score 的幻灯片风格多样性指标（0-1）；
- `plot_score_dist.py`：分数分布直方图（确定过滤阈值）；
- `review_server.py`：FastAPI 人工审核面板（8080 端口，缩略图+分数网格、逐 workspace 审核、reasonable/partially/unreasonable 三档判定）；
- `finish_codex_benchmark.py`：Codex workspace 的确定性终结器（校验语义产物存在、重跑 pptxgen html validate/render + convert + package，验证 PPTea 别名；**明确拒绝合成内容**，只做确定性渲染/转换/打包）。

### 7.3 数据模型与 Workspace 对齐

核心数据模型（`sarl/dataset/typings.py`）：

```python
DataPoint:  # 一个评测任务
  prompt: str            # 用户指令
  language: "zh"|"en"
  source: "arXiv"|"finepdfs"|"personahub"|...
  aspect_ratio: PowerPointType   # 16:9 | 4:3 | A1
  page_low, page_high: int       # 页数约束
  attachments: list[str]         # 附件路径
  constraints: list[Constraint]  # 结构约束（STYLE/COVER/AGENDA/VISUAL_CHART/...）
  task_id: str                   # md5(prompt+attachments)[:8]
```

**Workspace 对齐协议**（所有框架必须产出）：
```
workspace/{task_id}/
  .datapoint.json            # 输入任务
  .slides.md                 # == manuscript.md（PPTea 文稿别名）
  manuscript.md              # 完整幻灯片文稿
  slide_manifest.json        # 幻灯片结构清单
  design-system.json         # 品牌/排版配置
  slides/global.css + slide_01.html...  # HTML 幻灯片源码
  renders/html/ slide_01.png + renders/pptx/ slide_01.png   # 渲染截图
  .slide_images-pdf-{stem}/slide_XX.jpg   # 评测图片（评分唯一输入）
  delivery/ presentation.pptx + presentation.pdf + source.zip  # 最终交付
  intermediate_output.json / run.json / qa/ / evals.json / slide_evals.json / constraint_evals.json
```

### 7.4 轨迹蒸馏与冷启动

`sarl/coldstart/` 实现 SFT 蒸馏管线（把大模型 DeepPresenter 蒸馏为 Qwen3-VL-4B）：

- **`trajectory_collect.py`**：把完成的 DeepPresenter workspace 转成 SFT 轨迹，应用质量过滤（`constraint==1.0, content>=3.9, style>=3.9, constraint_vlm>=0.65`），过滤重复输出、消息去重、注入合成 `thinking` 工具，导出 `data/stage1/trajectories_*.json`——**评测分数闭环回到训练数据筛选**；
- **`coldstart.sh`**：Megatron SFT 训练 Qwen3-VL-4B-Instruct（4 GPU、TP=4、56K 上下文、3 epochs、lr 1e-5）；
- **`process_oversight.py`**：外在验证/过程监督——VLM critic（`vl_oversight`）审查 Design Agent 的 HTML 幻灯片的版面/渲染/风格问题（severity 0-3）+ `agent_watch` 幻觉检测 + `critic_follow` 计划遵循检查（论文 3.2 节 extrinsic verification 的实现）；
- `sarl/analysis/efficiency.py`：成本-性能帕累托图（论文 Figure 6 数据）。

---

## 8. 与直接让 CodeX 生成 PPT 的对比

### 8.1 直接 CodeX 方式的做法

"直接让 CodeX 生成 PPT，给他参考图附件"的做法是：把任务提示 + 参考图片作为附件给 CodeX，让它用通用编码能力（python-pptx / html / marp 等）直接写代码生成 PPTX。在我们的评测中，对应 `codex_gen.py`：`codex exec --sandbox danger-full-access` + `pptx-generator` Skill（把 DeepPresenter 流程蒸馏为 Codex 可用的 Skill 文档 + 确定性脚本）。

### 8.2 本质区别一：Research 与 Design 的解耦

**DeepPresenter**：两个专职智能体、两段轨迹、一个共享文件系统。
- Researcher 用意图自适应策略做**多步检索综合**（web/图片/论文/附件解析），产出结构化文稿 M（页面/主题/证据/资产绑定）；
- Presenter 在独立轨迹中基于 M 做**内容驱动的视觉设计**，每页 inspect 修复。

**直接 CodeX**：单一 agent 用统一上下文同时承担调研与设计。问题：
- 调研深度受上下文窗口限制，长文档/多主题调研容易浅尝辄止；
- "调研"与"设计"互相抢占 token 预算，设计阶段上下文已接近极限（对应 DeepPresenter 论文统计的 32.3% 环境错误：上下文溢出）；
- 附件证据使用浅层：实测（`experiment-codex-vs-deeppresenter-finalcheck-20260813.md`）中 Codex 对 14 页试卷附件只做"题目级裁剪+通用标题+两条短要点"，而 DeepPresenter 把 955 行 Markdown 解析成概念级教学图（station model、seismogram S-P timing、subduction quakes...），3-4 条因果要点 + 与论点直接绑定的可读图。

### 8.3 本质区别二：环境接地反思 vs 内省反思

**DeepPresenter** 的 `inspect_slide` 把 HTML 渲染成像素图交给多模态智能体"亲眼看"，`inspect_manuscript` 给结构化诊断（页数/语言/资源缺失）。反思条件是**渲染后的感知状态**，与用户看到的一致，能发现：
- 后渲染缺陷（元素溢出、重叠、低对比度、断裂图片）；
- 图片路径前缀缺失（论文 Figure 2 例子："fig1.jpg" missing "images/" prefix）。

**直接 CodeX** 的反思大多是内省式的：看自己的代码和中间文本（HTML/代码），"我觉得没问题"。问题：
- 自验证偏差（self-verification bias）：在自己的轨迹状态内评判自己的输出；
- 代码级合法（HTML 语法正确、布局坐标在界内）≠ 渲染级正确（溢出/重叠/可读性）；
- 实测中 Codex 的 QA 检查聚焦路径/可读性/转换成功，**抓不到核心内容失败**："这个视觉真的支撑了本页论点吗？"

### 8.4 本质区别三：受控工具生态 vs 通用编码环境

**DeepPresenter** 提供 5 类 20+ 个受控 MCP 工具：
- Retrieve（search_web/images/papers、fetch_url、document_analyze、image_caption）；
- File（convert_to_markdown、read/write/move/edit/download_file、execute_command、目录管理）；
- Reason（thinking、inspect_slide、inspect_manuscript）；
- Control（todo_create/update/list、finalize）；
- Create（image_generation）。

工具的**语义边界明确**（如 `search_web` 封装了检索+结果归一化）、**有校验**（`finalize` 按角色校验产物、`download_file` 校验图片格式与路径、工具输出 4096 字符截断+全文落盘）、**有审计**（tool_history.jsonl、tools_time_cost.json）、**有沙箱**（危险命令黑名单）。

**直接 CodeX** 只有一个通用 sandbox + 文件系统 + shell。能力等价但缺少：
- 语义化的检索工具（检索质量依赖模型自己拼 URL/API）；
- 专门的渲染观察接口（没有 inspect，只能靠写脚本截图再读，或干脆不检查）；
- 按角色约束的终止校验（finalize 的产物类型验证）；
- 上下文管理（工具截断、压缩折叠、预算告警）。

### 8.5 本质区别四：评测闭环

- PPTAgent/DeepPresenter 自带评测框架（PPTEval / Constraint+Content+Style+Diversity），评测分数驱动实验迭代；
- 本项目的蒸馏管线（`trajectory_collect.py`）把**评测分数作为 SFT 轨迹过滤阈值**（constraint==1.0、content>=3.9、style>=3.9、constraint_vlm>=0.65），形成"评测→过滤→训练→再评测"闭环；
- Codex 方式是通用 agent，没有与演示文稿语义绑定的评测反馈回路。

### 8.6 实测对比数据

12 样本实测（`codex-skill-ppt-additional-analysis*.md`）：

| 维度 | Codex+Skill | DeepPresenter | 差距 |
|---|---|---|---|
| Content | 2.62 | 4.33 | **主要差距**（受众改写、证据选择、有意义的视觉） |
| Style | 3.96 | 4.45 | 较小（页数/渲染/基本布局已不是瓶颈） |

单样本细看（`07bbf73b`，14 页附件 deck）：
- Codex 逐页 Content：`4,3,3,2,2,3,2,2,2,2,2,2,2,3`——中段大面积 2/5 塌陷；
- DeepPresenter 逐页 Content：`3,3,3,3,3,4,5,5,5,4,5,5,4,3`——多数页 4-5/5；
- Codex 页级样式 Style 4.0（结构有效、视觉一致），但"每页一个 PDF 裁剪图 + 通用证据标题 + 两条短要点"，视觉被评价为"小、难读、与页主题弱相关甚至离题"；
- 单页 A1 海报任务（`c5cae881`）两者打平（4.0/4.0/1.0）——因为单页合成任务无多页证据路由问题，Skill 足以匹配。

**结论**：直接 CodeX（即使配上 Skill）在"多页、附件密集、需要把附件内容转成教学产物"的任务上，与 DeepPresenter 的核心差距在**语义内容质量**（证据提取、论点-证据绑定、视觉信息增益），而非确定性约束或转换稳定性。

---

## 9. 从论文到代码的对应关系速查表

| 论文概念 | 代码位置 |
|---|---|
| PPTAgent Stage I 幻灯片分类 | `pptagent/induct.py:95-110`（category_split，`prompts/category_split.txt`） |
| PPTAgent Stage I 版面聚类 | `pptagent/induct.py:112-151` + `model_utils.py:291-345`（get_cluster，sim_bound=0.65） |
| PPTAgent Stage I Schema 提取 | `pptagent/induct.py:175-208`（content_induct）+ `presentation/layout.py`（Element/Layout） |
| PPTAgent Stage II 大纲生成 | `pptagent/pptgen.py:239-318`（generate_outline + _add_functional_layouts） |
| PPTAgent Stage II 版面选择/内容生成 | `pptgen.py:434-467` / `469-491`（_select_layout / _generate_content） |
| 编辑 API | `pptagent/apis.py`（replace_paragraph/replace_image/del_paragraph/del_image/clone_paragraph） |
| 自校正 REPL | `pptgen.py:493-529`（_edit_slide）+ `apis.py:127-203`（execute_actions） |
| HTML 渲染（CodeRender） | `pptagent/presentation/presentation.py:193-216`（SlidePage.to_html）+ `shapes.py` |
| Closure 延迟构建 | `pptagent/presentation/shapes.py:218-246`（Closure）+ `presentation.py:122-144`（build） |
| PPTEval | `pptagent/ppteval/ppteval.py` + `prompts/ppteval/*.txt`（三维度 prompt） |
| 多样性指标 | `pptagent/ppteval/divesity.py`（Vendi Score）+ `sarl/evaluation/divesity.py` |
| Agent Harness 主循环 | `deeppresenter/agents/agent.py`（action:191-240 / execute:250-348 / compact_history:356-401 / loop:242-249） |
| AgentLoop 编排 | `deeppresenter/main.py:43-224`（run） |
| AgentEnv 与工具执行 | `deeppresenter/agents/env.py`（tool_execute:111-226 / register_tool:347-372） |
| MCP 客户端 | `deeppresenter/utils/mcp_client.py` |
| inspect_slide / inspect_manuscript | `deeppresenter/tools/reflect.py:28-62 / 66-117` |
| finalize 终止校验 | `deeppresenter/tools/task.py:58-111` |
| 角色定义 | `deeppresenter/roles/*.yaml` + `utils/constants.py`（动态提示词片段） |
| 上下文折叠 | `agent.py:356-401`（compact_history）+ `constants.py:154-184`（MEMORY_COMPACT_MSG） |
| 多智能体并行 | `deeppresenter/agents/subagent.py`（delegate_subagent）+ `main.py:74-78` |
| HTML→PPTX | `deeppresenter/utils/webview.py:169-233` + `html2pptx/html2pptx_cli.js` |
| 沙箱 | `deeppresenter/docker/server.ts`（DesktopCommanderMCP）+ `run_sandbox_local.sh` |
| 外在验证（extrinsic verification） | `PPTea-main/sarl/coldstart/process_oversight.py`（vl_oversight/agent_watch/critic_follow） |
| 轨迹过滤/蒸馏 | `sarl/coldstart/trajectory_collect.py` + `coldstart.sh`（Qwen3-VL-4B SFT） |
| 评测两阶段管线 | `sarl/evaluation/score_exp.py`（Phase 1）+ `score_exp_complex.py`（Phase 2） |
| 约束验证 | `sarl/dataset/typings.py`（DataPoint.verify）+ `prompt/judge_constraints.txt` |
| 人工审核 | `sarl/evaluation/review_server.py`（FastAPI） |
| Codex 基线 | `sarl/evaluation/codex_gen.py` + `../Deeppresenter-skills/skills/pptx-generator` |

---

## 10. 总结与启示

1. **两代系统的演进主线**：PPTAgent（2025）证明"编辑式生成 + 参考模板"能大幅超越纯摘要式生成，但受限于依赖参考演示文稿与固定工作流；DeepPresenter（2026）转向"双智能体 + 自由式生成 + 环境接地反思"，把生成从"模板填充"解放为"内容驱动的自主设计与修正"，并进一步用外在验证合成轨迹蒸馏出 9B 小模型。

2. **Agent Harness 的本质**：一个带上下文管理的 think-act-observe 工具调用循环（`Agent.action → execute → 观察 → 直到 finalize`），配上**角色化提示词、MCP 工具生态、沙箱执行、上下文折叠、多智能体委派**，就构成了 DeepPresenter 的通用智能体框架——这套框架不限于 PPT 生成，可复用于任意"长时程、工具密集、需要迭代反思"的任务。

3. **与直接 CodeX 的差距不在"有没有 agent"，而在"agent 的观察与反思是否接地"**：DeepPresenter 的 `inspect` 让智能体"亲眼看到"渲染产物，Researcher/Presenter 解耦让每段轨迹专注且上下文充足，受控工具 + finalize 校验让长时程执行可审计。这些正是直接 CodeX（哪怕配上 Skill）难以在通用环境中复现的。

4. **对本项目的意义**（`project-demand.md`）：把 DeepPresenter/PPTAgent 流程蒸馏为 `pptx-generator` Skill 供 Codex/CC 使用，本质上是在"通用 Agent Harness（Codex）"里重建 DeepPresenter 的关键机制：Workspace 对齐（`.slides.md`/`.slide_images-pdf-*` 归一化）、确定性管道（research/html/qa/convert/package）、评测对齐（pptx-evaluator + GPT-5）。实测表明机械对齐已达标（页数/渲染/打包），剩余差距集中在**附件语义化与证据绑定**——这正是 DeepPresenter 论文里 Researcher 环节（意图自适应检索 + 结构化文稿）与"证据有信息增益"评估准则的体现，也是下一步迭代（topic map、证据绑定 QA、对象级 PDF 裁剪）应聚焦的方向。

---
title: "用 ComfyUI 生成图片和视频：从 Workflow 到集群部署"
date: 2026-08-22
tags: ["ComfyUI", "AI 绘图", "视频生成", "FLUX.2", "MiniMax H3", "Slurm"]
featured: true
---

最近在集群上搭了一套 ComfyUI 环境，用 FLUX.2 生成图片，也准备了 MiniMax H3 的文生视频和图生视频 Workflow。整个过程比想象中有意思：它没有把所有参数塞进一个很长的配置文件，而是把模型、提示词、采样器、VAE 和输出等步骤做成一个个节点，再像拼积木一样把它们连起来。

这篇文章一方面介绍 ComfyUI 的基本概念和常见模块，另一方面也记录一下我自己的使用方式：在集群计算节点上申请 GPU 并运行 ComfyUI Server，通过 SSH 端口转发到 Mac，最后在本地浏览器里编辑和执行 Workflow。

<!--more-->

## ComfyUI 是什么？

[ComfyUI](https://github.com/Comfy-Org/ComfyUI) 是一个基于节点图（node graph）的生成式 AI 工作流工具。官方把它定位为一个模块化的 AI 内容创作引擎，除了图片，也支持视频、音频、3D 等任务。

如果以前用过 Stable Diffusion WebUI，可能会习惯在一个页面里填写提示词、采样步数、分辨率，然后点击生成。ComfyUI 的思路不太一样：**它把一次生成任务拆成很多可以连接、替换和复用的模块。**

例如，一个最基本的文生图流程大致是：

```text
加载模型
  ├── 文本编码器 ──> 编码正向/负向提示词 ──┐
  ├── 去噪模型 ────────────────────────────┤
  └── VAE ────────────────────────────────┐│
                                         ▼▼
空 Latent ───────────────────────────> KSampler
                                         │
                                         ▼
                                    VAE Decode
                                         │
                                         ▼
                                     Save Image
```

每个节点两侧都有输入输出接口，接口的颜色和类型需要对应。模型接到采样器的 `model`，提示词编码结果接到 `positive` 或 `negative`，采样器输出的 latent 再交给 VAE 解码。连线正确，数据就会沿着图向后流动。

这也是我觉得 ComfyUI 很好玩的地方。它不像在使用一个只有“生成”按钮的黑盒，更像是在桌面上搭一条小型生产线。简单任务可以只用几个节点，复杂任务则可以继续加入 LoRA、ControlNet、局部重绘、放大、补帧、视频编码等模块。

## 从最小的文生图 Workflow 开始

下面这张图来自 ComfyUI 官方的[文生图基础教程](https://docs.comfy.org/zh/tutorials/basic/text-to-image)。这是一个很典型的 Stable Diffusion 文生图 Workflow：左侧加载 checkpoint，中间准备提示词和 latent，KSampler 完成采样，最后通过 VAE Decode 和 Save Image 得到图片。

![ComfyUI 基础文生图 Workflow](/images/comfyui/basic-workflow-overview.jpg)

图里从 A 到 F 的六个部分分别是：

1. `Load Checkpoint`：加载模型，并输出 `MODEL`、`CLIP` 和 `VAE`。
2. `Empty Latent Image`：创建初始潜在空间，同时定义图片宽高和批量大小。
3. `CLIP Text Encode`：把正向、负向提示词转换成模型能够使用的条件。
4. `KSampler`：从噪声开始，按照提示词条件反复去噪。
5. `VAE Decode`：把 latent 解码成真正能看到的像素图像。
6. `Save Image`：预览并保存结果。

导入工作流有几种常用方式：

- 把包含 Workflow 元数据的 PNG 直接拖到画布中；
- 使用 `Workflow -> Open` 打开 Workflow JSON 或 PNG；
- 从 `Workflow -> Browse Workflow Templates` 选择官方模板；
- 把 GUI 格式的 JSON 放进 `ComfyUI/user/default/workflows/`，再从 Workflow 侧边栏打开。

我自己的 Workflow 单独留了一份在项目的 `workflows/` 目录中，同时把日常需要在 WebUI 里直接打开的版本放到 ComfyUI 的用户工作流目录。这样既方便备份，也方便后面让 GPT 或 Codex 修改节点和模型路径。

## 几个最重要的模块

第一次看到 ComfyUI 的节点图可能会觉得线很多，但真正理解下面几个模块以后，大部分基础 Workflow 都能看懂。

### 去噪模型：UNet、DiT 和 MODEL

在传统 Stable Diffusion Workflow 里，经常会看到 `UNet` 这个名字。它是扩散过程中的去噪主干：输入某一步的噪声 latent、当前时间步和文本条件，预测应该如何减少噪声。KSampler 会反复调用它，逐步把随机噪声变成具有结构的图像。

不过需要注意，**“UNet”在 ComfyUI 生态里有时也被当作去噪模型的习惯性统称。** FLUX.2、MiniMax H3 等较新的模型使用的是 Transformer/DiT 一类架构，并不等于经典 Stable Diffusion UNet。界面上仍可能通过 `UNETLoader` 加载，连接出去的类型通常也统一显示为 `MODEL`。理解 Workflow 时，把它看成“负责扩散去噪的主模型”更准确。

### CLIP 与文本编码器

生成模型不能直接理解自然语言字符串，因此提示词要先经过文本编码器，变成一组语义向量，再作为 conditioning 送入采样流程。

SD1.5 的基础流程里常把这一部分叫作 `CLIP Text Encode`。新模型不一定只使用 CLIP，例如我的 FLUX.2 Workflow 使用 Mistral 系列文本编码器，MiniMax H3 使用 Qwen3-VL 32B 文本编码器。节点名称和底层模型会变化，但它们承担的核心职责相似：**把“我想生成什么”转换成去噪模型能使用的条件。**

传统文生图里通常有两路条件：

- `positive`：希望画面中出现的主体、环境、风格、镜头和光线；
- `negative`：希望模型避免的内容，例如模糊、错误肢体、文字水印等。

不同模型的提示词习惯并不完全相同。不能把 SD1.5 时代的“关键词堆叠”机械套到所有新模型上，有些新模型更适合完整、结构清楚的自然语言描述。

### Latent：模型真正工作的“画布”

扩散模型通常不直接在完整 RGB 像素上反复去噪，而是在压缩后的潜在空间（latent space）中工作。可以把它理解成一张信息更紧凑的“草图”或“蓝图”。

文生图一般从随机 latent 开始；图生图则先用 VAE Encode 把输入图片压进 latent，再加入一定噪声后继续采样。因此图生图中的 `denoise` 很关键：数值越小越保留原图，越接近 1，模型自由发挥的程度越高。

### KSampler：真正执行生成的核心

KSampler 是基础 Workflow 中最核心的节点之一。它接收：

- 去噪模型 `model`；
- 正向和负向条件；
- 初始 `latent_image`；
- `seed`、`steps`、`cfg`、采样器和调度器等参数。

其中几个参数最值得记住：

| 参数 | 作用 | 实际理解 |
|---|---|---|
| `seed` | 初始化随机噪声 | 相同模型、参数和 seed 更容易复现结果 |
| `steps` | 去噪迭代次数 | 不是越高越好，超过模型合适范围只会更慢 |
| `cfg` | 提示词引导强度 | 太高可能让画面生硬或失真；不同模型推荐值差异很大 |
| `sampler_name` | 采样算法 | 决定每一步如何沿去噪轨迹更新 |
| `scheduler` | 噪声调度方式 | 决定时间步和噪声强度如何分配 |
| `denoise` | 去噪强度 | 文生图一般为 1；图生图常小于 1 |

如果 Workflow 使用的是 `SamplerCustom`、独立 Scheduler 和 Guider 节点，不必慌张，它只是把 KSampler 内部的几个步骤进一步拆开了，方便更细粒度地控制。

### VAE Encode / Decode

VAE 是像素空间和潜在空间之间的桥梁：

- `VAE Encode`：图片 → latent，常见于图生图、局部重绘和参考图流程；
- `VAE Decode`：latent → 图片，是输出最终结果前的必要步骤。

视频模型也有类似的编解码过程，只不过 latent 多了时间维度。MiniMax H3 还把视频和音频分别交给 video VAE、audio VAE 处理，因此我的 H3 模型目录里会同时出现两套 VAE。

### LoRA 与其他控制节点

LoRA 可以在不替换基础模型的情况下调整风格、角色或特定能力。ControlNet、参考图编码、遮罩和预处理器则会给生成过程增加姿态、边缘、深度或局部区域等约束。

这些模块正是节点式工作流的优势：不需要重写整条链路，只要把新模块接到合适的位置即可。

## 我使用的图片模型：FLUX.2 Dev FP8

这次图片生成使用的是 **FLUX.2 Dev**。官方的 [FLUX.2 ComfyUI 教程](https://docs.comfy.org/tutorials/flux/flux-2-dev)提供了文生图和多参考图模板；我采用的是适合当前集群环境的 FP8 Workflow，主要文件如下：

```text
ComfyUI/models/diffusion_models/flux2_dev_fp8mixed.safetensors
ComfyUI/models/text_encoders/mistral_3_small_flux2_fp8.safetensors
ComfyUI/models/vae/flux2-vae.safetensors
ComfyUI/models/loras/Flux2TurboComfyv2.safetensors
```

选择 FP8 的主要原因不是“量化后画质更好”，而是它在 A6000 和当前 PyTorch/CUDA 组合下更实用，可以减少显存、内存和加载压力。具体使用时仍然要在速度、显存占用和精度之间做取舍。

对应的图片 Workflow 可以概括成四个部分：

1. **模型加载**：加载 FLUX.2 diffusion model、Mistral 文本编码器、VAE 和可选 Turbo LoRA；
2. **条件构造**：编码提示词，准备分辨率、批量大小和初始 latent；
3. **采样生成**：设置 seed、steps、guidance 和 scheduler，执行去噪；
4. **解码保存**：通过 FLUX.2 VAE 解码，再预览或保存图片。

下面是 ComfyUI 官方 FLUX.2 文生图模板给出的示例结果：

![FLUX.2 Dev 文生图示例](/images/comfyui/flux2-text-to-image-workflow.webp)

我的 Workflow 文件名是：

```text
workflows/image_flux2_fp8.json
```

打开以后最常修改的通常不是节点拓扑，而是提示词、分辨率、seed、采样参数以及 LoRA 强度。节点搭好以后，后续生成基本就是在同一张图上不断迭代。

## 我使用的视频模型：MiniMax H3

视频部分使用的是 **MiniMax H3 FL2VA**，准备了两条 Workflow：

```text
workflows/video_minimax_h3_t2v_fp8_cluster.json
workflows/video_minimax_h3_i2v_fp8_cluster.json
```

- `T2V`（Text to Video）：只有文本提示词，从噪声开始生成视频；
- `I2V`（Image to Video）：增加一张起始图片，让画面主体和构图更可控。

我选择 FL2VA，是因为这一套权重可以覆盖文生视频和首帧/末帧条件视频。此次没有下载 Ref2VA，所以这套环境暂时不包含多参考图片、参考视频和参考音频驱动的 Workflow。

这里也记录一下当时的真实状态：**模型下载、文件校验和 Workflow 改写已经完成，但 MiniMax H3 还没有实际完成一次生成验证。** 所以这部分更准确地说是“已经准备就绪”，不等于整条 T2V/I2V 链路已经跑通。以后第一次成功生成后，还需要把实际耗时、显存峰值和最终参数补回来。

使用的主要模型文件是：

```text
ComfyUI/models/diffusion_models/
  minimax_h3_fl2va_pruned_fp8_scaled.safetensors

ComfyUI/models/text_encoders/
  qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors

ComfyUI/models/vae/
  minimax_h3_video_vae_fp16.safetensors
  minimax_h3_audio_vae_fp32.safetensors
```

MiniMax H3 Workflow 比图片 Workflow 更长，但仍然可以按功能分区理解：

1. **加载区**：加载 H3 diffusion model、Qwen3-VL 文本编码器和视频/音频 VAE；
2. **输入区**：填写提示词，选择 T2V 或上传 I2V 首帧；
3. **规格区**：设置宽高、时长、帧率以及帧数等参数；
4. **条件与采样区**：将文本、图像和时间信息组成 conditioning，再执行视频 latent 的采样；
5. **解码输出区**：分别解码视频与音频，最后保存或封装输出文件。

视频的计算量远大于单张图片。分辨率、帧数和时长稍微增加，显存占用和生成时间都会明显上涨。第一次跑新 Workflow 时，最好先用较短时长和较低分辨率确认整条链路能够工作，再逐渐提高参数。

这次使用 `pruned_fp8_scaled`，是因为集群保留了 `torch==2.5.1+cu121`，而官方模板中的 `pruned_int8_convrot` 更适合较新的 PyTorch/cu130 组合。模型变体必须和硬件、驱动、PyTorch 以及 ComfyUI 版本一起考虑，不能只看文件名里哪个精度更低。

## 在集群上运行 ComfyUI

我的工作目录是：

```text
/home/wangzh/personal/comfyui-lab
```

主要环境为：

```text
ComfyUI: v0.30.2
Conda env: comfyui
PyTorch: 2.5.1+cu121
torchvision: 0.20.1+cu121
torchaudio: 2.5.1+cu121
GPU: NVIDIA A6000
```

之所以使用 ComfyUI `v0.30.2`，是因为 MiniMax H3 需要 `0.30.0+`；同时集群驱动是 NVIDIA 535 / CUDA 12.2，所以没有为了追新而强行升级整套 CUDA 依赖。

### 登录节点负责提交，计算节点负责生成

集群通常有登录节点和计算节点。比较合适的分工是：

- 登录节点：准备环境、下载模型、编辑脚本、提交和查看 Slurm 作业；
- 计算节点：获得 GPU 后，真正运行 ComfyUI Server 和模型推理。

也就是说，不应该在登录节点上直接占用 GPU 或长期跑推理服务。我的启动脚本是：

```text
/home/wangzh/personal/comfyui-lab/scripts/run_comfyui_server.sbatch
```

脚本默认申请的资源包括：

```text
partition=normal
account=wangzh
gpu=1
cpus-per-task=2
mem=120G
time=02:00:00
cluster port=48188
listen=127.0.0.1
```

例如要启动一个三小时的 ComfyUI 服务：

```bash
sbatch --time=03:00:00 \
  /home/wangzh/personal/comfyui-lab/scripts/run_comfyui_server.sbatch
```

作业开始后，ComfyUI 会在获得 GPU 的计算环境中监听 `127.0.0.1:48188`。只监听回环地址不会把服务直接暴露到公网或整个集群网络，后面通过 SSH 隧道访问即可。

### 从 Mac 建立 SSH 端口转发

我在 Mac 上使用的命令是：

```bash
ssh -N -L 28188:127.0.0.1:48188 A6000
```

然后在 Mac 浏览器中打开：

```text
http://127.0.0.1:28188
```

这条命令可以拆开理解：

- `-N`：只建立隧道，不在远端执行 shell 命令；
- `-L`：创建本地端口转发；
- `28188`：Mac 上监听的本地端口；
- `127.0.0.1:48188`：从 SSH 远端视角访问的 ComfyUI 地址；
- `A6000`：我在 SSH 配置里使用的主机别名。

整个访问链路可以理解为：

```text
Mac 浏览器
    │  http://127.0.0.1:28188
    ▼
Mac 本地端口 28188
    │  SSH tunnel
    ▼
A6000 对应的远端环境
    │  127.0.0.1:48188
    ▼
ComfyUI Server + Slurm GPU
```

这里有一个容易踩坑的地方：`127.0.0.1:48188` 是相对于 SSH 最终连接到的远端主机而言的。如果 `A6000` 只会登录到登录节点，而 ComfyUI 实际跑在另一台计算节点，那么还需要让 SSH 经过跳板机连接到计算节点，或者使用集群提供的二段转发脚本。我的环境里可以用项目中的脚本根据 job id 打印正确命令：

```bash
/home/wangzh/personal/comfyui-lab/scripts/print_tunnel_command.sh <job-id>
```

不同集群的网络策略不一样，最可靠的原则是：**先确认 ComfyUI 到底在哪台主机监听，再让隧道的远端终点落到那台主机。**

## 在 Mac WebUI 中实际操作

SSH 隧道建立以后，虽然浏览器开在 Mac 上，但所有模型加载和推理仍发生在集群 GPU 上。Mac 只负责显示 WebUI、上传输入、修改参数和查看结果，因此不需要本地拥有大显存。

我的日常操作大概是：

1. 在登录节点提交 Slurm 作业，等待 GPU 分配；
2. 确认 ComfyUI Server 已在计算节点启动；
3. 在 Mac 上执行 SSH 端口转发；
4. 打开 `http://127.0.0.1:28188`；
5. 从 Workflow 面板加载 FLUX.2、H3 T2V 或 H3 I2V；
6. 修改提示词、图片、分辨率、时长和采样参数；
7. 点击 `Queue`，观察节点依次执行并等待输出；
8. 保存满意的结果，同时保存对应 Workflow 和 seed。

如果一个节点变红，通常可以从三类问题开始排查：模型文件名不匹配、模型目录放错，或者 Workflow 引用了当前环境没有安装的自定义节点。模型很大时，还要留意系统内存、显存以及模型加载时间，不要看到页面暂时没响应就重复点击 Queue。

## 让 GPT 或 Codex 帮忙搭 Workflow

ComfyUI Workflow 本质上是 JSON，因此非常适合让 AI 帮忙做机械工作，例如：

- 根据现有 Workflow 替换模型文件名；
- 把 T2V Workflow 改成 I2V；
- 增加 LoRA、保存节点、预览节点或固定 seed；
- 整理节点位置和分组，让画布更容易读；
- 批量检查 Workflow 引用的模型是否真实存在；
- 生成不同显存配置对应的 Workflow 版本。

不过有两个细节需要说清楚。

第一，给 AI 的应该是 **GUI Workflow JSON**，而不是只供 API 调用的 prompt JSON。前者包含节点位置、连线、分组和控件值，才能在 WebUI 里正常显示为一张可编辑的节点图。

第二，文件中的模型名必须和 `ComfyUI/models/...` 下的实际文件名完全对应。我的 MiniMax H3 官方模板原本引用：

```text
minimax_h3_fl2va_pruned_int8_convrot.safetensors
```

为了适配集群环境，两个 Workflow 都改成了：

```text
minimax_h3_fl2va_pruned_fp8_scaled.safetensors
```

完成后把 JSON 放到 `ComfyUI/user/default/workflows/`，就可以在 WebUI 的 Workflow 列表中直接打开；也可以保存在项目目录，再通过 `Workflow -> Open` 导入。

AI 可以帮忙把积木搭好，但第一次执行仍然要人工检查模型版本、输入输出类型、分辨率、帧数和显存占用。一个 JSON 在结构上合法，不代表它一定适合当前机器。

## 一些实际使用建议

### 先跑通最小版本，再追求画质

第一次接触某个模型时，先用官方模板和默认参数跑通。确认模型能加载、采样器能执行、VAE 能解码、结果能保存之后，再增加 LoRA、参考图、放大和后处理。否则一开始堆太多节点，出错时很难知道问题在哪一段。

### 把 Workflow 和模型清单一起保存

只保存 JSON 不够。几个月后重新打开时，最常见的问题就是忘了它依赖哪个模型、模型应该放在哪个目录。最好同时记录：

- ComfyUI 版本；
- Workflow 文件；
- 模型文件名与目录；
- PyTorch/CUDA 环境；
- 关键生成参数；
- 一张成功输出作为基准。

这次下载完成后，`ComfyUI/models` 大约占用了 95 GB。大模型环境很难靠“缺什么再随便下一个”来维护，提前写清清单会省掉很多时间。

### 图片记录 seed，视频先压低成本

图片生成中，满意的构图可以先固定 seed，再微调提示词和参数。视频则建议先降低时长和分辨率做预览，因为一次失败生成的成本远高于单张图片。确认动作、镜头和主体稳定以后，再提高规格输出最终版本。

### 不要盲目照搬参数

网上经常会看到“某个 sampler 最好”“steps 必须多少”“cfg 越高越听话”一类经验。它们往往只对某个具体模型和 Workflow 成立。Stable Diffusion、FLUX.2 和 MiniMax H3 的推荐参数可以完全不同，优先参考模型官方模板，再在自己的硬件上做小范围实验。

## 常用链接

- [ComfyUI 官网](https://www.comfy.org/)
- [ComfyUI 官方 GitHub](https://github.com/Comfy-Org/ComfyUI)
- [ComfyUI 中文文档](https://docs.comfy.org/zh)
- [官方文生图基础教程](https://docs.comfy.org/zh/tutorials/basic/text-to-image)
- [官方图生图基础教程](https://docs.comfy.org/zh/tutorials/basic/image-to-image)
- [FLUX.2 Dev 官方教程](https://docs.comfy.org/tutorials/flux/flux-2-dev)
- [ComfyUI 官方示例集合](https://comfyanonymous.github.io/ComfyUI_examples/)
- [Comfy-Org FLUX.2 Dev 模型文件](https://huggingface.co/Comfy-Org/flux2-dev)
- [Comfy-Org MiniMax H3 模型文件](https://huggingface.co/Comfy-Org/MiniMax-H3)

## 总结

ComfyUI 的门槛主要来自第一眼看到的节点和连线，但它的核心逻辑其实很清楚：**加载模型，准备条件，在 latent 中采样，再把结果解码并保存。** 图片和视频的差别主要在模型、条件、latent 维度和输出编码，Workflow 的组织方式是相通的。

对我来说，集群上的这套用法也很舒服。GPU 和大模型留在服务器，Mac 只通过 SSH 隧道访问 WebUI；Workflow 可以交给 GPT 或 Codex 辅助搭建，自己则在浏览器里调整和试验。环境配置完成以后，生成图片和视频就不再是一串难以维护的命令，而是一张可以看见、可以修改、也可以保存下来的流程图。

从这个角度看，ComfyUI 最吸引人的地方可能不只是“能生成图片和视频”，而是它让生成过程本身也变成了一件可以观察和搭建的东西。

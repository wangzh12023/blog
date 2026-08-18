---
title: "GSPO：Group Sequence Policy Optimization 详解"
date: 2026-08-18
tags: ["GSPO", "GRPO", "RL", "强化学习", "LLM", "MoE"]
featured: true
math: true
---


GSPO（**Group Sequence Policy Optimization**）是 Qwen 团队在 2025 年提出的一种用于 LLM 强化学习后训练的策略优化算法。它直接建立在 GRPO 的框架之上，但做了一个非常关键的改变：

> **GRPO 在 token level 计算 importance ratio 并进行 clipping；GSPO 将 importance ratio、clipping 和主要优化单位统一提升到了 sequence level。**

因此，理解 GSPO 最重要的并不是记住一个新的 loss，而是理解这一变化：

$$
\boxed{
\text{token-level policy correction}
\quad\longrightarrow\quad
\text{sequence-level policy correction}
}
$$

Qwen 团队提出 GSPO 的主要目标，是解决大规模 LLM RL，特别是 **长 CoT + MoE 模型**训练过程中 GRPO 出现的高方差和训练不稳定问题。原论文报告 GSPO 相比 GRPO 有更好的训练稳定性和效率，并且不再需要 Qwen 此前为 MoE RL 引入的 Routing Replay。

---

# 1. GSPO 从哪里来？

从算法演化关系看，可以简单理解成：

$$
\boxed{
\text{PPO}
\rightarrow
\text{GRPO}
\rightarrow
\text{GSPO}
}
$$

但三者解决的问题不同。

## 1.1 PPO

对于一个 prompt：

$$
x
$$

模型生成 response：

$$
y=(y_1,\dots,y_T)
$$

语言模型定义：

$$
\pi_\theta(y|x)
=

\prod_{t=1}^{T}
\pi_\theta(y_t|x,y_{<t})
$$

PPO 对每一个 token 定义 importance ratio：

$$
w_t(\theta)
=

\frac{
\pi_\theta(y_t|x,y_{<t})
}{
\pi_{\theta_{\mathrm{old}}}(y_t|x,y_{<t})
}
$$

然后执行 clipped policy optimization：

$$
J_{\mathrm{PPO}}(\theta)
=

\mathbb{E}
\left[
\frac1T
\sum_{t=1}^{T}
\min
\left(
w_t\hat A_t,
\operatorname{clip}(w_t,1-\epsilon,1+\epsilon)\hat A_t
\right)
\right]
$$

PPO 的重要特点是：

$$
\boxed{\text{token-level advantage}+\text{token-level ratio}}
$$

其中 $(\hat A_t)$ 通常需要 Value Model / Critic 进行估计。对于 LLM，这意味着除了 Policy Model，通常还需要维护一个规模相当大的 Value Model，带来显著的计算和显存开销。

---

# 2. GRPO 做了什么？

GRPO 最重要的变化其实不是 importance ratio，而是：

$$
\boxed{\text{去掉 Value Model}}
$$

对于同一个 prompt $(x)$，从 old policy 中采样 $(G)$ 个 response：

$$
y_1,\dots,y_G
\sim
\pi_{\theta_{\mathrm{old}}}(\cdot|x)
$$

分别得到：

$$
r_1,\dots,r_G
$$

然后使用组内 reward normalization：

$$
\hat A_i
=

\frac{
r_i-\operatorname{mean}(r_1,\dots,r_G)
}{
\operatorname{std}(r_1,\dots,r_G)
}
$$

于是：

* reward 高于组平均值：

$$
\hat A_i>0
$$

希望提高这个 response 的概率；

* reward 低于组平均值：

$$
\hat A_i<0
$$

希望降低这个 response 的概率。

GRPO 的关键特点是：

> 一个 response 中的所有 token 都共享同一个 sequence-level advantage：

$$
\hat A_{i,t}=\hat A_i
$$

但是它仍然为每个 token 计算独立 importance ratio：

$$
w_{i,t}
=

\frac{
\pi_\theta(y_{i,t}|x,y_{i,<t})
}{
\pi_{\theta_{\mathrm{old}}}(y_{i,t}|x,y_{i,<t})
}
$$

所以 GRPO objective 是：

$$
J_{\mathrm{GRPO}}(\theta)
=

\mathbb{E}
\left[
\frac1G
\sum_{i=1}^{G}
\frac1{|y_i|}
\sum_{t=1}^{|y_i|}
\min
\left(
w_{i,t}\hat A_i,
\operatorname{clip}(w_{i,t},1-\epsilon,1+\epsilon)\hat A_i
\right)
\right]
$$

也就是说：

$$
\boxed{
\text{sequence-level reward/advantage}
+
\text{token-level importance ratio}
}
$$

这正是 GSPO 认为有问题的地方。

---

# 3. GSPO 认为 GRPO 的核心问题是什么？

GSPO 论文提出了一个核心原则：

$$
\boxed{
\text{Unit of Optimization}
\approx
\text{Unit of Reward}
}
$$

即：

> reward 如果是针对整条 sequence 给出的，那么用于 off-policy correction 和 clipping 的单位也应该对应整条 sequence。

GRPO 的 reward 是：

$$
r(x,y_i)
$$

也就是说 verifier 实际评价的是：

$$
\boxed{\text{整个 response}}
$$

例如数学 RLVR：

> “最终答案对不对？”

reward 可能就是：

$$
r(x,y)
=

\begin{cases}
1 & \text{correct}\\
0 & \text{wrong}
\end{cases}
$$

reward 并没有告诉模型：

* token 37 是好的；
* token 82 是坏的；
* token 151 应该增加概率。

但是 GRPO 的 off-policy correction 却变成：

$$
w_{i,1},w_{i,2},\dots,w_{i,T}
$$

即：

$$
\boxed{\text{一个 sequence reward，却产生了大量 token-wise importance weights}}
$$

GSPO 作者认为，这会向 gradient 中引入大量没有可靠统计支撑的 token-level variance，且这种噪声随着 response 变长而累积。

这里需要一个准确性上的区分：

**“token-level importance sampling 本身在强化学习中是不成立的”并不是一个普遍结论。** Per-decision importance sampling 在合适的 RL formulation 中完全可以有理论依据。

更准确地说：

> 这是 GSPO 作者针对当前 GRPO formulation 提出的批评：GRPO 给 sequence-level reward/advantage，却使用每个位置单独的一次 token sample 构造 token ratio 并直接用来重新加权梯度；他们认为这种设计在大规模 LLM RL 中会产生高方差和不稳定性。

这是 GSPO 论文的算法观点，而不应扩展成“所有 token-level IS 都是错误的”。

---

# 4. GSPO 的核心：Sequence-level Importance Ratio

对于 response：

$$
y_i=(y_{i,1},\dots,y_{i,T_i})
$$

完整 sequence probability：

$$
\pi_\theta(y_i|x)
=

\prod_{t=1}^{T_i}
\pi_\theta(y_{i,t}|x,y_{i,<t})
$$

如果直接构造整个 trajectory 的 likelihood ratio：

$$
R_i
=

\frac{
\pi_\theta(y_i|x)
}{
\pi_{\theta_{\mathrm{old}}}(y_i|x)
}
$$

那么：

$$
R_i
=

\prod_{t=1}^{T_i}
\frac{
\pi_\theta(y_{i,t}|x,y_{i,<t})
}{
\pi_{\theta_{\mathrm{old}}}(y_{i,t}|x,y_{i,<t})
}
$$

也就是：

$$
R_i
=

\prod_t w_{i,t}
$$

但是这里立刻出现一个问题：

### sequence 越长，product 的数值波动越严重。

例如：

$$
1.01^{1000}\approx 20959
$$

即使每个 token 的概率只发生很小的变化，乘 1000 次以后整个 sequence ratio 都可能变得极端。

因此 GSPO **并不直接使用原始 trajectory ratio**，而是使用长度归一化：

$$
\boxed{
s_i(\theta)
=

\left(
\frac{
\pi_\theta(y_i|x)
}{
\pi_{\theta_{\mathrm{old}}}(y_i|x)
}
\right)^{1/T_i}
}
$$

展开：

$$
s_i(\theta)
=

\left(
\prod_{t=1}^{T_i}w_{i,t}
\right)^{1/T_i}
$$

也就是说：

$$
\boxed{
s_i
=

\operatorname{GeometricMean}
(w_{i,1},\dots,w_{i,T_i})
}
$$

或者在 log space：

$$
\boxed{
\log s_i
=

\frac1{T_i}
\sum_{t=1}^{T_i}
\left[
\log\pi_\theta(y_{i,t}|x,y_{i,<t})
-

\log\pi_{\theta_{\mathrm{old}}}(y_{i,t}|x,y_{i,<t})
\right]
}
$$

最终：

$$
s_i
=

\exp(\log s_i)
$$

这就是 GSPO 最核心的公式。

---

# 5. 为什么一定要做 Length Normalization？

如果直接：

$$
R_i
=

\frac{\pi_\theta(y_i|x)}
{\pi_{\mathrm{old}}(y_i|x)}
$$

那么不同长度 response 的 ratio 无法直接使用相同 clipping range。

例如两个 sequence 的平均 token probability change 完全相同：

$$
w_t=1.001
$$

但一个长度：

$$
T=100
$$

另一个：

$$
T=2000
$$

则：

$$
R_{100}=1.001^{100}
$$

而：

$$
R_{2000}=1.001^{2000}
$$

两者会出现非常大的差异。

但做 geometric mean 后：

$$
s
=

R^{1/T}

1.001
$$

于是：

$$
\boxed{\text{sequence length 对 importance ratio scale 的影响基本被消除}}
$$

Qwen 论文明确指出，length normalization 的目的就是降低 variance，同时让不同长度 response 的 importance ratio 落在统一的 numerical range 中。

因此严格来说，GSPO 使用的是：

$$
\boxed{\text{length-normalized sequence likelihood ratio}}
$$

而不是原始 importance sampling 中未经修改的：

$$
\frac{\pi_\theta(y|x)}
{\pi_{\mathrm{old}}(y|x)}
$$

这个区别很重要。

---

# 6. GSPO Objective

GSPO 保留了 GRPO 的 group advantage：

$$
\hat A_i
=

\frac{
r(x,y_i)-\operatorname{mean}_j r(x,y_j)
}{
\operatorname{std}_j r(x,y_j)
}
$$

但是将 token ratio 替换成 sequence ratio：

$$
s_i(\theta)
=

\left(
\frac{\pi_\theta(y_i|x)}
{\pi_{\mathrm{old}}(y_i|x)}
\right)^{1/T_i}
$$

最终 objective：

$$
\boxed{
J_{\mathrm{GSPO}}(\theta)
=

\mathbb{E}
\left[
\frac1G
\sum_{i=1}^{G}
\min
\left(
s_i(\theta)\hat A_i,
\operatorname{clip}
\left(
s_i(\theta),
1-\epsilon,
1+\epsilon
\right)
\hat A_i
\right)
\right]
}
$$

与 GRPO 对比：

### GRPO

$$
\frac1T
\sum_t
\min
\left(
w_{i,t}A_i,
\operatorname{clip}(w_{i,t})A_i
\right)
$$

### GSPO

$$
\min
\left(
s_iA_i,
\operatorname{clip}(s_i)A_i
\right)
$$

所以最本质的变化就是：

$$
\boxed{
{w_{i,1},w_{i,2},\dots,w_{i,T}}
\rightarrow
s_i
}
$$

整条 sequence 只对应一个 importance ratio。

---

# 7. Sequence-level Clipping 到底是什么意思？

假设：

$$
\hat A_i>0
$$

说明这个 response 比同组其他 response 更好。

我们希望：

$$
\pi_\theta(y_i|x)\uparrow
$$

如果：

$$
s_i>1+\epsilon
$$

意味着 current policy 已经把这条 response 的相对概率提高得足够多。

于是：

$$
\operatorname{clip}(s_i)
=

1+\epsilon
$$

后续不再继续鼓励它。

反过来，如果：

$$
\hat A_i<0
$$

说明这是一个较差 response，我们希望：

$$
\pi_\theta(y_i|x)\downarrow
$$

当：

$$
s_i<1-\epsilon
$$

说明它已经被降低得足够多，于是停止进一步惩罚。

所以 PPO、GRPO 和 GSPO 都可以理解为：

$$
\boxed{\text{不要让一次 policy update 离 rollout policy 太远}}
$$

区别只是这个“距离”在哪里判断：

$$
\begin{array}{c|c}
\text{Algorithm} & \text{Clipping Granularity}\\
\hline
\text{PPO} & Token\\
\text{GRPO} & Token\\
\text{GSPO} & Sequence
\end{array}
$$

---

# 8. GSPO 与 GRPO 最大的数学区别：Gradient Weight

这一部分实际上是理解 GSPO 最关键的地方。

先暂时忽略 clipping。

GSPO：

$$
J
=

s_i(\theta)\hat A_i
$$

所以：

$$
\nabla_\theta J
=

\hat A_i\nabla_\theta s_i
$$

利用：

$$
\nabla s=s\nabla\log s
$$

得到：

$$
\nabla_\theta J
=

s_i\hat A_i
\nabla_\theta\log s_i
$$

而：

$$
\log s_i
=

\frac1{T_i}
\sum_t
\left(
\log\pi_\theta(y_{i,t}|x,y_{i,<t})
-

\log\pi_{\mathrm{old}}(\cdots)
\right)
$$

old policy 与 $(\theta)$ 无关，所以：

$$
\nabla_\theta\log s_i
=

\frac1{T_i}
\sum_t
\nabla_\theta
\log\pi_\theta(y_{i,t}|x,y_{i,<t})
$$

最终：

$$
\boxed{
\nabla_\theta J_{\mathrm{GSPO}}
=

s_i\hat A_i
\frac1{T_i}
\sum_t
\nabla_\theta
\log\pi_\theta(y_{i,t}|x,y_{i,<t})
}
$$

注意：

$$
s_i\hat A_i
$$

对于这条 response 中所有 token 是**完全相同的**。

因此每个 token gradient：

$$
\nabla\log\pi_\theta(y_{i,t}|\cdots)
$$

都获得同样的 sequence-level weight：

$$
\boxed{s_i\hat A_i}
$$

---

# 9. 再看 GRPO 的 Gradient

GRPO：

$$
J
=

\frac1T
\sum_t w_{i,t}\hat A_i
$$

因此：

$$
\boxed{
\nabla_\theta J_{\mathrm{GRPO}}
=

\hat A_i
\frac1T
\sum_t
w_{i,t}
\nabla_\theta
\log\pi_\theta(y_{i,t}|x,y_{i,<t})
}
$$

这里最大的区别出现了。

GRPO：

$$
w_{i,1},
w_{i,2},
\dots,
w_{i,T}
$$

每个 token 的 gradient 权重都不一样：

$$
w_{i,t}\hat A_i
$$

而 GSPO：

$$
s_i,s_i,\dots,s_i
$$

所有 token 都使用：

$$
s_i\hat A_i
$$

所以：

$$
\boxed{
\begin{aligned}
\text{GRPO: }&
w_{i,t}\hat A_i
\nabla\log\pi_\theta(y_{i,t})\\[2mm]
\text{GSPO: }&
s_i\hat A_i
\nabla\log\pi_\theta(y_{i,t})
\end{aligned}
}
$$

这实际上比单纯说“GSPO 是 sequence clipping”更能说明算法本质。

---

# 10. 一个直观例子

假设一条 response 有四个 token，对应 old policy → current policy 的 token ratios：

$$
[1.10,\ 0.90,\ 1.05,\ 0.95]
$$

GRPO 会分别使用：

$$
1.10,\quad0.90,\quad1.05,\quad0.95
$$

来 weight 四个 token 的 gradients。

而 GSPO：

$$
s
=

(1.10\times0.90\times1.05\times0.95)^{1/4}
$$

大约为：

$$
s\approx0.997
$$

于是四个 token 都使用：

$$
0.997\hat A
$$

作为 sequence-level coefficient。

从整条 response 看：

$$
s\approx1
$$

意味着：

> old policy 和 current policy 对这条完整 response 的平均 likelihood 基本没有变化。

GSPO 因此不会因为其中某一个 token 的 ratio 是 1.10、另一个是 0.90，就对不同 token 施加非常不同的 off-policy correction。

---

# 11. GSPO 其实非常接近一种 Sequence-level REINFORCE

这是从公式可以直接得到的一个理解。

考虑：

$$
\theta=\theta_{\mathrm{old}}
$$

此时：

$$
s_i=1
$$

忽略 clipping：

$$
\nabla J_{\mathrm{GSPO}}
=

\hat A_i
\frac1T
\sum_t
\nabla_\theta\log\pi_\theta(y_{i,t}|x,y_{i,<t})
$$

而：

$$
\sum_t
\log\pi_\theta(y_{i,t}|x,y_{i,<t})
=

\log\pi_\theta(y_i|x)
$$

于是：

$$
\nabla J
=

\frac{\hat A_i}{T}
\nabla_\theta
\log\pi_\theta(y_i|x)
$$

所以从这个角度，可以将 GSPO 理解为：

$$
\boxed{
\text{Group-normalized sequence REINFORCE}
+
\text{sequence-level off-policy correction}
+
\text{PPO-style clipping}
}
$$

其中 group baseline 来自同 prompt 的多个 sampled responses。

这个理解通常比单独记忆 GSPO loss 更容易把 GSPO 放到 RL 的整体框架里。

---

# 12. 为什么 GSPO 对 Long CoT 更稳定？

假设一个 reasoning response 有：

$$
T=8000
$$

个 tokens。

GRPO 会产生：

$$
8000
$$

个不同的：

$$
w_t
$$

因此 gradient 类似：

$$
\sum_{t=1}^{8000}
w_t A\nabla\log\pi_t
$$

其中某些：

$$
w_t\gg1
$$

某些：

$$
w_t\ll1
$$

而且不同 token 会单独触发 clipping。

随着 sequence 变长，这种 token-level variation 会不断累积。

GSPO 则先将它们压缩成：

$$
s
=

\exp
\left(
\frac1T
\sum_t\log w_t
\right)
$$

然后：

$$
\nabla J
\propto
sA
\frac1T
\sum_t\nabla\log\pi_t
$$

因此它实际上在问：

> “current policy 整体上对这条 reasoning trajectory 的 likelihood 改变了多少？”

而不是：

> “第 5387 个 token 的 probability 改了多少？”

对于只有 sequence-level verifier reward 的数学、代码等 RLVR 场景，这种 granularity 与 reward granularity 更自然地对齐。这正是 GSPO 的核心设计逻辑。

---

# 13. 为什么 GSPO 对 MoE 特别重要？

这是 GSPO 论文非常重要的一部分。

对于 Dense Transformer：

$$
x
\rightarrow
\text{固定的全部参数}
$$

每次 forward 使用的 network structure 基本一致。

但对于 MoE：

$$
x_t
\rightarrow
\text{Router}
\rightarrow
\text{Expert}_{k_1},\text{Expert}_{k_2}
$$

每个 token 激活哪些 experts 是动态的。

因此：

$$
\pi_{\mathrm{old}}
$$

生成 rollout 时可能使用：

$$
E_3,E_7
$$

而做几次 gradient update 以后，同样的 token 在：

$$
\pi_\theta
$$

里可能变成：

$$
E_2,E_7
$$

Qwen 在 Qwen3-30B-A3B-Base 上观察到：一次 RL gradient update 后，对于同一个 rollout sample，新旧 policy 激活的 experts 中大约有 **10% 发生变化**。

这会使：

$$
\frac{
\pi_\theta(y_t|x,y_{<t})
}{
\pi_{\mathrm{old}}(y_t|x,y_{<t})
}
$$

发生明显波动。

问题不仅仅是参数改变了，而是：

$$
\boxed{\text{实际参与计算的 expert network 也可能改变}}
$$

因此 token ratio 可能非常 noisy。

---

# 14. Routing Replay 是什么？

在 GSPO 之前，Qwen 为解决这个问题采用过 **Routing Replay**。

rollout 时记录：

$$
\pi_{\mathrm{old}}
$$

每个 token 激活了哪些 experts。

计算 current policy probability 时，不允许 router 重新选择 experts，而是 replay old routing：

$$
\text{route}_{\theta}
\leftarrow
\text{route}_{\theta_{\mathrm{old}}}
$$

于是比较：

$$
\pi_\theta(y_t)
$$

与：

$$
\pi_{\mathrm{old}}(y_t)
$$

时，两者使用相同的 expert topology。

这样：

$$
w_t
=

\frac{\pi_\theta(y_t)}
{\pi_{\mathrm{old}}(y_t)}
$$

会稳定很多。

论文实验中，GRPO 在 Qwen 的 MoE setting 下如果去掉 Routing Replay，training reward 明显恶化；加入 Routing Replay 后才可以正常训练。

但 Routing Replay 有代价：

* rollout 需要额外缓存 routing information；
* 增加通信和 memory overhead；
* training pipeline 更复杂；
* current policy 不能完全自由使用当前 router；
* 一定程度上限制 MoE 自身动态 routing 的能力。

---

# 15. GSPO 为什么可以不需要 Routing Replay？

因为 GSPO 不关心单个 token：

$$
w_t
$$

而只关心：

$$
s_i
=

\exp
\left(
\frac1T\sum_t\log w_t
\right)
$$

单个 token 因为 expert routing change 导致：

$$
w_t
$$

突然变大或者变小，对整个 sequence 的影响会被 sequence aggregation 稀释。

例如：

$$
w=
[
1.00,
1.01,
0.99,
1.02,
\boxed{1.30},
1.00,
0.98,\dots
]
$$

GRPO 会直接让：

$$
1.30
$$

参与这个 token 的梯度。

GSPO 使用的是：

$$
\exp(\operatorname{mean}\log w_t)
$$

如果 sequence 很长，一个 token 的异常值影响相对有限。

因此：

$$
\boxed{
\text{GSPO 对 individual token likelihood fluctuation 更不敏感}
}
$$

Qwen 的实验显示 GSPO 可以在不使用 Routing Replay 的情况下稳定训练其 MoE 模型。作者将这一点视为 GSPO 对大规模 MoE RL 最重要的优势之一。

这里同样需要保持表述准确：

> 实验表明 GSPO 在 Qwen 的 MoE RL setting 中解决了 Routing Replay 依赖；这不等价于已经证明所有 MoE、所有 RL pipeline 都绝不会出现 routing-related instability。

---

# 16. 一个非常反直觉的实验：GSPO Clip 得更多，反而训得更好

Qwen 论文里有一个很有意思的结果。

平均 clipping fraction：

$$
\text{GRPO}\approx0.0013
$$

而：

$$
\text{GSPO}\approx0.15
$$

也就是说，GSPO 大约有：

$$
15%
$$

的 tokens 因为所在 sequence 被 clipping，而 GRPO 只有大约：

$$
0.13%
$$

的 token 被 clip。

GSPO clipping 的数据明显更多。

但实验中 GSPO 的 training efficiency 反而更高。

作者据此认为：

> GRPO 虽然“用了更多 token”，但其中相当一部分 token-level gradient signal 本身非常 noisy；GSPO 丢掉了更多 off-policy sequences，却留下了质量更可靠的 gradient。

所以：

$$
\boxed{
\text{More training tokens}
\not\Rightarrow
\text{Better gradient estimation}
}
$$

重要的是：

$$
\text{signal quality}
$$

而不是单纯 sample utilization。

---

# 17. GSPO 的 Clip Range 和 GRPO 完全不是一个量级

这一点实现时非常重要。

Qwen 的实验中：

GSPO 使用 asymmetric clipping：

$$
\epsilon_{\mathrm{low}}
=

3\times10^{-4}
$$

$$
\epsilon_{\mathrm{high}}
=

4\times10^{-4}
$$

大致就是：

$$
s_i
\in
[
1-3\times10^{-4},
1+4\times10^{-4}
]
$$

而 GRPO 使用：

$$
0.2,\quad0.27
$$

这种量级。

不要看到 GSPO 也是 PPO-style clipping，就直接照搬：

$$
\epsilon=0.2
$$

原因是两种 ratio 根本不是同一个量：

GRPO：

$$
w_t
$$

GSPO：

$$
s=
\exp
\left(
\operatorname{mean}_t\log w_t
\right)
$$

GSPO 的 sequence-normalized ratio 通常非常接近：

$$
1
$$

所以 clipping range 会小几个数量级。

---

# 18. GSPO 完整训练流程

对于一个训练 batch：

## Step 1：采样 Prompt

$$
x\sim\mathcal D
$$

---

## Step 2：Rollout

使用：

$$
\pi_{\theta_{\mathrm{old}}}
$$

对同一个 prompt 生成 $(G)$ 条 response：

$$
y_1,\dots,y_G
$$

---

## Step 3：计算 Reward

例如数学 RLVR：

$$
r_i
=

\mathbb{1}[\text{answer correct}]
$$

或者：

$$
r_i
=

r_{\mathrm{correct}}
+
r_{\mathrm{format}}
+\cdots
$$

---

## Step 4：计算 Group Advantage

$$
\mu_r
=

\frac1G
\sum_i r_i
$$

$$
\sigma_r
=

\operatorname{std}(r_1,\dots,r_G)
$$

$$
\hat A_i
=

\frac{r_i-\mu_r}{\sigma_r}
$$

实践实现中还需要处理：

$$
\sigma_r=0
$$

的 degenerate group，例如所有 response 都正确或者全部错误。

---

## Step 5：记录 Old-policy Log Probabilities

对于每个 token：

$$
\log p_{i,t}^{old}
=

\log
\pi_{\theta_{\mathrm{old}}}
(y_{i,t}|x,y_{i,<t})
$$

---

## Step 6：Current Policy Forward

计算：

$$
\log p_{i,t}^{new}
=

\log
\pi_\theta
(y_{i,t}|x,y_{i,<t})
$$

---

## Step 7：计算 Sequence Log Ratio

$$
\Delta_{i,t}
=

\log p_{i,t}^{new}

\log p_{i,t}^{old}
$$

然后：

$$
\log s_i
=

\frac1{T_i}
\sum_t
\Delta_{i,t}
$$

---

## Step 8：Exponentiate

$$
s_i
=

\exp(\log s_i)
$$

---

## Step 9：Sequence-level Clipping

$$
L_i
=

\min
\left(
s_i\hat A_i,
\operatorname{clip}
(s_i,1-\epsilon_l,1+\epsilon_h)
\hat A_i
\right)
$$

---

## Step 10：Aggregate

$$
J
=

\frac1G
\sum_iL_i
$$

训练代码通常写成需要 minimize 的 loss：

$$
\boxed{
L_{\mathrm{GSPO}}
=

-J_{\mathrm{GSPO}}
}
$$

---

## Step 11：Backpropagation

因为：

$$
s_i
=

\exp
\left(
\frac1T
\sum_t\log\pi_\theta(y_t|\cdots)
-\text{constant}
\right)
$$

gradient 会自动传回每个 response token。

然后：

$$
\theta
\leftarrow
\theta+\eta\nabla_\theta J
$$

完成 policy update。

---

# 19. 用伪代码看 GSPO

```python
for prompts in dataloader:

    # -------------------------------------------------
    # 1. rollout with old policy
    # -------------------------------------------------
    responses = rollout(
        policy_old,
        prompts,
        num_generations=G,
    )

    # -------------------------------------------------
    # 2. rewards
    # -------------------------------------------------
    rewards = verifier(prompts, responses)

    # -------------------------------------------------
    # 3. group-relative advantages
    # -------------------------------------------------
    advantages = group_normalize(rewards)

    # -------------------------------------------------
    # 4. old log probs
    # -------------------------------------------------
    with torch.no_grad():
        old_logp = policy_old.log_probs(
            prompts,
            responses,
        )

    # -------------------------------------------------
    # 5. current log probs
    # -------------------------------------------------
    new_logp = policy.log_probs(
        prompts,
        responses,
    )

    # [B, T]
    token_log_ratio = new_logp - old_logp

    # -------------------------------------------------
    # 6. sequence-level ratio
    # -------------------------------------------------
    seq_log_ratio = masked_mean(
        token_log_ratio,
        response_mask,
        dim=-1,
    )

    seq_ratio = torch.exp(seq_log_ratio)

    # -------------------------------------------------
    # 7. GSPO clipping
    # -------------------------------------------------
    unclipped = seq_ratio * advantages

    clipped_ratio = torch.clamp(
        seq_ratio,
        1 - eps_low,
        1 + eps_high,
    )

    clipped = clipped_ratio * advantages

    objective = torch.minimum(
        unclipped,
        clipped,
    )

    # -------------------------------------------------
    # 8. optimize
    # -------------------------------------------------
    loss = -objective.mean()

    loss.backward()
    optimizer.step()
```

从实现层面看，GSPO 与 GRPO 的区别实际上非常集中：

GRPO：

```python
ratio = exp(new_logp - old_logp)   # [B, T]
```

然后 token-wise clip。

GSPO：

```python
log_ratio = new_logp - old_logp
seq_log_ratio = mean(log_ratio, dim=response_tokens)
ratio = exp(seq_log_ratio)         # [B]
```

然后 sequence-wise clip。

---

# 20. GSPO 并没有改变 Group Relative Advantage

这一点很容易混淆。

GSPO 并不是：

> “把 GRPO 完全重新设计了一遍。”

实际上 GSPO 仍然保留：

$$
G\text{ responses / prompt}
$$

以及：

$$
\hat A_i
=

\frac{r_i-\mu_r}{\sigma_r}
$$

所以：

$$
\boxed{
\textbf{Group}
}
$$

这个部分基本继承自 GRPO。

GSPO 真正改变的是：

$$
\boxed{
\textbf{Sequence}
}
$$

也就是：

* sequence likelihood ratio；
* sequence clipping；
* sequence optimization weighting。

所以它的名字非常准确：

$$
\boxed{
\underbrace{\text{Group}}_{\text{GRPO-style advantage}}
+
\underbrace{\text{Sequence}}_{\text{sequence importance ratio}}
+
\underbrace{\text{Policy Optimization}}_{\text{PPO-style clipped objective}}
}
$$

---

# 21. PPO、GRPO、GSPO 的核心对比

|                                  | PPO                | GRPO                     | GSPO                     |
| -------------------------------- | ------------------ | ------------------------ | ------------------------ |
| Multiple responses/group         | 不要求                | 是                        | 是                        |
| Value Model                      | **需要**             | **不需要**                  | **不需要**                  |
| Advantage                        | token/state level  | sequence group advantage | sequence group advantage |
| Reward granularity               | sequence / process | 通常 sequence              | 通常 sequence              |
| Importance ratio                 | token              | token                    | **sequence**             |
| Ratio                            | (w_t)              | (w_{i,t})                | (s_i)                    |
| Clipping                         | token              | token                    | **sequence**             |
| 同 sequence token gradient weight | 不同                 | 不同                       | **相同**                   |
| Long-CoT stability               | —                  | 较容易出现 ratio noise        | 更稳定                      |
| MoE routing sensitivity          | —                  | 高                        | **明显降低**                 |
| Routing Replay                   | —                  | Qwen MoE 中需要             | **不需要**                  |
| Critic overhead                  | 高                  | 无                        | 无                        |

因此最简洁的关系是：

$$
\boxed{
\text{GRPO}
=

\text{Group Advantage}
+
\text{Token Ratio}
}
$$

而：

$$
\boxed{
\text{GSPO}
=

\text{Group Advantage}
+
\text{Sequence Ratio}
}
$$

---

# 22. GSPO-token 是什么？

GSPO 论文还提出了一个变体：

$$
\boxed{\text{GSPO-token}}
$$

为什么还需要 token variant？

因为有些任务并不是只有 sequence-level credit。

例如 multi-turn agent：

```text
Think
Action
Observation
Think
Action
Observation
...
```

可能希望：

$$
A_{i,t}
$$

在不同 token 或不同阶段上不同。

普通 GSPO：

$$
A_{i,t}=A_i
$$

所有 token 完全共享一个 advantage。

GSPO-token 为此定义：

$$
s_{i,t}(\theta)
=

\operatorname{sg}[s_i(\theta)]
\cdot
\frac{
\pi_\theta(y_{i,t}|x,y_{i,<t})
}{
\operatorname{sg}
[
\pi_\theta(y_{i,t}|x,y_{i,<t})
]
}
$$

其中：

$$
\operatorname{sg}[\cdot]
$$

表示 stop-gradient / detach。

注意：

$$
\frac{
\pi_\theta
}{
\operatorname{sg}[\pi_\theta]
}
$$

在数值上永远是：

$$
1
$$

因此：

$$
s_{i,t}
$$

**numerically 等于**：

$$
s_i
$$

但 gradient 可以从对应 token 的：

$$
\pi_\theta(y_{i,t})
$$

向后传播。

于是 GSPO-token 可以使用：

$$
A_{i,t}
$$

而不是：

$$
A_i
$$

从而实现更细粒度 credit assignment。

如果设置：

$$
A_{i,t}=A_i
$$

论文证明 GSPO-token 与普通 GSPO 在：

* objective numerical value；
* clipping condition；
* theoretical gradient；

上都是等价的。

---

# 23. GSPO 对 RL Infrastructure 的潜在意义

现代 LLM RL 经常是：

```text
Inference Engine
    ↓ rollout
SGLang / vLLM
    ↓
Training Engine
Megatron / FSDP / ...
```

问题是 inference engine 与 training engine 之间可能存在：

* BF16 / FP8 difference；
* kernel difference；
* tensor parallel implementation difference；
* MoE routing difference；
* numerical precision difference。

于是：

$$
\log p_{\mathrm{inference}}
$$

和：

$$
\log p_{\mathrm{training}}
$$

可能存在微小偏差。

对于 GRPO：

$$
w_t
=

\exp(
\log p_t^{new}
-

\log p_t^{old}
)
$$

每一个 token 的微小误差都会直接进入：

$$
w_t
$$

甚至改变 token 是否被 clipping。

因此很多 RL infrastructure 会：

> rollout engine 负责生成，但 training engine 再 recompute 一次 old log probabilities。

GSPO 使用：

$$
\frac1T
\sum_t
(\log p_t^{new}-\log p_t^{old})
$$

单 token numerical mismatch 会被 sequence aggregation 平滑，因此 Qwen 认为 GSPO 对 inference/training engine 的 probability discrepancy 更 tolerant，有可能直接使用 inference engine 返回的 likelihood，而不再由 training engine recompute。

论文对此使用的是“makes it possible / potential”式表述，因此更准确的理解是：

$$
\boxed{
\text{GSPO 有潜力简化 rollout-training probability synchronization}
}
$$

而不是：

> “GSPO 已经证明 old-logprob recomputation 永远都不需要。”

---

# 24. Qwen 的实验结果

原论文主要使用：

$$
\text{Qwen3-30B-A3B-Base}
$$

构造 cold-start RL model。

评测包括：

* AIME 2024；
* LiveCodeBench；
* CodeForces。

在相同 training compute 和 query consumption 下，GSPO 的 reward、AIME、LiveCodeBench 和 CodeForces performance curves 整体高于 GRPO + Routing Replay。

Qwen 同时表示 GSPO 被应用到了后续 Qwen3 系列模型的 RL 训练中。

不过原始 GSPO paper 本身只有 7 页，其 empirical evidence 主要集中在 Qwen 自己的大规模 MoE setting，因此不能从这篇论文单独推出：

$$
\text{GSPO 在所有 dense / MoE / task / scale 上都优于 GRPO}
$$

更准确的结论应该是：

> 在 Qwen 报告的大规模长序列 MoE RL setting 中，GSPO 展现出了明显的稳定性和效率优势。

---

# 25. GSPO 的局限

GSPO 解决 GRPO 问题的方法非常直接：

$$
\boxed{
\text{不要相信单 token ratio，直接看整个 sequence}
}
$$

但这样也产生了另一端的问题：

## 25.1 一个坏 token 可能导致整条 sequence 被 clip

假设 sequence 大部分 token 很正常：

$$
w_t\approx1
$$

但存在几个 extreme token。

这些 token 会影响：

$$
s_i
=

\exp(\operatorname{mean}\log w_t)
$$

一旦：

$$
s_i
$$

越过 clipping boundary：

$$
\boxed{\text{整条 response 都停止贡献相应 gradient}}
$$

而不是只 clip problematic tokens。

因此 GSPO 的 sequence coherence 很强，但 credit assignment 比 token-level 方法粗。

---

# 26. 这也是后来 SAPO、SSPO 等方法继续改 GSPO 的原因

截至 2026 年，GSPO 已经不是这一方向的终点。

Qwen 团队成员随后提出 **SAPO（Soft Adaptive Policy Optimization）**，明确指出 GSPO 的 hard sequence clipping 存在这样的 trade-off：

> 当 sequence 中只有少量 token 非常 off-policy 时，GSPO 可能 suppress 整个 sequence 的 gradient。

SAPO 因此尝试做到：

$$
\boxed{
\text{sequence coherence}
+
\text{token adaptivity}
}
$$

通过 soft gating 而不是 GSPO 的 hard clipping，在保留 sequence-level stability 的同时尽量保留有效 token 的 gradient。

另一条路线是 **SSPO（Subsentence-level Policy Optimization）**，将 optimization granularity 设在：

$$
\text{token}
<
\boxed{\text{subsentence}}
<
\text{sequence}
$$

希望在 GRPO 和 GSPO 两种极端之间取得平衡。SSPO 作者的实验同样指出，GSPO 的整条 sequence clipping 可能降低 sampled data utilization。

因此从今天看，GSPO 真正重要的贡献可能并不只是某个具体 loss，而是提出了一个更一般的问题：

$$
\boxed{
\text{LLM RL 的 optimization granularity 应该是什么？}
}
$$

可以是：

$$
\text{Token}
$$

也可以是：

$$
\text{Subsentence}
$$

或者：

$$
\text{Reasoning Step}
$$

或者：

$$
\text{Think-Action}
$$

或者：

$$
\text{Whole Sequence}
$$

这已经成为后续很多 RLVR / Agent RL 工作继续探索的设计维度。

---

# 27. 应该怎样真正理解 GSPO？

如果已经理解 PPO 和 GRPO，可以把 GSPO 压缩成下面这一条逻辑链。

GRPO：

$$
r(x,y)
$$

产生：

$$
A(y)
$$

但是 optimization 使用：

$$
w_t
=

\frac{\pi_\theta(y_t|y_{<t})}
{\pi_{\mathrm{old}}(y_t|y_{<t})}
$$

于是：

$$
\nabla J_{\mathrm{GRPO}}
\sim
A(y)
\sum_t
w_t
\nabla\log\pi_\theta(y_t|y_{<t})
$$

GSPO 认为这里存在：

$$
\boxed{
\text{Reward granularity}
\neq
\text{Importance-weight granularity}
}
$$

于是将：

$$
w_t
$$

替换成：

$$
s(y)
=

\left(
\frac{\pi_\theta(y|x)}
{\pi_{\mathrm{old}}(y|x)}
\right)^{1/T}
$$

得到：

$$
\nabla J_{\mathrm{GSPO}}
\sim
s(y)A(y)
\frac1T
\sum_t
\nabla\log\pi_\theta(y_t|y_{<t})
$$

于是：

$$
\boxed{
\text{Reward}
\rightarrow
\text{Advantage}
\rightarrow
\text{Importance Ratio}
\rightarrow
\text{Clipping}
}
$$

全部围绕：

$$
\boxed{\text{sequence}}
$$

这就是 GSPO 的核心。

---

# 28. 一张公式图记住 GSPO

$$
\boxed{
x
\overset{\pi_{\theta_{\mathrm{old}}}}{\longrightarrow}
{y_1,\dots,y_G}
}
$$

得到：

$$
\boxed{
r_1,\dots,r_G
}
$$

计算：

$$
\boxed{
A_i
=

\frac{r_i-\mu_r}{\sigma_r}
}
$$

然后对每条 sequence：

$$
\boxed{
\log s_i
=

\frac1{|y_i|}
\sum_t
\left(
\log\pi_\theta(y_{i,t})
-

\log\pi_{\mathrm{old}}(y_{i,t})
\right)
}
$$

$$
\boxed{
s_i=e^{\log s_i}
}
$$

最后：

$$
\boxed{
J_{\mathrm{GSPO}}
=

\frac1G
\sum_i
\min
\left(
s_iA_i,
\operatorname{clip}(s_i)A_i
\right)
}
$$

其 gradient：

$$
\boxed{
\nabla J_{\mathrm{GSPO}}
\propto
\frac1G
\sum_i
s_iA_i
\frac1{|y_i|}
\sum_t
\nabla\log\pi_\theta(y_{i,t}|x,y_{i,<t})
}
$$

与 GRPO 唯一最关键的对比：

$$
\boxed{
\underbrace{w_{i,t}}_{\text{GRPO: token-specific}}
\quad\longrightarrow\quad
\underbrace{s_i}_{\text{GSPO: sequence-shared}}
}
$$

如果只记住 GSPO 的一个公式和一个思想，就记这一行。

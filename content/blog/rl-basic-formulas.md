---
title: "强化学习基础公式全解析：从 Policy 到 Q-Learning"
date: 2026-08-22
tags: ["RL", "强化学习", "Bellman", "Q-Learning", "SARSA", "TD"]
featured: false
math: true
---

强化学习（Reinforcement Learning, RL）的核心是 agent 在环境（Environment）中通过试错（trial and error）学习最优策略。本文系统梳理 RL 最基础、最核心的公式，从 Policy、Return 出发，经过 V/Q 函数、Bellman 方程，最终到 TD 学习和 Q-Learning，形成一条完整的公式链。

---

## 1. 基础表示

### Policy

策略定义了 agent 在给定状态下如何选择动作。

**确定性策略**：状态到动作的映射

$$
A_t = \pi(S_t), \qquad \pi: \mathcal S \to \mathcal A
$$

**随机策略**：给定状态下的动作概率分布

$$
A_t \sim \pi(\cdot \mid S_t), \qquad
\pi(a \mid s) = P(A_t = a \mid S_t = s)
$$

其中 $\sum_{a \in \mathcal A} \pi(a \mid s) = 1$。随机策略是 RL 的一般形式，确定性策略可视为其退化情形。

### Discounted Return

Return $G_t$ 是从时间 $t$ 开始累积的折扣奖励总和：

$$
G_t = R_{t+1} + \gamma R_{t+2} + \gamma^2 R_{t+3} + \cdots
= \sum_{k=0}^{\infty} \gamma^k R_{t+k+1}
$$

**递归形式**是最常用的表达：

$$
G_t = R_{t+1} + \gamma G_{t+1}
$$

其中 $\gamma \in [0, 1]$ 是 discount factor。

### RL Target

RL 的目标是找到一个策略，使期望折扣回报最大化：

$$
\pi^* = \arg\max_{\pi} \mathbb E_{\pi} \left[ \sum_{t=0}^{\infty} \gamma^t R_{t+1} \right]
$$

---

## 2. $V^\pi$

状态价值函数 $V^\pi(s)$ 表示从状态 $s$ 出发，按照策略 $\pi$ 行动所能获得的期望 return。

**期望形式**：

$$
V^\pi(s) = \mathbb E_\pi \left[ G_t \mid S_t = s \right]
$$

展开 return：

$$
V^\pi(s) = \mathbb E_\pi \left[ R_{t+1} + \gamma R_{t+2} + \gamma^2 R_{t+3} + \cdots \mid S_t = s \right]
$$

**按概率分布展开**（离散情况）：

$$
V^\pi(s) = \sum_g g \cdot P_\pi(G_t = g \mid S_t = s)
$$

**Monte Carlo 估计**：从状态 $s$ 采样 $N$ 条 rollout，取 return 的平均值：

$$
\hat V^\pi(s) = \frac{1}{N} \sum_{i=1}^N G_t^{(i)} \approx V^\pi(s)
$$

$G_t$ 是一条具体 trajectory 的 return，而 $V^\pi(s)$ 是所有可能 returns 的期望。

---

## 3. $Q^\pi$

动作价值函数 $Q^\pi(s, a)$ 表示从状态 $s$ 开始，先执行动作 $a$，之后按策略 $\pi$ 行动所能获得的期望 return。

**期望形式**：

$$
Q^\pi(s, a) = \mathbb E_\pi \left[ G_t \mid S_t = s, A_t = a \right]
$$

展开 return：

$$
Q^\pi(s, a) = \mathbb E_\pi \left[ R_{t+1} + \gamma R_{t+2} + \gamma^2 R_{t+3} + \cdots \mid S_t = s, A_t = a \right]
$$

**按概率分布展开**：

$$
Q^\pi(s, a) = \sum_g g \cdot P_\pi(G_t = g \mid S_t = s, A_t = a)
$$

**Sampling**：

$$
\hat Q^\pi(s, a) = \frac{1}{N} \sum_{i=1}^N G_t^{(i)}
$$

其中 rollout 起点为 $(S_t = s, A_t = a)$，之后按 $\pi$ 行动。$Q^\pi$ 与 $V^\pi$ 的区别在于额外固定了第一步的 action。

---

## 4. $V^\pi$ 与 $Q^\pi$ 的关系

### 从 $Q^\pi$ 得到 $V^\pi$

$V^\pi(s)$ 是当前策略下所有动作价值的概率加权平均：

$$
V^\pi(s) = \mathbb E_{A \sim \pi(\cdot \mid s)} \left[ Q^\pi(s, A) \right]
$$

离散动作展开：

$$
V^\pi(s) = \sum_{a \in \mathcal A} \pi(a \mid s) Q^\pi(s, a)
$$

### 从 $V^\pi$ 得到 $Q^\pi$

固定当前 action，再对下一状态求期望：

$$
Q^\pi(s, a) = \mathbb E \left[ R_{t+1} + \gamma V^\pi(S_{t+1}) \mid S_t = s, A_t = a \right]
$$

记期望即时奖励为 $R(s, a)$：

$$
Q^\pi(s, a) = R(s, a) + \gamma \mathbb E \left[ V^\pi(S_{t+1}) \mid s, a \right]
$$

对下一状态展开：

$$
Q^\pi(s, a) = R(s, a) + \gamma \sum_{s' \in \mathcal S} P(s' \mid s, a) V^\pi(s')
$$

若 reward 依赖于 $(s, a, s')$：

$$
Q^\pi(s, a) = \sum_{s'} P(s' \mid s, a) \left[ R(s, a, s') + \gamma V^\pi(s') \right]
$$

### $Q^\pi$ 直接递归到 $Q^\pi$

将 $V^\pi(s') = \sum_{a'} \pi(a' \mid s') Q^\pi(s', a')$ 代入：

$$
Q^\pi(s, a) = R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) \sum_{a'} \pi(a' \mid s') Q^\pi(s', a')
$$

或紧凑形式：

$$
Q^\pi(s, a) = \mathbb E_\pi \left[ R_{t+1} + \gamma Q^\pi(S_{t+1}, A_{t+1}) \mid S_t = s, A_t = a \right]
$$

---

## 5. Bellman Expectation Equation

Bellman 方程的核心思想来自 $G_t = R_{t+1} + \gamma G_{t+1}$，将长期 return 改写为"一步奖励加下一状态价值"的递归形式。

### $V^\pi$ 的 Bellman Expectation Equation

最紧凑的期望形式：

$$
V^\pi(s) = \mathbb E_\pi \left[ R_{t+1} + \gamma V^\pi(S_{t+1}) \mid S_t = s \right]
$$

先展开 action：

$$
V^\pi(s) = \sum_a \pi(a \mid s) \left[ R(s, a) + \gamma \mathbb E_{S' \sim P(\cdot \mid s, a)} V^\pi(S') \right]
$$

完全展开：

$$
V^\pi(s) = \sum_{a \in \mathcal A} \pi(a \mid s) \left[ R(s, a) + \gamma \sum_{s' \in \mathcal S} P(s' \mid s, a) V^\pi(s') \right]
$$

使用 $R(s, a, s')$ 时：

$$
V^\pi(s) = \sum_a \pi(a \mid s) \sum_{s'} P(s' \mid s, a) \left[ R(s, a, s') + \gamma V^\pi(s') \right]
$$

也可以写成 $V$-$Q$ 两层形式：

$$
V^\pi(s) = \sum_a \pi(a \mid s) Q^\pi(s, a), \qquad
Q^\pi(s, a) = R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) V^\pi(s')
$$

### $Q^\pi$ 的 Bellman Expectation Equation

期望形式：

$$
Q^\pi(s, a) = \mathbb E_\pi \left[ R_{t+1} + \gamma Q^\pi(S_{t+1}, A_{t+1}) \mid S_t = s, A_t = a \right]
$$

完全展开：

$$
Q^\pi(s, a) = R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) \sum_{a'} \pi(a' \mid s') Q^\pi(s', a')
$$

---

## 6. Bellman Optimality Equation

### Optimal Value Functions

#### 最优状态价值

$$
V^*(s) = \max_\pi V^\pi(s)
$$

与 optimal Q 的关系：

$$
V^*(s) = \max_{a \in \mathcal A} Q^*(s, a)
$$

#### 最优动作价值

$$
Q^*(s, a) = \max_\pi Q^\pi(s, a)
$$

含义是：当前第一步 $a$ 已固定，从下一步开始采用最优策略。

与 Bellman Expectation Equation 结构对应，但将固定策略下的加权平均替换为 $\max$ 操作。

### $V^*$ 形式

期望形式：

$$
V^*(s) = \max_a \mathbb E \left[ R_{t+1} + \gamma V^*(S_{t+1}) \mid S_t = s, A_t = a \right]
$$

展开 transition：

$$
V^*(s) = \max_a \left[ R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) V^*(s') \right]
$$

### $Q^*$ 形式

期望形式：

$$
Q^*(s, a) = \mathbb E \left[ R_{t+1} + \gamma \max_{a'} Q^*(S_{t+1}, a') \mid S_t = s, A_t = a \right]
$$

展开 transition：

$$
Q^*(s, a) = R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) \max_{a'} Q^*(s', a')
$$

---

## 7. Advantage Function

Advantage 函数衡量某个动作相对于策略平均水平的优劣：

$$
A^\pi(s, a) = Q^\pi(s, a) - V^\pi(s)
$$

等价地：

$$
Q^\pi(s, a) = V^\pi(s) + A^\pi(s, a)
$$

由 $V^\pi(s) = \sum_a \pi(a \mid s) Q^\pi(s, a)$ 可得：

$$
\sum_a \pi(a \mid s) A^\pi(s, a) = 0
$$

即在策略自身的 action distribution 下，advantage 的期望为 0。

---

## 8. 从 Value 得到 Policy

普通 $Q$ 上的 greedy policy：

$$
\pi_Q(s) = \arg\max_a Q(s, a)
$$

Optimal policy：

$$
\pi^*(s) = \arg\max_a Q^*(s, a)
$$

核心对比：

$$
V^\pi(s) = \sum_a \pi(a \mid s) Q^\pi(s, a)
\quad\Longleftrightarrow\quad
V^*(s) = \max_a Q^*(s, a)
$$

前者是 **policy-weighted average**，后者是 **greedy maximum**。

---

## 9. 动态规划、蒙特卡洛与时序差分

精确的 Bellman 方程包含期望运算，求解方式分为三类：已知模型的动态规划、无模型的蒙特卡洛采样、以及结合两者的时序差分学习。

### 动态规划

动态规划（Dynamic Programming, DP）假设已知完整的 MDP 模型（转移概率 $P$ 和奖励函数 $R$），利用 Bellman 期望方程迭代求解价值函数。

**策略评估**：反复应用 Bellman 期望方程，逐步逼近 $V^\pi$：

$$
V_{k+1}(s) = \sum_a \pi(a \mid s) \left[ R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) V_k(s') \right]
$$

**策略迭代**：交替进行策略评估和策略改进：

$$
\pi'(s) = \arg\max_a \left[ R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) V^\pi(s') \right]
$$

**值迭代**：直接使用 Bellman 最优方程迭代，不显式维护策略：

$$
V_{k+1}(s) = \max_a \left[ R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) V_k(s') \right]
$$

DP 的局限在于需要完整的环境模型，而多数实际问题中 $P$ 和 $R$ 未知。

### 蒙特卡洛

蒙特卡洛（Monte Carlo, MC）方法不需要环境模型，直接从完整 episode 的采样 return 中学习。从状态 $s$ 采样 $N$ 条 rollout，取 return 的平均值作为 $V^\pi(s)$ 的估计：

$$
\hat V^\pi(s) = \frac{1}{N} \sum_{i=1}^N G_t^{(i)} \approx V^\pi(s)
$$

实际中通常采样多条 trajectory 做平均，以降低单条轨迹带来的高方差。当 $N$ 足够大时，$\hat V^\pi(s)$ 收敛到 $V^\pi(s)$。

增量更新形式是上述批平均的流式等价，每条新 episode 到达时：

$$
V(S_t) \leftarrow V(S_t) + \alpha \left[ G_t - V(S_t) \right]
$$

其中 $G_t$ 是当前 episode 的折扣回报。MC 的估计是无偏的，但方差较大，且必须等到 episode 结束才能更新。

**First-visit MC**：每个 episode 中只对状态 $s$ 第一次出现时进行更新。

**Every-visit MC**：每个 episode 中每次出现状态 $s$ 都进行更新。

### 时序差分

时序差分（Temporal Difference, TD）结合了 DP 的 bootstrap 和 MC 的采样思想，不需要环境模型，也不需要等到 episode 结束：

Bellman expectation：

$$
V^\pi(s) = \mathbb E_\pi \left[ R_{t+1} + \gamma V^\pi(S_{t+1}) \mid S_t = s \right]
$$

**单样本 TD target**：

$$
y_t^{\text{TD}} = R_{t+1} + \gamma V(S_{t+1})
$$

**TD error**：

$$
\delta_t = y_t^{\text{TD}} - V(S_t) = R_{t+1} + \gamma V(S_{t+1}) - V(S_t)
$$

**TD update**：

$$
V(S_t) \leftarrow V(S_t) + \alpha \delta_t
$$

完全写开：

$$
V(S_t) \leftarrow V(S_t) + \alpha \left[ R_{t+1} + \gamma V(S_{t+1}) - V(S_t) \right]
$$

TD 的方差比 MC 低，但引入 bootstrap 带来了偏差。三种方法的核心区别在于：

| 方法 | 是否需要模型 | 是否需要完整 episode | Bootstrap |
|------|-------------|---------------------|-----------|
| DP | 是 | 否 | 是 |
| MC | 否 | 是 | 否 |
| TD | 否 | 否 | 是 |

---

## 10. Q-Learning

Q-Learning 以 Bellman **optimality** equation 为目标，而非 Bellman expectation equation。

### 目标方程

$$
Q^*(s, a) = \mathbb E \left[ R_{t+1} + \gamma \max_{a'} Q^*(S_{t+1}, a') \mid s, a \right]
$$

### Sample TD Target

$$
y_t^Q = R_{t+1} + \gamma \max_{a'} Q(S_{t+1}, a')
$$

### TD Error

$$
\delta_t = y_t^Q - Q(S_t, A_t) = R_{t+1} + \gamma \max_{a'} Q(S_{t+1}, a') - Q(S_t, A_t)
$$

### Q-Learning Update

$$
Q(S_t, A_t) \leftarrow Q(S_t, A_t) + \alpha \delta_t
$$

完全写开：

$$
Q(S_t, A_t) \leftarrow Q(S_t, A_t) + \alpha \left[ R_{t+1} + \gamma \max_{a'} Q(S_{t+1}, a') - Q(S_t, A_t) \right]
$$

四条公式的递进关系：

$$
\text{Bellman optimality equation} \;\to\; \text{sample target} \;\to\; \text{TD error} \;\to\; \text{update}
$$

---

## 11. $\varepsilon$-Greedy 与 Off-Policy

$\varepsilon$-greedy 策略：以概率 $1-\varepsilon$ 选择贪心动作，以概率 $\varepsilon$ 随机探索。

若随机部分在所有 $|\mathcal A|$ 个动作中均匀采样：

$$
\pi_{\varepsilon}(a \mid s) =
\begin{cases}
1 - \varepsilon + \dfrac{\varepsilon}{|\mathcal A|}, & a = \arg\max_{a'} Q(s, a') \\[6pt]
\dfrac{\varepsilon}{|\mathcal A|}, & \text{otherwise}
\end{cases}
$$

Q-Learning 使用两套策略：

- **Behavior policy**：$\varepsilon$-greedy（用于生成数据）
- **Target policy**：$\arg\max_a Q(s, a)$（用于计算 target）

因此 Q-Learning 是 **off-policy** 算法：数据由探索性的 behavior policy 生成，但 target 使用 greedy policy。

---

## 12. Q-Learning 与 SARSA 的公式差异

**Q-Learning**（off-policy）：

$$
y_t^Q = R_{t+1} + \gamma \max_{a'} Q(S_{t+1}, a')
$$

$$
Q(S_t, A_t) \leftarrow Q(S_t, A_t) + \alpha \left[ R_{t+1} + \gamma \max_{a'} Q(S_{t+1}, a') - Q(S_t, A_t) \right]
$$

**SARSA**（on-policy）：下一步动作由当前 behavior policy 实际采样

$$
A_{t+1} \sim \pi(\cdot \mid S_{t+1})
$$

$$
y_t^{\text{SARSA}} = R_{t+1} + \gamma Q(S_{t+1}, A_{t+1})
$$

$$
Q(S_t, A_t) \leftarrow Q(S_t, A_t) + \alpha \left[ R_{t+1} + \gamma Q(S_{t+1}, A_{t+1}) - Q(S_t, A_t) \right]
$$

**最核心的差别**：

$$
\boxed{\text{Q-Learning: } \max_{a'} Q(S_{t+1}, a')}
\qquad
\boxed{\text{SARSA: } Q(S_{t+1}, A_{t+1}), \quad A_{t+1} \sim \pi}
$$

前者对下一步做 greedy optimization，后者使用 behavior policy 实际选出的下一动作。这也是 off-policy 与 on-policy 差异在公式中的直接体现。

---

## 13. 核心公式关系图

如果只保留一组需要反复记忆的公式，就是 RL 的基础公式链：

$$
G_t = R_{t+1} + \gamma G_{t+1}
$$

$$
V^\pi(s) = \mathbb E_\pi[G_t \mid S_t = s]
$$

$$
Q^\pi(s, a) = \mathbb E_\pi[G_t \mid S_t = s, A_t = a]
$$

$$
V^\pi(s) = \sum_a \pi(a \mid s) Q^\pi(s, a)
$$

$$
Q^\pi(s, a) = R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) V^\pi(s')
$$

$$
V^\pi(s) = \sum_a \pi(a \mid s) \left[ R(s, a) + \gamma \sum_{s'} P(s' \mid s, a) V^\pi(s') \right]
$$

$$
V^*(s) = \max_a Q^*(s, a)
$$

$$
Q^*(s, a) = \mathbb E \left[ R_{t+1} + \gamma \max_{a'} Q^*(S_{t+1}, a') \mid s, a \right]
$$

$$
A^\pi(s, a) = Q^\pi(s, a) - V^\pi(s)
$$

$$
\delta_t^V = R_{t+1} + \gamma V(S_{t+1}) - V(S_t)
$$

$$
\delta_t^Q = R_{t+1} + \gamma \max_{a'} Q(S_{t+1}, a') - Q(S_t, A_t)
$$

从 **Policy / Return → $V^\pi$ → $Q^\pi$ → Bellman Expectation → Bellman Optimality → TD → Q-Learning**，构成了强化学习最基础、最核心的公式链条。
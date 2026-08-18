---
title: "由一个 docker search 产生的连锁反应"
date: 2024-08-22
tags: ["bugs", "docker", "linux"]
---

有时候菜的想发颠。

网络问题总是层出不穷，dns解析不了，docker无法拉取镜像源...
莫名其妙的改了VMware的虚拟网络设置和Ubuntu的Ip&DNS。结果一顿操作给干连不了网了，`docker search <>` 显示：

`Error response from daemon: Get "https://index.docker.io/v1/search?q=nginx&n=25": dial tcp: lookup index.docker.io on 8.8.4.4:53: read udp 192.168.1.11:37017->8.8.4.4:53: i/o timeout`

查询后发现需要配置镜像源：
```
vim /etc/docker/darmon.json
{
     "registry-mirrors":[
                "..."
        ]
}

# 重启一下
systemctl daemon-reloa
systemctl restart docker
```
经配置镜像源后问题似乎得到了...似乎产生了新的问题。
`ping bing.com` 显示`ping: bing.com: Temporary failure in name resolution`，经过查询是DNS解析问题，先通过`vim /etc/resolv.conf`配置了两个DNS：
```
nameserver 8.8.8.8
nameserver 8.8.4.4
```
嘿，结果不行。由于昨夜头脑比较混乱，第二天打开虚拟网络设置->for i in all network: delete->应用->还原默认设置->重新配置虚拟机的网络为"桥接"，参考[stackoverflow](https://stackoverflow.com/questions/53687051/linux-command-line-error-message-temporary-failure-in-name-resolution)，将answer中的DNS部分替换为上面的dns，结果成功ping成功，并且成功search到docker镜像，但是问题就像趵突泉的泉水一样，一直涌现，在`docker pull <>`拉取镜像的时候又提示超时：
```
error pulling image configuration: download failed after attempts=6: dial tcp <...>
```
这是为什么呢？明明可以`search` 却不能`pull`??能`search`说明是能够连接到docker hub的，但是pull的时候超时又说明访问有问题，经过排查后，借鉴[这篇博客](https://www.cnblogs.com/lxzcloud/p/18354640) 后，发现最终还是镜像源问题，更改镜像源后问题解决。

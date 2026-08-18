---
title: "Use zsh terminal"
date: 2024-08-11
tags: ["shell", "zsh"]
---

One day I find that the terminal style between mine and other's are different and I wonder how they do that, so, then I find zsh
- Install zsh
```shell
sudo apt install zsh
#使用镜像源安装oh-my-zsh
sh -c "$(curl -fsSL https://gitee.com/mirrors/oh-my-zsh/raw/master/tools/install.sh)"
#编辑theme主题
vim ~/.zshrc
# ZSH_THEME="powerlevel10k/powerlevel10k"
```

- We may also need to config windows terminal's file`settings.json`

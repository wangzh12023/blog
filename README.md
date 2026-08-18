# Zihan Wang's Blog

个人博客，基于 [Hugo](https://gohugo.io/) 与 [hugo-theme-ladder](https://github.com/guangzhengli/hugo-theme-ladder) 构建，通过 GitHub Actions 自动部署到 GitHub Pages。

## 本地开发

```bash
hugo server -D
```

访问 http://localhost:1313/

## 写作

在 `content/blog/`（文章）或 `content/art/`（随笔）下新建 Markdown 文件，front matter 示例：

```markdown
---
title: "文章标题"
date: 2026-08-18
tags: ["tag1", "tag2"]
---

正文内容...
```

## 部署

推送到 `main` 分支后，GitHub Actions 会自动构建并部署到：

https://wangzh12023.github.io/blog/

## 评论系统

文章评论使用 Giscus（基于 GitHub Discussions），配置在 `config.yml` 的 `params.comments.giscus`。

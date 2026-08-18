# WZH Blog

基于 Next.js 的静态个人博客，部署在 GitHub Pages：

https://wangzh12023.github.io/blog/

## 本地开发

```bash
npm install
npm run dev
```

访问 http://localhost:3000/blog/。

## 构建

```bash
npm run build
```

静态站点输出到 `out/`。推送到 `main` 后，GitHub Actions 会自动部署到 GitHub Pages。

## Hugo 归档

迁移前的 Hugo 版本保存在：

- Git 分支：`hugo-archive`
- 本地 worktree：`../blog-hugo`

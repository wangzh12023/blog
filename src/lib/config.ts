export const config = {
  site: {
    title: "wzh",
    name: "WZH 的博客",
    description: "一个分享技术文章、效率工具与个人见解的博客",
    keywords: ["WZH", "技术博客", "AI", "LLM", "开发工具"],
    url: "https://wangzh12023.github.io/blog",
    baseUrl: "https://wangzh12023.github.io/blog",
    basePath: "/blog",
    image: "https://wangzh12023.github.io/blog/images/avatar-eyes.png",
    favicon: {
      ico: "/blog/favicon.png",
      png: "/blog/favicon.png",
      svg: "/blog/favicon.svg",
      appleTouchIcon: "/blog/favicon.png",
    },
    manifest: "/blog/site.webmanifest",
    rss: {
      title: "WZH 的博客",
      description: "一个分享技术文章、效率工具与个人见解的博客",
      feedLinks: {
        rss2: "/blog/rss.xml",
        json: "/blog/feed.json",
        atom: "/blog/atom.xml",
      },
    },
  },
  author: {
    name: "wzh",
    email: "3350782760@qq.com",
    bio: "记录技术学习、工具分享与个人思考",
  },
  social: {
    github: "https://github.com/wangzh12023",
    x: "",
    xiaohongshu: "",
    wechat: "",
    buyMeACoffee: "",
  },
  giscus: {
    repo: "wangzh12023/blog",
    repoId: "R_kgDOT8Xh4A",
    categoryId: "DIC_kwDOT8Xh4M4DDpPe",
  },
  navigation: {
    main: [
      {
        title: "文章",
        href: "/blog",
      },
    ],
  },
  seo: {
    metadataBase: new URL("https://wangzh12023.github.io/blog/"),
    alternates: {
      canonical: './',
    },
    openGraph: {
      type: "website" as const,
      locale: "zh_CN",
    },
    twitter: {
      card: "summary_large_image" as const,
      creator: "@wangzh12023",
    },
  },
};

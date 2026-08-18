import { defineCollection, defineConfig } from "@content-collections/core";
import { z } from "zod";

const blogs = defineCollection({
  name: "blogs",
  directory: "src/content/blog",
  include: "**/*.md",
  schema: z.object({
    title: z.string(),
    date: z.string(),
    updated: z.string().optional(),
    featured: z.boolean().optional().default(false),
    summary: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional().default([]),
    series: z.array(z.string()).optional().default([]),
    math: z.boolean().optional().default(false),
    content: z.string(),
  }),
  transform: async (document) => {
    const summary = document.summary || document.content
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\$\$[\s\S]*?\$\$/g, " ")
      .replace(/[#>*_`\[\]()~-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120)

    return {
      ...document,
      summary,
      slug: `${document._meta.path}`,
    };
  },
});

export default defineConfig({
  content: [blogs],
});

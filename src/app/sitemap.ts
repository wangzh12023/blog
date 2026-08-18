import type { MetadataRoute } from 'next'
import { allBlogs } from 'content-collections'
import { config } from '@/lib/config'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const posts: MetadataRoute.Sitemap = allBlogs.map((blog) => ({
    url: `${config.site.url}/blog/${blog.slug}/`,
    lastModified: new Date(blog.updated || blog.date),
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  return [
    {
      url: `${config.site.url}/`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${config.site.url}/blog/`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    ...posts,
  ]
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function absoluteUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://wangzh12023.github.io/blog"
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`
}

export function formatDate(date: string) {
  const [year, month, day] = new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).split('/');
  return `${year}年${month}月${day}日`;
}

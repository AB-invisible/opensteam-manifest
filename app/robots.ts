import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/', '/auth/', '/dashboard/'],
    },
    sitemap: `${appUrl}/sitemap.xml`,
  }
}

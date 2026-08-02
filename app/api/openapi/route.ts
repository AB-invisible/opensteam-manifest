import { NextResponse } from 'next/server'
import { getPublicAppUrl } from '@/app/lib/public-app-url'

export async function GET() {
  const baseUrl = getPublicAppUrl() || 'http://127.0.0.1:3000'

  return NextResponse.json({
    openapi: '3.0.3',
    info: {
      title: 'OpenSteam Manifests API',
      version: '2.0.0',
      description: 'Path-based API key authentication for Steam manifest generation.',
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/api/{apiKey}/generate/{appId}': {
        get: {
          summary: 'Generate or fetch manifest metadata',
          parameters: [
            { name: 'apiKey', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'appId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'zip'] } },
          ],
        },
      },
      '/api/{apiKey}/download/{appId}': {
        get: {
          summary: 'Download manifest ZIP',
          parameters: [
            { name: 'apiKey', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'appId', in: 'path', required: true, schema: { type: 'string' } },
          ],
        },
      },
      '/api/{apiKey}/request/{appId}': {
        post: {
          summary: 'Request a game be added to the registry',
          parameters: [
            { name: 'apiKey', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'appId', in: 'path', required: true, schema: { type: 'string' } },
          ],
        },
      },
      '/api/{apiKey}/usage': {
        get: {
          summary: 'API key usage report',
          parameters: [{ name: 'apiKey', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/api/{apiKey}/bulk/generate': {
        post: {
          summary: 'Bulk generate manifests (Reseller+ plans)',
          parameters: [{ name: 'apiKey', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    appIds: { type: 'array', items: { type: 'string' }, maxItems: 25 },
                  },
                  required: ['appIds'],
                },
              },
            },
          },
        },
      },
    },
  })
}

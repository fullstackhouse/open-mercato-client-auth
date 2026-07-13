import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'client_auth',
  title: 'Client Auth',
  version: '0.1.0',
  description:
    'Authentication for external clients (SPAs, mobile apps) on top of core auth: Google and Apple sign-in today, JSON session endpoints next. OAuth accounts are an extension entity linked to core users; sessions are issued by core auth.',
  author: 'Full Stack House',
  license: 'MIT',
}

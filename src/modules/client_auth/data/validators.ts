import { z } from 'zod'
import { OAUTH_PROVIDERS } from '../../../config.js'

export type { OauthProvider } from '../../../config.js'
export { OAUTH_PROVIDERS }

export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS)

export const oauthInitSchema = z.object({
  platform: z.enum(['web', 'mobile']).default('web'),
  redirect: z.string().max(2000).optional(),
})

export type OauthInitInput = z.infer<typeof oauthInitSchema>

export const oauthTokenSchema = z.object({
  idToken: z.string().min(1),
  name: z.string().max(320).optional(),
})

export type OauthTokenInput = z.infer<typeof oauthTokenSchema>

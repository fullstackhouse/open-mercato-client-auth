import { z } from 'zod'
import { getPasswordMinLength, OAUTH_PROVIDERS } from '../../../config.js'

export type { OauthProvider } from '../../../config.js'
export { OAUTH_PROVIDERS }

const emailSchema = z.string().trim().toLowerCase().email().max(320)

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
})
export type LoginInput = z.infer<typeof loginSchema>

/**
 * Signup schema, rebuilt per request so `CLIENT_AUTH_PASSWORD_MIN_LENGTH`
 * changes take effect without a rebuild.
 */
export function signupSchema() {
  return z.object({
    email: emailSchema,
    password: z.string().min(getPasswordMinLength()).max(1024),
    name: z.string().trim().min(1).max(320).optional(),
  })
}
export type SignupInput = z.infer<ReturnType<typeof signupSchema>>

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
})
export type RefreshInput = z.infer<typeof refreshSchema>

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
})
export type LogoutInput = z.infer<typeof logoutSchema>

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
  redirectTo: z.string().max(2000).optional(),
})
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>

export function passwordResetConfirmSchema() {
  return z.object({
    token: z.string().min(1),
    newPassword: z.string().min(getPasswordMinLength()).max(1024),
  })
}
export type PasswordResetConfirmInput = z.infer<ReturnType<typeof passwordResetConfirmSchema>>

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

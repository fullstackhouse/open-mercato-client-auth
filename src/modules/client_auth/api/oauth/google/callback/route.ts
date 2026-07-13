import { handleOauthCallback } from '../../lib.js'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(req: Request) {
  return handleOauthCallback('google', req)
}

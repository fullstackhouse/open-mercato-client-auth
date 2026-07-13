import { handleOauthInit } from '../../lib.js'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  return handleOauthInit('google', req)
}

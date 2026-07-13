import { handleOauthToken } from '../../lib.js'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  return handleOauthToken('apple', req)
}

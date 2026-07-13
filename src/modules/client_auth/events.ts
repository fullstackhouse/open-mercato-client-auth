import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'client_auth.user.signed_up', label: 'User Signed Up', entity: 'user', category: 'lifecycle' },
  { id: 'client_auth.oauth_account.linked', label: 'OAuth Account Linked', entity: 'oauth_account', category: 'lifecycle' },
  { id: 'client_auth.password_reset.requested', label: 'Password Reset Requested', entity: 'user', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'client_auth',
  events,
})

export const emitClientAuthEvent = eventsConfig.emit

export type ClientAuthEventId = (typeof events)[number]['id']

export default eventsConfig

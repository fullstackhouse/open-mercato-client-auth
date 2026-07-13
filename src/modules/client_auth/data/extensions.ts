import { defineLink, entityId } from '@open-mercato/shared/modules/dsl'

export const extensions = [
  defineLink(entityId('auth', 'user'), entityId('client_auth', 'oauth_account'), {
    join: { baseKey: 'id', extensionKey: 'user_id' },
    cardinality: 'one-to-many',
    required: false,
    description: 'OAuth provider links (Google / Apple) for a user',
  }),
]

export default extensions

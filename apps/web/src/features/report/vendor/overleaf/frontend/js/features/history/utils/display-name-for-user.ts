import { User } from '../services/types/shared'
import getMeta from '../../../utils/meta'
import { formatUserName } from './history-details'

export default function displayNameForUser(
  user:
    | (User & {
        name?: string
      })
    | null
) {
  if (user == null) {
    return 'Anonymous'
  }
  if (user.id === getMeta('ol-user').id) {
    return 'you'
  }
  if (user.name != null) {
    return user.name
  }
  return formatUserName(user)
}

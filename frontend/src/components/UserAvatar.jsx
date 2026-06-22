import { assetUrl } from '../api.js'

export default function UserAvatar({ user, className }) {
  const isPreset = user.avatar_url?.startsWith('preset:')
  const presetKey = isPreset ? user.avatar_url.slice(7) : null
  const hasImage = user.avatar_url && !isPreset

  return (
    <div
      className={`user-avatar ${className ?? ''}`}
      title={user.username}
      style={hasImage ? { overflow: 'hidden', background: 'none' } : undefined}
    >
      {hasImage ? (
        <img src={assetUrl(user.avatar_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : presetKey ? (
        presetKey
      ) : (
        (user.username?.[0] || '?').toUpperCase()
      )}
    </div>
  )
}

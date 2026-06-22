import { useRef, useState } from 'react'
import { uploadImage, assetUrl } from '../api.js'

// Reusable image picker: uploads on select, shows a preview, reports the stored
// URL (or null) back through onChange. Used by the add/edit card forms and the
// board design panel — type tells the backend which uploads/<type>/ folder to
// file the object under (e.g. "cards", "boards").
export default function ImageUploadField({ value, onChange, type }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleSelect(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const { url } = await uploadImage(file, type)
      onChange(url)
    } catch (err) {
      setError(err.message)
    }
    setUploading(false)
  }

  return (
    <div className="card-image-field">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleSelect}
      />
      {value ? (
        <div className="card-image-preview">
          <img src={assetUrl(value)} alt="card attachment preview" />
          <button
            type="button"
            className="card-image-remove"
            title="Remove image"
            onClick={() => onChange(null)}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-ghost card-image-add"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? 'Uploading…' : '+ Add image'}
        </button>
      )}
      <span className="card-image-hint">Images only · max 5 MB</span>
      {error && <span className="card-image-error">{error}</span>}
    </div>
  )
}
